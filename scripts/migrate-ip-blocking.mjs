import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('begin');
  const database = await client.query('select current_database() as name');
  if (database.rows[0]?.name !== 'soyal') throw new Error('IP schema migration requires the soyal database');
  const sql = await readFile(new URL('../database/ip-blocking.sql', import.meta.url), 'utf8');
  await client.query(sql);
  await client.query('commit');
  process.stdout.write('BOSS IP wildcard schema is ready.\n');
} catch (error) {
  await client.query('rollback').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
