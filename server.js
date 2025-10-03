const express = require('express');
const cors = require('cors');
// const { spawn } = require('child_process'); <--- REMOVED
// const path = require('path'); <--- REMOVED
const config = require('./config');
const logger = require('./config/logger');
const { redisClient } = require('./services/cache');
const fmoviesService = require('./services/fmovies');
const tmdbService =require('./services/tmdb');
const streamService = require('./services/stream');
const { auth } = require('express-oauth2-jwt-bearer');

const app = express();

// --- AUTHENTICATION MIDDLEWARE ---
const checkJwt = auth({
  audience: config.AUTH0_AUDIENCE,
  issuerBaseURL: config.AUTH0_ISSUER_BASE_URL,
});

const apiKeyMiddleware = (req, res, next) => {
    const providedKey = req.header('X-API-KEY');
    if (!config.API_SECRET_KEY) {
        logger.error("[FATAL] API_SECRET_KEY is not configured.");
        return res.status(500).json({ error: 'Server configuration error.' });
    }
    if (!providedKey || providedKey !== config.API_SECRET_KEY) {
        return res.status(403).json({ error: 'Forbidden: Invalid API Key.' });
    }
    next();
};

// --- MIDDLEWARE SETUP ---
app.use(cors());
app.use(express.json());

// --- PUBLIC API ENDPOINTS ---

app.get('/', (req, res) => res.send('PlumeNest Personal API is running!'));

// --- UPDATED /health ENDPOINT WITH TIMEOUT ---

// Helper function that creates a promise that rejects after a specified time
const timeout = (ms, promise) => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Operation timed out after ${ms}ms`));
        }, ms);

        promise
            .then(value => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch(reason => {
                clearTimeout(timer);
                reject(reason);
            });
    });
};

app.get('/health', async (req, res) => {
    try {
        // We will now "race" the Redis ping against a 2-second timeout.
        logger.info('Performing health check...');
        const redisPing = await timeout(2000, redisClient.ping()); // 2000ms = 2 seconds

        if (redisPing !== 'PONG') {
            throw new Error('Redis did not respond with PONG.');
        }

        logger.info('Health check successful.');
        res.status(200).json({
            status: 'ok',
            dependencies: {
                redis: 'connected'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Health check failed!', { message: error.message });
        res.status(503).json({
            status: 'error',
            dependencies: {
                redis: 'disconnected'
            },
            error: error.message
        });
    }
});

// --- API VERSION 1 ROUTER ---
const apiV1Router = express.Router();

apiV1Router.use(apiKeyMiddleware);
apiV1Router.use(checkJwt);

apiV1Router.get('/search', async (req, res) => {
    logger.info(`Search request from user: ${req.auth.payload.sub}`);
    const { title, type } = req.query;
    if (!title) return res.status(400).json({ error: 'Title is required.' });

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

apiV1Router.get('/stream', async (req, res) => {
    logger.info(`Stream request from user: ${req.auth.payload.sub}`);
    const { id, type } = req.query;
    if (!id || !type) return res.status(400).json({ error: 'ID and type are required.' });
    if (type !== 'movie' && type !== 'tv') return res.status(400).json({ error: "Type must be 'movie' or 'tv'."});
    
    try {
        const streamData = await streamService.getStreamData(id, type);
        res.json(streamData);
    } catch (error) {
        logger.error(`Error in /stream for ID ${id}`, { message: error.message });
        res.status(500).json({ error: error.message });
    }
});

apiV1Router.get('/seasons', async (req, res) => {
    const { showId } = req.query;
    if (!showId) return res.status(400).json({ error: 'showId is required.' });

    const cacheKey = `seasons-${showId}`;
    const cachedString = await redisClient.get(cacheKey);
    if (cachedString) return res.json(JSON.parse(cachedString));

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

apiV1Router.get('/episodes', async (req, res) => {
    const { seasonId } = req.query;
    if (!seasonId) return res.status(400).json({ error: 'seasonId is required.' });
    
    const cacheKey = `episodes-${seasonId}`;
    const cachedString = await redisClient.get(cacheKey);
    if (cachedString) return res.json(JSON.parse(cachedString));

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

// --- THE /download ENDPOINT HAS BEEN REMOVED ---

// Mount the versioned router to the main app
app.use('/api/v1', apiV1Router);

// --- START SERVER ---
app.listen(config.PORT, () => {
    logger.info(`PlumeNest Personal API server is listening on http://localhost:${config.PORT}`);
});