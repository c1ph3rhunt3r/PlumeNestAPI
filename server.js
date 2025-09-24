const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const config = require('./config');
const { metadataCache } = require('./services/cache');
const fmoviesService = require('./services/fmovies');
const tmdbService = require('./services/tmdb');
const streamService = require('./services/stream');

const app = express();

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- API ENDPOINTS ---
app.get('/', (req, res) => res.send('PlumeNest Personal API is running!'));

app.get('/search', async (req, res) => {
    const { title, type } = req.query;
    if (!title) return res.status(400).json({ error: 'Title query parameter is required.' });

    const cacheKey = `search-${type || 'any'}-${title.trim().toLowerCase()}`;
    const cachedData = metadataCache.get(cacheKey);
    if (cachedData) {
        console.log(`[LOG] Cache HIT for search key: ${cacheKey}.`);
        return res.json(cachedData);
    }
    console.log(`[LOG] Cache MISS for search key: ${cacheKey}.`);

    try {
        const fmoviesCandidates = await fmoviesService.searchContent(title);
        if (!fmoviesCandidates || fmoviesCandidates.length === 0) {
            return res.status(404).json({ error: 'Content not found.' });
        }
        
        let bestCombinedMatch = null;
        let bestScore = -1;

        for (const fmoviesCandidate of fmoviesCandidates) {
            const tmdbData = await tmdbService.getTmdbMetadata(fmoviesCandidate.title, fmoviesCandidate.type, fmoviesCandidate.year);
            let currentScore = 0;
            if (tmdbData) {
                if (fmoviesCandidate.title.toLowerCase() === title.toLowerCase()) currentScore += 10;
                if (type && fmoviesCandidate.type === type.toLowerCase()) currentScore += 5;
                currentScore += 1;
                if (currentScore > bestScore) {
                    bestScore = currentScore;
                    bestCombinedMatch = { ...fmoviesCandidate, ...tmdbData };
                }
            }
        }

        if (!bestCombinedMatch) {
            const firstFmoviesResult = fmoviesCandidates[0];
            const fallbackMetadata = await tmdbService.getTmdbMetadata(firstFmoviesResult.title, firstFmoviesResult.type, firstFmoviesResult.year);
            bestCombinedMatch = { ...firstFmoviesResult, ...fallbackMetadata };
        }
        
        if (!bestCombinedMatch || !bestCombinedMatch.fmoviesId) {
             return res.status(404).json({ error: 'Could not find a reliable match.' });
        }
        
        bestCombinedMatch.id = bestCombinedMatch.fmoviesId;
        delete bestCombinedMatch.fmoviesId;
        
        metadataCache.set(cacheKey, bestCombinedMatch);
        console.log(`[SUCCESS] Responding with best match: ${bestCombinedMatch.title}`);
        res.json(bestCombinedMatch);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/stream', async (req, res) => {
    const { id, type } = req.query;
    if (!id || !type) return res.status(400).json({ error: 'ID and type are required.' });
    if (type !== 'movie' && type !== 'tv') return res.status(400).json({ error: "Type must be 'movie' or 'tv'."});
    try {
        const streamData = await streamService.getStreamData(id, type);
        res.json(streamData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/seasons', async (req, res) => {
    const { showId } = req.query;
    if (!showId) return res.status(400).json({ error: 'showId is required.' });

    const cacheKey = `seasons-${showId}`;
    const cachedData = metadataCache.get(cacheKey);
    if (cachedData) {
        console.log(`[LOG] Cache HIT for seasons key: ${cacheKey}.`);
        return res.json(cachedData);
    }

    try {
        const seasons = await fmoviesService.getSeasons(showId);
        metadataCache.set(cacheKey, seasons);
        console.log(`[SUCCESS] Found ${seasons.length} seasons for showId: ${showId}`);
        res.json(seasons);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch seasons.' });
    }
});

app.get('/episodes', async (req, res) => {
    const { seasonId } = req.query;
    if (!seasonId) return res.status(400).json({ error: 'seasonId is required.' });
    
    const cacheKey = `episodes-${seasonId}`;
    const cachedData = metadataCache.get(cacheKey);
    if (cachedData) {
        console.log(`[LOG] Cache HIT for episodes key: ${cacheKey}.`);
        return res.json(cachedData);
    }

    try {
        const episodes = await fmoviesService.getEpisodes(seasonId);
        metadataCache.set(cacheKey, episodes);
        console.log(`[SUCCESS] Found ${episodes.length} episodes for seasonId: ${seasonId}`);
        res.json(episodes);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch episodes.' });
    }
});

app.post('/download', (req, res) => {
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
    
    console.log(`\n--- New Download Request ---`);
    console.log(`Starting download for: ${title}`);
    console.log(`Command: yt-dlp ${args.join(' ')}`);

    ytdlp.stdout.on('data', (data) => console.log(`[yt-dlp] ${data.toString().trim()}`));
    ytdlp.stderr.on('data', (data) => console.error(`[yt-dlp ERROR] ${data.toString().trim()}`));
    ytdlp.on('close', (code) => {
        console.log(`[SUCCESS] Download for "${title}" finished with code ${code}.`);
    });
    
    res.status(202).json({ message: `Download started for "${title}". Check server logs for progress.` });
});

// --- START SERVER ---
app.listen(config.PORT, () => {
    console.log(`PlumeNest Personal API server is listening on http://localhost:${config.PORT}`);
});