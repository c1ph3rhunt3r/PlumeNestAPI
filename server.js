const express = require('express');
const cors = require('cors');
const config = require('./config');
const logger = require('./config/logger');
const { redisClient } = require('./services/cache');
const { auth } = require('express-oauth2-jwt-bearer');

// --- IMPORT ROUTE FILES ---
const contentRoutes = require('./routes/content');
const userRoutes = require('./routes/users');

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

// --- GLOBAL MIDDLEWARE SETUP ---
app.use(cors());
app.use(express.json());

// --- PUBLIC API ENDPOINTS ---
app.get('/', (req, res) => res.send('PlumeNest Personal API is running!'));

const timeout = (ms, promise) => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error(`Operation timed out after ${ms}ms`)); }, ms);
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

// --- MOUNT THE VERSION 1 ROUTER ---
const apiV1Router = express.Router();

// Apply security middleware to the entire v1 router
apiV1Router.use(apiKeyMiddleware);
apiV1Router.use(checkJwt);

// Use the imported route files
apiV1Router.use('/', contentRoutes); // Mounts /search, /stream, etc.
apiV1Router.use('/users', userRoutes); // Mounts /users/sync

// Mount the main v1 router to the app
app.use('/api/v1', apiV1Router);

// --- START SERVER ---
app.listen(config.PORT, () => {
    logger.info(`PlumeNest Personal API server is listening on http://localhost:${config.PORT}`);
});