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

// --- 1. IMPORT AUTH0 MIDDLEWARE ---
const { auth } = require('express-oauth2-jwt-bearer');

const app = express();

// --- 2. CONFIGURE THE JWT CHECK ---
const checkJwt = auth({
  audience: config.AUTH0_AUDIENCE, // The Identifier of your API in Auth0
  issuerBaseURL: config.AUTH0_ISSUER_BASE_URL, // The "Issuer Base URL" from your API settings in Auth0
});

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- API ENDPOINTS ---

// --- API ENDPOINTS ---
app.get('/', (req, res) => res.send('PlumeNest Personal API is running!'));

// --- UPDATED /search ENDPOINT WITH PARALLEL REQUESTS ---
app.get('/search', checkJwt, async (req, res) => {
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
        // Step 1: Get the initial candidates from fmovies (this is still a single request)
        const fmoviesCandidates = await fmoviesService.searchContent(title);
        if (!fmoviesCandidates || fmoviesCandidates.length === 0) {
            return res.status(404).json({ error: 'Content not found.' });
        }
        
        // Step 2: Create an array of promises, where each promise is a TMDb metadata lookup.
        // This part does not wait; it just prepares all the requests.
        const metadataPromises = fmoviesCandidates.map(candidate => 
            tmdbService.getTmdbMetadata(candidate.title, candidate.type, candidate.year)
                       .then(tmdbData => {
                           // Combine the original fmovies data with the new TMDb data for each candidate
                           return { ...candidate, ...tmdbData };
                       })
        );

        // Step 3: Execute all the TMDb lookups at the same time and wait for them all to complete.
        // This is the key performance improvement.
        const enrichedCandidates = await Promise.all(metadataPromises);

        // Step 4: Now that we have all the data, loop through the results to find the best match.
        // This part is the same as before, but it's now working with the fully enriched data.
        let bestCombinedMatch = null;
        let bestScore = -1;

        for (const candidate of enrichedCandidates) {
            // Only score candidates that successfully got a tmdbId
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

        // Fallback logic if no good match was found
        if (!bestCombinedMatch) {
            logger.warn('No strong match found after enrichment, falling back to the first fmovies result.');
            // We use enrichedCandidates[0] which will have whatever TMDb data it managed to get (if any).
            bestCombinedMatch = enrichedCandidates[0];
        }
        
        if (!bestCombinedMatch || !bestCombinedMatch.fmoviesId) {
             return res.status(404).json({ error: 'Could not find a reliable match.' });
        }
        
        bestCombinedMatch.id = bestCombinedMatch.fmoviesId;
        delete bestCombinedMatch.fmoviesId;
        
        await redisClient.set(cacheKey, JSON.stringify(bestCombinedMatch), { EX: 86400 }); // Cache for 24 hours
        logger.info(`[SUCCESS] Responding with best match: ${bestCombinedMatch.title}`);
        res.json(bestCombinedMatch);

    } catch (error) {
        logger.error('Error in /search endpoint', { message: error.message, stack: error.stack });
        res.status(500).json({ error: 'An internal server error occurred during search.' });
    }
});


app.get('/stream', checkJwt, async (req, res) => {
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

app.get('/seasons', checkJwt, async (req, res) => {
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

app.get('/episodes', checkJwt, async (req, res) => {
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

app.post('/download', checkJwt, (req, res) => {
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