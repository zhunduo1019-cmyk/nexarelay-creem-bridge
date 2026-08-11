import pg from 'pg';
import { config, requireConfig } from './config.js';

const { Pool } = pg;
let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: requireConfig(config().databaseUrl, 'DATABASE_URL'),
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

export async function query(text, values = []) {
  return getPool().query(text, values);
}

export async function withTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) await pool.end();
  pool = undefined;
}
