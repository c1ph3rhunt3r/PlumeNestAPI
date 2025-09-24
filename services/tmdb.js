const axios = require('axios');
const { TMDB_API_KEY } = require('../config');

async function getTmdbMetadata(title, type, year = null) {
    try {
        const searchType = type === 'tv' ? 'tv' : 'movie';
        const params = { api_key: TMDB_API_KEY, query: title };
        if (year) params.year = year;

        console.log(`[LOG] Searching TMDb for: ${title} (Type: ${searchType})`);
        const searchResponse = await axios.get(`https://api.themoviedb.org/3/search/${searchType}`, { params });
        const showResult = searchResponse.data.results[0];
        if (!showResult) {
            console.log(`[LOG] No TMDb result found for: ${title}`);
            return null;
        }

        const { id, overview, poster_path, release_date, first_air_date } = showResult;
        const fullPosterUrl = poster_path ? `https://image.tmdb.org/t/p/w500${poster_path}` : null;
        const releaseYear = (release_date || first_air_date || "").substring(0, 4);

        console.log(`[LOG] Found TMDb match: ${showResult.name || showResult.title} (ID: ${id})`);
        return { overview, posterUrl: fullPosterUrl, tmdbId: id, year: releaseYear };
    } catch (error) {
        console.error(`[ERROR] in getTmdbMetadata for "${title}":`, error.message);
        return null;
    }
}

module.exports = { getTmdbMetadata };