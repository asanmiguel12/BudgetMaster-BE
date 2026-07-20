const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,  // service-role bypasses RLS for server-side ops
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Validate connection at startup
async function testConnection() {
  const { error } = await supabase.from('users').select('id').limit(1);
  if (error && error.code !== 'PGRST116') { // PGRST116 = table empty, that's fine
    logger.error('Supabase connection error', { error: error.message });
    process.exit(1);
  }
  logger.info('Supabase connected');
}

module.exports = { supabase, testConnection };
