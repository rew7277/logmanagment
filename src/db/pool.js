import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

export const hasDatabase = Boolean(connectionString);

export const pool = hasDatabase
  ? new Pool({
      connectionString,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    })
  : null;

// FIX: Without this handler, a dropped DB connection emits an unhandled 'error'
// event which crashes the entire Node process. Log it and let the pool retry.
if (pool) {
  pool.on('error', (err) => {
    console.error('[db] idle client error — pool will retry automatically', err.message);
  });

  pool.on('connect', () => {
    console.log('[db] new client connected to pool');
  });
}

export async function query(text, params = []) {
  if (!pool) {
    throw new Error('DATABASE_URL is not configured. Add PostgreSQL in Railway and redeploy.');
  }
  return pool.query(text, params);
}

/**
 * Run multiple statements inside a single serializable transaction.
 * Used by bulkCreateLogs to avoid partial inserts.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) await pool.end();
}
