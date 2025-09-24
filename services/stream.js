const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const { VIDEOSTR_BASE_URL, FMOVIES_BASE_URL, BROWSER_HEADERS } = require('../config');
const selectors = require('../config/selectors.json'); // <-- 1. IMPORT the new file
const fmoviesService = require('./fmovies');
const { parseMasterPlaylist } = require('../utils/playlistParser');
const { streamCache } = require('./cache');

async function getStreamData(id, type) {
    const cacheKey = `${type}-${id}`;
    const cachedData = streamCache.get(cacheKey);
    if (cachedData) {
        console.log(`[LOG] Cache HIT for stream key: ${cacheKey}. Returning cached data.`);
        return cachedData;
    }

    console.log(`[LOG] Cache MISS for stream key: ${cacheKey}. Starting scrape...`);
    
    const servers = await fmoviesService.getServers(id, type);
    if (servers.length === 0) throw new Error('No streaming servers were found for this content.');

    // Method 1: Fast Scrape
    console.log('[LOG] Attempting fast scrape method...');
    for (const server of servers) {
        try {
            const sourcesUrl = `${FMOVIES_BASE_URL}/ajax/episode/sources/${server.id}`;
            const sourcesResponse = await axios.get(sourcesUrl, { headers: BROWSER_HEADERS });
            const embedUrl = sourcesResponse.data.link;
            if (!embedUrl || !embedUrl.startsWith(VIDEOSTR_BASE_URL)) continue;

            const embedPageHtml = await axios.get(embedUrl, { headers: { ...BROWSER_HEADERS, 'Referer': FMOVIES_BASE_URL + '/' } });
            const $$ = cheerio.load(embedPageHtml.data);

            // 2. USE selectors from config
            let k_token = $$(selectors.videostr.embed.tokenNonce).attr('nonce') || $$(selectors.videostr.embed.tokenDpi).attr('data-dpi');
            const embedIdMatch = embedUrl.match(new RegExp(selectors.videostr.embed.embedIdRegex)); // Note: new RegExp() is needed here
            const embedId = embedIdMatch ? embedIdMatch[1] : null;
            if (!k_token || !embedId) continue;
            
            const getSourcesUrl = `${VIDEOSTR_BASE_URL}/embed-1/v3/e-1/getSources`;
            const finalSourcesResponse = await axios.get(getSourcesUrl, {
                params: { id: embedId, _k: k_token },
                headers: { ...BROWSER_HEADERS, 'Referer': embedUrl, 'X-Requested-With': 'XMLHttpRequest' }
            });

            const streamData = finalSourcesResponse.data;
            if (streamData && streamData.sources && streamData.sources.length > 0) {
                console.log(`[SUCCESS] Fast scrape successful on server: ${server.name}`);
                const masterUrl = streamData.sources[0].file;
                const subtitles = streamData.tracks || [];
                
                const masterPlaylistText = await axios.get(masterUrl, { headers: { 'Referer': embedUrl } });
                let sources = parseMasterPlaylist(masterPlaylistText.data);
                if (sources.length === 0) sources.push({ quality: 'auto', url: masterUrl });

                const result = { sources, subtitles, sourceServer: server.name, refererUrl: embedUrl };
                streamCache.set(cacheKey, result);
                return result;
            }
        } catch (error) {
            console.log(`[WARN] Fast scrape failed for server ${server.name}: ${error.message.slice(0, 100)}`);
        }
    }

    // Method 2: Headless Browser Fallback
    console.log('[WARN] Fast method failed. Retrying with headless browser...');
    let browser = null;
    for (const server of servers) {
        let page;
        try {
            const sourcesUrl = `${FMOVIES_BASE_URL}/ajax/episode/sources/${server.id}`;
            const sourcesResponse = await axios.get(sourcesUrl, { headers: BROWSER_HEADERS });
            const embedUrl = sourcesResponse.data.link;
            if (!embedUrl || !embedUrl.startsWith(VIDEOSTR_BASE_URL)) continue;
            
            browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            page = await browser.newPage();
            await page.setUserAgent(BROWSER_HEADERS['User-Agent']);
            await page.setExtraHTTPHeaders({ 'Referer': FMOVIES_BASE_URL + '/' });

            let streamData = null;
            const responsePromise = new Promise((resolve, reject) => {
                page.on('response', async (response) => {
                    if (response.url().includes('/getSources')) {
                        try {
                            const data = await response.json();
                            if (data && data.sources && data.sources.length > 0) resolve(data);
                        } catch (e) {}
                    }
                });
                setTimeout(() => reject(new Error('Timeout waiting for /getSources')), 45000);
            });

            await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 45000 });

            try {
                // 3. USE selectors for Puppeteer
                const iframeElement = await page.waitForSelector(selectors.videostr.embed.iframe, { timeout: 15000 });
                const frame = await iframeElement.contentFrame();
                if (!frame) throw new Error('Could not get iframe content.');
                await frame.waitForSelector(selectors.videostr.embed.player, { timeout: 15000 });
                await frame.click(selectors.videostr.embed.player);
            } catch (clickError) {
                console.log(`[WARN] Could not click player: ${clickError.message}.`);
            }

            streamData = await responsePromise;
            await browser.close(); browser = null;

            if (streamData) {
                console.log(`[SUCCESS] Headless browser successful on server: ${server.name}`);
                const masterUrl = streamData.sources[0].file;
                const subtitles = streamData.tracks || [];

                const masterPlaylistText = await axios.get(masterUrl, { headers: { 'Referer': embedUrl } });
                let sources = parseMasterPlaylist(masterPlaylistText.data);
                if (sources.length === 0) sources.push({ quality: 'auto', url: masterUrl });
                
                const result = { sources, subtitles, sourceServer: server.name, refererUrl: embedUrl };
                streamCache.set(cacheKey, result);
                return result;
            }
        } catch (loopError) {
            console.log(`[WARN] Headless browser failed for server ${server.name}: ${loopError.message.slice(0, 100)}`);
            if (page && !page.isClosed()) await page.screenshot({ path: `error_${server.name}.png` });
            if (browser) await browser.close();
        }
    }
    throw new Error('All scraping methods failed for all available servers.');
}

module.exports = { getStreamData };