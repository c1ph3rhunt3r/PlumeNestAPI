const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('../config');
const logger = require('../config/logger');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    logger.error('Supabase URL or Anon Key is not defined in the environment variables.');
    throw new Error('Supabase configuration is missing.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

module.exports = supabase;