require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const PROJECT_REF = 'bcnncqkclexvmlpuogxo';

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    throw new Error(
      'Missing DATABASE_URL or SUPABASE_DB_PASSWORD. ' +
      'Find your password in Supabase Dashboard → Project Settings → Database → Database password.'
    );
  }

  return `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
}

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const migrationPath = path.join(__dirname, 'migrations', '001_app_budget_state.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const migrationSql = fs.existsSync(migrationPath)
    ? fs.readFileSync(migrationPath, 'utf8')
    : '';

  const client = new Client({
    connectionString: getDatabaseUrl(),
    ssl: { rejectUnauthorized: false }
  });

  console.log(`Connecting to Supabase project ${PROJECT_REF}...`);
  await client.connect();

  try {
    console.log('Applying schema.sql...');
    await client.query(schemaSql);

    if (migrationSql) {
      console.log('Applying frontend migration...');
      await client.query(migrationSql);
    }

    console.log('Schema applied successfully.');

    const { rows } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log('Public tables:', rows.map(r => r.table_name).join(', '));
  } finally {
    await client.end();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
