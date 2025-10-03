require('dotenv').config();

const config = {
    PORT: process.env.PORT || 3001,
    REDIS_URL: process.env.REDIS_URL,
    AUTH0_ISSUER_BASE_URL: process.env.AUTH0_ISSUER_BASE_URL, // <-- ADD THIS
    AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE,             // <-- ADD THIS
    FMOVIES_BASE_URL: process.env.FMOVIES_BASE_URL || 'https://fmovies.ro',
    API_SECRET_KEY: process.env.API_SECRET_KEY, 
    VIDEOSTR_BASE_URL: process.env.VIDEOSTR_BASE_URL || 'https://videostr.net',
    DECRYPTION_KEYS_URL: process.env.DECRYPTION_KEYS_URL || 'https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json',
    TMDB_API_KEY: process.env.TMDB_API_KEY,
    BROWSER_HEADERS: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/536.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://fmovies.ro/',
    }
};

module.exports = config;