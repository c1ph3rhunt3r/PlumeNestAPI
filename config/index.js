require('dotenv').config();
// A list of common, modern User-Agent strings
const USER_AGENTS = [
'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/119.0',
];
// Helper function to get a random User-Agent
const getRandomUserAgent = () => {
const randomIndex = Math.floor(Math.random() * USER_AGENTS.length);
return USER_AGENTS[randomIndex];
};
const config = {
PORT: process.env.PORT || 3001,
REDIS_URL: process.env.REDIS_URL,
AUTH0_ISSUER_BASE_URL: process.env.AUTH0_ISSUER_BASE_URL,
AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE,
API_SECRET_KEY: process.env.API_SECRET_KEY,
FMOVIES_BASE_URL: 'https://fmovies.ro',
VIDEOSTR_BASE_URL: 'https://videostr.net',
DECRYPTION_KEYS_URL: 'https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json',
TMDB_API_KEY: process.env.TMDB_API_KEY,
SUPABASE_URL: process.env.SUPABASE_URL,             // <-- ADD THIS
SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,  
// --- ADD THIS NEW SECTION ---
FALLBACK_DECRYPTION_KEYS: {
    "mega": "nTAygRRNLS3wo82OtMyfPrWgD9K2UIvcwlj",
    "vidstr": "nTAygRRNLS3wo82OtMyfPrWgD9K2UIvcwlj",
    "rabbit": "3AlttPAF1Zwn2l63meMeGMIvlWOXgm9ZXNk3glEzLTGOr1F113"
},
// --- END NEW SECTION ---

BROWSER_HEADERS: {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://fmovies.ro/',
},
getRandomUserAgent,
};
module.exports = config;
