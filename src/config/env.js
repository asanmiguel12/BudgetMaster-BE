const REQUIRED_FOR_AUTH = ['JWT_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'];
const REQUIRED_FOR_DB = ['SUPABASE_URL', 'SUPABASE_DB_PASSWORD'];

function validateEnv() {
  const missing = [];
  const warnings = [];

  for (const key of REQUIRED_FOR_DB) {
    if (!process.env[key]) missing.push(key);
  }

  for (const key of REQUIRED_FOR_AUTH) {
    if (!process.env[key]) warnings.push(key);
  }

  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  return {
    port: parseInt(process.env.PORT, 10) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    supabaseUrl: process.env.SUPABASE_URL,
    allowDevUserHeader: process.env.ALLOW_DEV_USER_HEADER !== 'false',
    authReady: warnings.length === 0,
    warnings,
  };
}

module.exports = { validateEnv };
