const axios = require('axios');
const cheerio = require('cheerio');
const { 
    VIDEOSTR_BASE_URL, 
    FMOVIES_BASE_URL, 
    BROWSER_HEADERS, 
    getRandomUserAgent,
    DECRYPTION_KEYS_URL,
    FALLBACK_DECRYPTION_KEYS
} = require('../config');
const selectors = require('../config/selectors.json');
const fmoviesService = require('./fmovies');
const { parseMasterPlaylist } = require('../utils/playlistParser');
const { redisClient } = require('./cache');
const logger = require('../config/logger');

const getHeaders = (referer = FMOVIES_BASE_URL + '/') => ({
    ...BROWSER_HEADERS,
    'User-Agent': getRandomUserAgent(),
    'Referer': referer,
});

async function getStreamData(id, type) {
    const cacheKey = `${type}-${id}`;
    const cachedString = await redisClient.get(cacheKey);
    if (cachedString) {
        logger.info(`Cache HIT for stream key: ${cacheKey}. Returning cached data.`);
        return JSON.parse(cachedString);
    }
    logger.info(`Cache MISS for stream key: ${cacheKey}. Starting scrape...`);

    const servers = await fmoviesService.getServers(id, type);
    if (servers.length === 0) {
        throw new Error('No streaming servers were found for this content.');
    }

    logger.info(`Found ${servers.length} servers. Attempting fast scrape method...`);
    for (const server of servers) {
        try {
            const sourcesUrl = `${FMOVIES_BASE_URL}/ajax/episode/sources/${server.id}`;
            const sourcesResponse = await axios.get(sourcesUrl, { headers: getHeaders() });
            const embedUrl = sourcesResponse.data.link;
            if (!embedUrl || !embedUrl.startsWith(VIDEOSTR_BASE_URL)) {
                logger.warn(`Server ${server.name} did not provide a valid embed URL. Skipping.`);
                continue;
            }

            const embedPageHtml = await axios.get(embedUrl, { headers: getHeaders(FMOVIES_BASE_URL + '/') });
            const $$ = cheerio.load(embedPageHtml.data);

            let k_token = $$(selectors.videostr.embed.tokenNonce).attr('nonce') || $$(selectors.videostr.embed.tokenDpi).attr('data-dpi');
            const embedIdMatch = embedUrl.match(new RegExp(selectors.videostr.embed.embedIdRegex));
            const embedId = embedIdMatch ? embedIdMatch[1] : null;

            if (!k_token || !embedId) {
                logger.warn(`Could not scrape token or embed ID from page for server ${server.name}. Skipping.`);
                continue;
            }
            logger.info(`Scraped token and embedId successfully for ${server.name}.`);
            
            const getSourcesUrl = `${VIDEOSTR_BASE_URL}/embed-1/v3/e-1/getSources`;
            const finalSourcesResponse = await axios.get(getSourcesUrl, {
                params: { id: embedId, _k: k_token },
                headers: { ...getHeaders(embedUrl), 'X-Requested-With': 'XMLHttpRequest' }
            });

            const streamData = finalSourcesResponse.data;
            if (streamData && streamData.sources && streamData.sources.length > 0) {
                logger.info(`Successfully fetched source list from server: ${server.name}`);
                const masterUrl = streamData.sources[0].file;
                const subtitles = streamData.tracks || [];
                let sources = [];

                try {
                    const masterPlaylistText = await axios.get(masterUrl, { headers: getHeaders(embedUrl) });
                    sources = parseMasterPlaylist(masterPlaylistText.data);
                    
                    if (sources.length === 0 && masterPlaylistText.data.includes('#EXTM3U')) {
                        logger.info('Not a master playlist, but a valid direct M3U8. Returning direct link.');
                        sources.push({ quality: 'auto', url: masterUrl });
                    }
                } catch (playlistError) {
                    logger.warn(`Failed to fetch and parse the master M3U8 playlist from ${masterUrl}. Returning a partial result.`);
                    if (axios.isAxiosError(playlistError)) {
                        logger.error('Axios Error fetching master playlist:', {
                            status: playlistError.response?.status,
                            message: playlistError.message
                        });
                    }
                    sources.push({ quality: 'auto (master)', url: masterUrl });
                }

                if (sources.length === 0) {
                    logger.warn(`The source URL from ${server.name} did not contain a valid M3U8 playlist. Skipping.`);
                    continue;
                }

                let decryptionKey = null;
                if (streamData.encrypted) {
                    logger.info('Stream is encrypted. Attempting to fetch live decryption keys...');
                    try {
                        const keysResponse = await axios.get(DECRYPTION_KEYS_URL);
                        decryptionKey = keysResponse.data.mega || keysResponse.data.vidstr;
                        logger.info('Successfully fetched live decryption keys.');
                    } catch (keyError) {
                        logger.warn('Failed to fetch live decryption keys. Using hardcoded fallback key.');
                        logger.error('Decryption key fetch error:', { message: keyError.message });
                        decryptionKey = FALLBACK_DECRYPTION_KEYS.mega || FALLBACK_DECRYPTION_KEYS.vidstr;
                    }
                }
                
                const result = { sources, subtitles, decryptionKey, sourceServer: server.name, refererUrl: embedUrl };
                await redisClient.set(cacheKey, JSON.stringify(result), { EX: 14400 }); // Cache for 4 hours
                return result;

            } else {
                 logger.warn(`Server ${server.name} accepted the request but returned no sources. Skipping.`);
            }
        } catch (error) {
            logger.warn(`An error occurred with server ${server.name}.`);
            if (axios.isAxiosError(error)) {
                const errorContext = {
                    status: error.response?.status,
                    url: error.config?.url,
                    responseBody: error.response?.data
                };
                logger.error('Axios Error during scrape:', errorContext);
            } else {
                logger.error('Generic Error during scrape:', { message: error.message });
            }
        }
    }

    // If the loop completes without returning, it means no server worked.
    throw new Error('All fast-scrape attempts failed for all available servers.');
}

module.exports = { getStreamData };