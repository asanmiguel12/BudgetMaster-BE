const { pool } = require('../../config/database');

async function createProfile({ client_user_id, full_name, email, currency, timezone, avatar_url }) {
  const { rows } = await pool.query(
    `INSERT INTO public.app_user_profiles (
       client_user_id, full_name, email, currency, timezone, avatar_url, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (client_user_id)
     DO UPDATE SET
       full_name = EXCLUDED.full_name,
       email = EXCLUDED.email,
       currency = EXCLUDED.currency,
       timezone = EXCLUDED.timezone,
       avatar_url = EXCLUDED.avatar_url,
       updated_at = NOW()
     RETURNING *`,
    [
      client_user_id,
      full_name,
      email || null,
      currency || 'USD',
      timezone || 'America/Los_Angeles',
      avatar_url || null,
    ]
  );
  return rows[0];
}

async function getProfile(clientUserId) {
  const { rows } = await pool.query(
    `SELECT * FROM public.app_user_profiles WHERE client_user_id = $1`,
    [clientUserId]
  );
  return rows[0] || null;
}

module.exports = { createProfile, getProfile };
