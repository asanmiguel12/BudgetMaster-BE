const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PROJECT_REF = 'bcnncqkclexvmlpuogxo';

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    throw new Error('Missing SUPABASE_DB_PASSWORD or DATABASE_URL');
  }

  return `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
}

const pool = new Pool({
  connectionString: getDatabaseUrl(),
  ssl: { rejectUnauthorized: false },
});

async function testDatabaseConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

async function ensureFrontendSchema() {
  const migrationsDir = path.join(__dirname, '../src/db/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await pool.query(sql);
  }
}

module.exports = { pool, testDatabaseConnection, ensureFrontendSchema };
