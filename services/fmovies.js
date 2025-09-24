const axios = require('axios');
const cheerio = require('cheerio');
const { FMOVIES_BASE_URL, BROWSER_HEADERS } = require('../config');
const selectors = require('../config/selectors.json'); // <-- 1. IMPORT the new file

async function searchContent(title) {
    const formattedTitle = title.trim().toLowerCase().replace(/\s+/g, '-');
    const searchUrl = `${FMOVIES_BASE_URL}/search/${formattedTitle}`;
    console.log(`[LOG] Searching fmovies: ${searchUrl}`);
    const response = await axios.get(searchUrl, { headers: BROWSER_HEADERS });
    const $ = cheerio.load(response.data);

    const candidates = [];
    // 2. USE the selectors from the config file
    $(selectors.fmovies.search.item).each((i, el) => {
        const itemTitle = $(el).find(selectors.fmovies.search.title).attr('title');
        const itemHref = $(el).find(selectors.fmovies.search.title).attr('href');
        const itemType = $(el).find(selectors.fmovies.search.type).text().toLowerCase();
        const itemYear = $(el).find(selectors.fmovies.search.year).first().text();

        if (itemTitle && itemHref) {
            const match = itemHref.match(/-(\d+)$/);
            if (match && match[1]) {
                candidates.push({
                    fmoviesId: match[1],
                    title: itemTitle,
                    type: itemType,
                    year: itemType === 'movie' ? itemYear : null,
                    href: itemHref
                });
            }
        }
    });
    console.log(`[LOG] Found ${candidates.length} candidates on fmovies.`);
    return candidates;
}

async function getSeasons(showId) {
    const seasonListHtml = await axios.get(`${FMOVIES_BASE_URL}/ajax/season/list/${showId}`, { headers: BROWSER_HEADERS });
    const $ = cheerio.load(seasonListHtml.data);
    const seasons = [];
    // 3. USE the selector
    $(selectors.fmovies.seasons.item).each((i, el) => {
        seasons.push({
            seasonId: $(el).attr('data-id'),
            seasonNumber: $(el).attr('data-season') || $(el).text().trim().replace('Season ', ''),
        });
    });
    return seasons;
}

async function getEpisodes(seasonId) {
    const episodeListHtml = await axios.get(`${FMOVIES_BASE_URL}/ajax/season/episodes/${seasonId}`, { headers: BROWSER_HEADERS });
    const $ = cheerio.load(episodeListHtml.data);
    const episodes = [];
    // 4. USE the selector
    $(selectors.fmovies.episodes.item).each((i, el) => {
        episodes.push({
            episodeId: $(el).attr('data-id'),
            title: $(el).attr('title'),
        });
    });
    return episodes;
}

async function getServers(id, type) {
    const serverListUrl = type === 'movie'
        ? `${FMOVIES_BASE_URL}/ajax/episode/list/${id}`
        : `${FMOVIES_BASE_URL}/ajax/episode/servers/${id}`;
    
    const serversHtmlResponse = await axios.get(serverListUrl, { headers: BROWSER_HEADERS });
    const $ = cheerio.load(serversHtmlResponse.data);
    const servers = [];
    // 5. USE the selector
    $(selectors.fmovies.servers.item).each((i, el) => {
        const serverId = $(el).attr('data-id') || $(el).attr('data-linkid');
        servers.push({ id: serverId, name: $(el).attr('title').replace('Server ', '') });
    });
    return servers;
}

module.exports = { searchContent, getSeasons, getEpisodes, getServers };