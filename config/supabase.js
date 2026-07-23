const { createClient } = require('@supabase/supabase-js');
const logger = require('../src/utils/logger');

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://localhost',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing-service-role-key',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Validate connection at startup
async function testConnection() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.warn('SUPABASE_SERVICE_ROLE_KEY not set — Plaid/auth DB routes disabled until configured');
    return;
  }

  const { error } = await supabase.from('users').select('id').limit(1);
  if (error && error.code !== 'PGRST116') { // PGRST116 = table empty, that's fine
    logger.error('Supabase connection error', { error: error.message });
    process.exit(1);
  }
  logger.info('Supabase connected');
}

module.exports = { supabase, testConnection };
