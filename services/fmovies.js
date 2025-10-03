const axios = require('axios');
const cheerio = require('cheerio');
const { FMOVIES_BASE_URL, BROWSER_HEADERS, getRandomUserAgent } = require('../config');
const selectors = require('../config/selectors.json');
const logger = require('../config/logger');

const getHeaders = () => ({
    ...BROWSER_HEADERS,
    'User-Agent': getRandomUserAgent(),
});

async function searchContent(title) {
    const formattedTitle = title.trim().toLowerCase().replace(/\s+/g, '-');
    const searchUrl = `${FMOVIES_BASE_URL}/search/${formattedTitle}`;
    logger.info(`Searching fmovies: ${searchUrl}`);
    const response = await axios.get(searchUrl, { headers: getHeaders() });
    const $ = cheerio.load(response.data);

    const candidates = [];
    $(selectors.fmovies.search.item).each((i, el) => {
        const titleElement = $(el).find(selectors.fmovies.search.title);
        const itemTitle = titleElement.attr('title');
        const itemHref = titleElement.attr('href');
        const itemType = $(el).find(selectors.fmovies.search.type).text().toLowerCase();
        const itemYear = $(el).find(selectors.fmovies.search.year).first().text();
        
        // --- NEW: Scrape the poster URL ---
        const posterUrl = $(el).find('img').attr('data-src');

        if (itemTitle && itemHref) {
            const match = itemHref.match(/-(\d+)$/);
            if (match && match[1]) {
                candidates.push({
                    id: match[1], // Use 'id' consistently
                    title: itemTitle,
                    type: itemType,
                    year: itemType === 'movie' ? itemYear : null,
                    href: `${FMOVIES_BASE_URL}${itemHref}`,
                    posterUrl: posterUrl
                });
            }
        }
    });
    logger.info(`Found ${candidates.length} candidates on fmovies.`);
    return candidates;
}

// --- NEW FUNCTION TO GET DETAILED METADATA ---
async function getMetadata(fmoviesId, fmoviesUrl) {
    logger.info(`Fetching metadata for fmovies ID: ${fmoviesId}`);
    const response = await axios.get(fmoviesUrl, { headers: getHeaders() });
    const $ = cheerio.load(response.data);

    const overview = $('.description').text().trim();
    // In the future, you could also scrape the TMDb ID if it's available on this page
    // const tmdbId = ...

    return { overview };
}


async function getSeasons(showId) {
    // ... (this function remains unchanged)
    const seasonListHtml = await axios.get(`${FMOVIES_BASE_URL}/ajax/season/list/${showId}`, { headers: getHeaders() });
    const $ = cheerio.load(seasonListHtml.data);
    const seasons = [];
    $(selectors.fmovies.seasons.item).each((i, el) => {
        seasons.push({
            seasonId: $(el).attr('data-id'),
            seasonNumber: $(el).attr('data-season') || $(el).text().trim().replace('Season ', ''),
        });
    });
    return seasons;
}

async function getEpisodes(seasonId) {
    // ... (this function remains unchanged)
    const episodeListHtml = await axios.get(`${FMOVIES_BASE_URL}/ajax/season/episodes/${seasonId}`, { headers: getHeaders() });
    const $ = cheerio.load(episodeListHtml.data);
    const episodes = [];
    $(selectors.fmovies.episodes.item).each((i, el) => {
        episodes.push({
            episodeId: $(el).attr('data-id'),
            title: $(el).attr('title'),
        });
    });
    return episodes;
}

async function getServers(id, type) {
    // ... (this function remains unchanged)
    const serverListUrl = type === 'movie'
        ? `${FMOVIES_BASE_URL}/ajax/episode/list/${id}`
        : `${FMOVIES_BASE_URL}/ajax/episode/servers/${id}`;
    
    const serversHtmlResponse = await axios.get(serverListUrl, { headers: getHeaders() });
    const $ = cheerio.load(serversHtmlResponse.data);
    const servers = [];
    $(selectors.fmovies.servers.item).each((i, el) => {
        const serverId = $(el).attr('data-id') || $(el).attr('data-linkid');
        servers.push({ id: serverId, name: $(el).attr('title').replace('Server ', '') });
    });
    return servers;
}

module.exports = { searchContent, getMetadata, getSeasons, getEpisodes, getServers };