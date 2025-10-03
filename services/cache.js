const redis = require('redis');
const { REDIS_URL } = require('../config');
const logger = require('../config/logger');

// Create the Redis client
const redisClient = redis.createClient({
    url: REDIS_URL
});

redisClient.on('error', (err) => {
    logger.error('Redis Client Error', err);
});

// Immediately connect to Redis.
// We use an IIFE (Immediately Invoked Function Expression) to handle the async connection.
(async () => {
    try {
        await redisClient.connect();
        logger.info('Successfully connected to Redis.');
    } catch (err) {
        logger.error('Failed to connect to Redis.', err);
    }
})();

module.exports = { redisClient };