const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { redisClient } = require('../services/cache');
const fmoviesService = require('../services/fmovies');
const streamService = require('../services/stream');

// --- SEARCH ---
router.get('/search', async (req, res) => {
    logger.info(`Search request from user: ${req.auth.payload.sub}`);
    const { title } = req.query;
    if (!title) return res.status(400).json({ error: 'Title query parameter is required.' });

    const cacheKey = `search-list-${title.trim().toLowerCase()}`;
    const cachedString = await redisClient.get(cacheKey);
    if (cachedString) {
        logger.info(`Cache HIT for search list key: ${cacheKey}.`);
        return res.json(JSON.parse(cachedString));
    }
    
    try {
        const searchResults = await fmoviesService.searchContent(title);
        if (searchResults.length === 0) return res.status(404).json({ error: 'Content not found.' });
        
        await redisClient.set(cacheKey, JSON.stringify(searchResults), { EX: 86400 });
        logger.info(`[SUCCESS] Found ${searchResults.length} candidates for "${title}".`);
        res.json(searchResults);
    } catch (error) {
        logger.error('Error in /search endpoint', { message: error.message });
        res.status(500).json({ error: 'An internal server error occurred during search.' });
    }
});

// --- METADATA ---
router.get('/metadata', async (req, res) => {
    logger.info(`Metadata request from user: ${req.auth.payload.sub}`);
    const { id, url } = req.query;
    if (!id || !url) return res.status(400).json({ error: 'fmovies ID and URL are required.' });

    const cacheKey = `metadata-${id}`;
    const cachedString = await redisClient.get(cacheKey);
    if (cachedString) {
        logger.info(`Cache HIT for metadata key: ${cacheKey}.`);
        return res.json(JSON.parse(cachedString));
    }

    try {
        const finalMetadata = await fmoviesService.getMetadata(id, url);
        await redisClient.set(cacheKey, JSON.stringify(finalMetadata), { EX: 86400 });
        logger.info(`[SUCCESS] Fetched metadata for ID: ${id}`);
        res.json(finalMetadata);
    } catch (error) {
        logger.error(`Error in /metadata for ID ${id}`, { message: error.message });
        res.status(500).json({ error: 'Failed to fetch metadata.' });
    }
});

// --- STREAM ---
router.get('/stream', async (req, res) => {
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

// --- TV SHOW HELPERS ---
router.get('/seasons', async (req, res) => {
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

router.get('/episodes', async (req, res) => {
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

module.exports = router;