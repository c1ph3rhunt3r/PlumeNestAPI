const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const config = require('./config');
const logger = require('./config/logger');
const { redisClient } = require('./services/cache');
const fmoviesService = require('./services/fmovies');
const tmdbService = require('./services/tmdb');
const streamService = require('./services/stream');
const { auth } = require('express-oauth2-jwt-bearer');

const app = express();

// --- AUTH0 JWT CHECK MIDDLEWARE ---
const checkJwt = auth({
  audience: config.AUTH0_AUDIENCE,
  issuerBaseURL: config.AUTH0_ISSUER_BASE_URL,
});

// --- NEW API KEY CHECK MIDDLEWARE ---
const apiKeyMiddleware = (req, res, next) => {
    const providedKey = req.header('X-API-KEY');

    if (!config.API_SECRET_KEY) {
        logger.error("[FATAL] API_SECRET_KEY is not configured on the server. All requests will be blocked.");
        return res.status(500).json({ error: 'Server configuration error: Missing API secret key.' });
    }

    if (!providedKey) {
        return res.status(401).json({ error: 'Unauthorized: Missing X-API-KEY header.' });
    }

    if (providedKey !== config.API_SECRET_KEY) {
        return res.status(403).json({ error: 'Forbidden: Invalid API Key.' });
    }

    // If the key is valid, proceed to the next middleware or route handler
    next();
};

// --- MIDDLEWARE SETUP ---
app.use(cors());
app.use(express.json());

// --- API ENDPOINTS ---

// This is a public endpoint that anyone can access (it does not use the middleware).
app.get('/', (req, res) => res.send('PlumeNest Personal API is running!'));

// All routes defined below will be protected by BOTH the API Key and the Auth0 JWT.
// The middlewares run in the order they are provided.

app.get('/search', apiKeyMiddleware, checkJwt, async (req, res) => {
    logger.info(`Search request received from user: ${req.auth.payload.sub}`);
    
    const { title, type } = req.query;
    if (!title) return res.status(400).json({ error: 'Title query parameter is required.' });

    const cacheKey = `search-${type || 'any'}-${title.trim().toLowerCase()}`;
    const cachedString = await redisClient.get(cacheKey);
    if (cachedString) {
        logger.info(`Cache HIT for search key: ${cacheKey}.`);
        return res.json(JSON.parse(cachedString));
    }
    logger.info(`Cache MISS for search key: ${cacheKey}.`);

    try {
        const fmoviesCandidates = await fmoviesService.searchContent(title);
        if (fmoviesCandidates.length === 0) return res.status(404).json({ error: 'Content not found.' });
        
        const metadataPromises = fmoviesCandidates.map(c => tmdbService.getTmdbMetadata(c.title, c.type, c.year).then(d => ({ ...c, ...d })));
        const enrichedCandidates = await Promise.all(metadataPromises);

        let bestCombinedMatch = null;
        let bestScore = -1;

        for (const candidate of enrichedCandidates) {
            if (candidate.tmdbId) {
                let currentScore = 0;
                if (candidate.title.toLowerCase() === title.toLowerCase()) currentScore += 10;
                if (type && candidate.type === type.toLowerCase()) currentScore += 5;
                currentScore += 1;
                if (currentScore > bestScore) {
                    bestScore = currentScore;
                    bestCombinedMatch = candidate;
                }
            }
        }

        if (!bestCombinedMatch) {
            logger.warn('No strong match found, falling back to first result.');
            bestCombinedMatch = enrichedCandidates[0];
        }
        
        bestCombinedMatch.id = bestCombinedMatch.fmoviesId;
        delete bestCombinedMatch.fmoviesId;
        
        await redisClient.set(cacheKey, JSON.stringify(bestCombinedMatch), { EX: 86400 });
        logger.info(`[SUCCESS] Responding with best match: ${bestCombinedMatch.title}`);
        res.json(bestCombinedMatch);
    } catch (error) {
        logger.error('Error in /search endpoint', { message: error.message, stack: error.stack });
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});

app.get('/stream', apiKeyMiddleware, checkJwt, async (req, res) => {
    logger.info(`Stream request received from user: ${req.auth.payload.sub}`);
    const { id, type } = req.query;
    if (!id || !type) return res.status(400).json({ error: 'ID and type are required.' });
    if (type !== 'movie' && type !== 'tv') return res.status(400).json({ error: "Type must be 'movie' or 'tv'."});
    
    try {
        const streamData = await streamService.getStreamData(id, type);
        res.json(streamData);
    } catch (error) {
        logger.error(`Error in /stream endpoint for ID ${id}`, { message: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Apply protection to the rest of the endpoints
app.get('/seasons', apiKeyMiddleware, checkJwt, async (req, res) => {
    // ... (rest of the function is unchanged)
    const { showId } = req.query;
    if (!showId) return res.status(400).json({ error: 'showId is required.' });

    const cacheKey = `seasons-${showId}`;
    const cachedString = await redisClient.get(cacheKey);
    if (cachedString) {
        logger.info(`Cache HIT for seasons key: ${cacheKey}.`);
        return res.json(JSON.parse(cachedString));
    }

    try {
        const seasons = await fmoviesService.getSeasons(showId);
        await redisClient.set(cacheKey, JSON.stringify(seasons), { EX: 86400 });
        logger.info(`[SUCCESS] Found ${seasons.length} seasons for showId: ${showId}`);
        res.json(seasons);
    } catch (error) {
        logger.error(`Error in /seasons for showId ${showId}`, { message: error.message });
        res.status(500).json({ error: 'Failed to fetch seasons.' });
    }
});

app.get('/episodes', apiKeyMiddleware, checkJwt, async (req, res) => {
    // ... (rest of the function is unchanged)
    const { seasonId } = req.query;
    if (!seasonId) return res.status(400).json({ error: 'seasonId is required.' });
    
    const cacheKey = `episodes-${seasonId}`;
    const cachedString = await redisClient.get(cacheKey);
    if (cachedString) {
        logger.info(`Cache HIT for episodes key: ${cacheKey}.`);
        return res.json(JSON.parse(cachedString));
    }

    try {
        const episodes = await fmoviesService.getEpisodes(seasonId);
        await redisClient.set(cacheKey, JSON.stringify(episodes), { EX: 86400 });
        logger.info(`[SUCCESS] Found ${episodes.length} episodes for seasonId: ${seasonId}`);
        res.json(episodes);
    } catch (error) {
        logger.error(`Error in /episodes for seasonId ${seasonId}`, { message: error.message });
        res.status(500).json({ error: 'Failed to fetch episodes.' });
    }
});

app.post('/download', apiKeyMiddleware, checkJwt, (req, res) => {
    // ... (rest of the function is unchanged)
    const { streamUrl, downloadPath, title, refererUrl } = req.body;
    if (!streamUrl || !downloadPath || !title || !refererUrl) {
        return res.status(400).json({ error: 'streamUrl, downloadPath, title, and refererUrl are required.' });
    }
    const safeTitle = title.replace(/[^a-z0-9\-_\. ]/gi, '_');
    const outputPath = path.join(downloadPath, `${safeTitle}.mp4`);
    
    const args = [
        '--referer', refererUrl,
        '--user-agent', config.BROWSER_HEADERS['User-Agent'],
        '-f', 'best',
        '--allow-unplayable-formats',
        '-o', outputPath,
        streamUrl
    ];
    
    const ytdlp = spawn('yt-dlp', args);
    
    logger.info(`--- New Download Request: ${title} ---`, { args });

    ytdlp.stdout.on('data', (data) => logger.info(`[yt-dlp] ${data.toString().trim()}`));
    ytdlp.stderr.on('data', (data) => logger.error(`[yt-dlp ERROR] ${data.toString().trim()}`));
    ytdlp.on('close', (code) => {
        logger.info(`Download for "${title}" finished with code ${code}.`);
    });
    
    res.status(202).json({ message: `Download started for "${title}". Check server logs for progress.` });
});


app.listen(config.PORT, () => {
    logger.info(`PlumeNest Personal API server is listening on http://localhost:${config.PORT}`);
});