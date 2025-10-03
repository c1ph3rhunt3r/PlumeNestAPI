const axios = require('axios');
const cheerio = require('cheerio');
const { VIDEOSTR_BASE_URL, FMOVIES_BASE_URL, BROWSER_HEADERS } = require('../config');
const selectors = require('../config/selectors.json');
const fmoviesService = require('./fmovies');
const { parseMasterPlaylist } = require('../utils/playlistParser');
const { redisClient } = require('./cache'); // Use Redis client
const logger = require('../config/logger');

async function getStreamData(id, type) {
    const cacheKey = `${type}-${id}`;
    const cachedString = await redisClient.get(cacheKey);
    if (cachedString) {
        logger.info(`Cache HIT for stream key: ${cacheKey}. Returning cached data.`);
        return JSON.parse(cachedString);
    }
    logger.info(`Cache MISS for stream key: ${cacheKey}. Starting scrape...`);

    const servers = await fmoviesService.getServers(id, type);
    if (servers.length === 0) throw new Error('No streaming servers were found.');

    logger.info(`Found ${servers.length} servers. Attempting fast scrape...`);
    for (const server of servers) {
        try {
            const sourcesUrl = `${FMOVIES_BASE_URL}/ajax/episode/sources/${server.id}`;
            const sourcesResponse = await axios.get(sourcesUrl, { headers: BROWSER_HEADERS });
            const embedUrl = sourcesResponse.data.link;
            if (!embedUrl || !embedUrl.startsWith(VIDEOSTR_BASE_URL)) continue;

            const embedPageHtml = await axios.get(embedUrl, { headers: { ...BROWSER_HEADERS, 'Referer': FMOVIES_BASE_URL + '/' } });
            const $$ = cheerio.load(embedPageHtml.data);

            let k_token = $$(selectors.videostr.embed.tokenNonce).attr('nonce') || $$(selectors.videostr.embed.tokenDpi).attr('data-dpi');
            const embedIdMatch = embedUrl.match(new RegExp(selectors.videostr.embed.embedIdRegex));
            const embedId = embedIdMatch ? embedIdMatch[1] : null;

            if (!k_token || !embedId) {
                logger.warn(`Could not scrape token for server ${server.name}. Skipping.`);
                continue;
            }
            
            const getSourcesUrl = `${VIDEOSTR_BASE_URL}/embed-1/v3/e-1/getSources`;
            const finalSourcesResponse = await axios.get(getSourcesUrl, {
                params: { id: embedId, _k: k_token },
                headers: { ...BROWSER_HEADERS, 'Referer': embedUrl, 'X-Requested-With': 'XMLHttpRequest' }
            });

            const streamData = finalSourcesResponse.data;
            if (streamData && streamData.sources && streamData.sources.length > 0) {
                logger.info(`Successfully fetched sources from server: ${server.name}`);
                const masterUrl = streamData.sources[0].file;
                const subtitles = streamData.tracks || [];
                let sources = [];
                try {
                    const masterPlaylistText = await axios.get(masterUrl, { headers: { 'Referer': embedUrl } });
                    sources = parseMasterPlaylist(masterPlaylistText.data);
                    if (sources.length === 0 && masterPlaylistText.data.includes('#EXTM3U')) {
                        sources.push({ quality: 'auto', url: masterUrl });
                    }
                } catch (playlistError) {
                    logger.warn(`Failed to parse master playlist from ${masterUrl}. Returning partial result.`, { error: playlistError.message });
                    sources.push({ quality: 'auto (master)', url: masterUrl });
                }

                if (sources.length === 0) {
                    logger.warn(`Source from ${server.name} was not a valid M3U8. Skipping.`);
                    continue;
                }
                
                const result = { sources, subtitles, sourceServer: server.name, refererUrl: embedUrl };
                await redisClient.set(cacheKey, JSON.stringify(result), { EX: 14400 }); // 4 hours
                return result;
            }
        } catch (error) {
            logger.warn(`An error occurred with server ${server.name}.`);
            if (axios.isAxiosError(error)) {
                logger.error('Axios Error during scrape:', { status: error.response?.status, url: error.config?.url });
            } else {
                logger.error('Generic Error during scrape:', { message: error.message });
            }
        }
    }
    throw new Error('All fast-scrape attempts failed for all available servers.');
}

module.exports = { getStreamData };