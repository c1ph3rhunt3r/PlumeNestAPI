const express = require('express');
const cors = require('cors');
const config = require('./config');
const logger = require('./config/logger');
const { redisClient } = require('./services/cache');
const fmoviesService = require('./services/fmovies');
const tmdbService = require('./services/tmdb');
const streamService = require('./services/stream');
const supabase = require('./services/database');
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

const timeout = (ms, promise) => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Operation timed out after ${ms}ms`));
        }, ms);
        promise.then(value => { clearTimeout(timer); resolve(value); })
               .catch(reason => { clearTimeout(timer); reject(reason); });
    });
};
app.get('/health', async (req, res) => {
    try {
        const redisPing = await timeout(2000, redisClient.ping());
        if (redisPing !== 'PONG') throw new Error('Redis did not respond correctly.');
        res.status(200).json({ status: 'ok', dependencies: { redis: 'connected' } });
    } catch (error) {
        logger.error('Health check failed!', { message: error.message });
        res.status(503).json({ status: 'error', dependencies: { redis: 'disconnected' }, error: error.message });
    }
});

// --- API VERSION 1 ROUTER ---
const apiV1Router = express.Router();

// Apply the security middleware to all v1 routes
apiV1Router.use(apiKeyMiddleware);
apiV1Router.use(checkJwt);

// --- NEW DEDICATED USER SYNC ENDPOINT ---
apiV1Router.post('/users/sync', async (req, res) => {
    const auth0UserId = req.auth.payload.sub;
    logger.info(`Sync request received for Auth0 ID: ${auth0UserId}`);

    try {
        let { data: user, error: selectError } = await supabase
            .from('users')
            .select('*')
            .eq('auth0_user_id', auth0UserId)
            .single();

        if (selectError && selectError.code !== 'PGRST116') { // Ignore "0 rows" error
            throw selectError;
        }

        if (!user) {
            logger.info(`User not found. Creating new profile for Auth0 ID: ${auth0UserId}`);
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert([{ auth0_user_id: auth0UserId }])
                .select()
                .single();
            
            if (insertError) throw insertError;
            user = newUser;
            res.status(201).json({ status: 'created', user });
        } else {
            logger.info(`User already exists. Profile sync successful for Auth0 ID: ${auth0UserId}`);
            res.status(200).json({ status: 'ok', user });
        }
    } catch (error) {
        logger.error('Failed to sync user with database', { auth0_id: auth0UserId, message: error.message });
        res.status(500).json({ error: 'Database user synchronization failed.' });
    }
});

// --- CORE API ENDPOINTS ---
// The user sync middleware has been removed from here.
// These endpoints now assume the user has already been synced.

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
    
    try {
        const fmoviesCandidates = await fmoviesService.searchContent(title);
        // ... (rest of the search logic is unchanged)
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
        res.json(episodes);
    } catch (error) {
        logger.error(`Error in /episodes for seasonId ${seasonId}`, { message: error.message });
        res.status(500).json({ error: 'Failed to fetch episodes.' });
    }
});

// Mount the versioned router to the main app
app.use('/api/v1', apiV1Router);

// --- START SERVER ---
app.listen(config.PORT, () => {
    logger.info(`PlumeNest Personal API server is listening on http://localhost:${config.PORT}`);
});