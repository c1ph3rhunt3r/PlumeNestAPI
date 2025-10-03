const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const supabase = require('../services/database');

// This middleware is specific to this route, so we define it here.
const syncUserMiddleware = async (req, res, next) => {
    const auth0UserId = req.auth.payload.sub;
    logger.info(`Sync request received for Auth0 ID: ${auth0UserId}`);

    try {
        let { data: user, error: selectError } = await supabase
            .from('users')
            .select('*')
            .eq('auth0_user_id', auth0UserId)
            .single();

        if (selectError && selectError.code !== 'PGRST116') throw selectError;

        if (!user) {
            logger.info(`User not found. Creating new profile for Auth0 ID: ${auth0UserId}`);
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert([{ auth0_user_id: auth0UserId }])
                .select()
                .single();
            
            if (insertError) throw insertError;
            user = newUser;
            // Attach the user to the request object and set a flag for the final handler
            req.user = user;
            req.isNewUser = true;
        } else {
            req.user = user;
            req.isNewUser = false;
        }
        next();
    } catch (error) {
        logger.error('Failed to sync user with database', { auth0_id: auth0UserId, message: error.message });
        res.status(500).json({ error: 'Database user synchronization failed.' });
    }
};

router.post('/sync', syncUserMiddleware, async (req, res) => {
    if (req.isNewUser) {
        res.status(201).json({ status: 'created', user: req.user });
    } else {
        logger.info(`User already exists. Profile sync successful for Auth0 ID: ${req.user.auth0_user_id}`);
        res.status(200).json({ status: 'ok', user: req.user });
    }
});

module.exports = router;