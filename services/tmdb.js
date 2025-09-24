const axios = require('axios');
const { TMDB_API_KEY } = require('../config');
const logger = require('../config/logger'); // <-- IMPORT LOGGER

async function getTmdbMetadata(title, type, year = null) {
    try {
        const searchType = type === 'tv' ? 'tv' : 'movie';
        const params = { api_key: TMDB_API_KEY, query: title };
        if (year) params.year = year;

        logger.info(`Searching TMDb for: "${title}" (Type: ${searchType})`);
        const searchResponse = await axios.get(`https://api.themoviedb.org/3/search/${searchType}`, { params });
        const showResult = searchResponse.data.results[0];
        if (!showResult) {
            logger.warn(`No TMDb result found for: "${title}"`);
            return null;
        }

        const { id, overview, poster_path, release_date, first_air_date } = showResult;
        const fullPosterUrl = poster_path ? `https://image.tmdb.org/t/p/w500${poster_path}` : null;
        const releaseYear = (release_date || first_air_date || "").substring(0, 4);

        logger.info(`Found TMDb match: ${showResult.name || showResult.title} (ID: ${id})`);
        return { overview, posterUrl: fullPosterUrl, tmdbId: id, year: releaseYear };
    } catch (error) {
        logger.error(`Error in getTmdbMetadata for "${title}"`, { message: error.message });
        return null;
    }
}

module.exports = { getTmdbMetadata };