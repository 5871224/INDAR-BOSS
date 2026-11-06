import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { createServer, normalizeIpState } from '../server.mjs'

const sample = { entries: [{ ip: '001.2.3.4', time: '2025/1/2' }], exclusions: ['8.8.8.8'], threshold: 4, revision: 0 }
test('validates and normalizes shared IP data before acquiring a database connection', () => {
  assert.equal(normalizeIpState(sample).entries[0].ip, '1.2.3.4')
  assert.throws(() => normalizeIpState({ ...sample, exclusions: ['1.2.3.4', '001.2.3.4'] }), /重複/)
  assert.throws(() => normalizeIpState({ ...sample, entries: [{ ip: '999.2.3.4', time: '' }] }), /無效/)
  assert.throws(() => normalizeIpState({ ...sample, revision: -1 }), /格式/)
})

test('the shared IP API enforces authorization before database access', async t => {
  let queried = false
  const server = createServer({ pool: { query() { queried = true } }, authorize: async () => { throw Object.assign(new Error('AUTH_REQUIRED'), { statusCode: 401 }) } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close())
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ip-state`)
  assert.equal(response.status, 401); assert.equal(queried, false)
})

test('real PostgreSQL stores both lists atomically and rejects stale updates', { skip: !process.env.TEST_IP_DATABASE_URL }, async t => {
  const admin = new Pool({ connectionString: process.env.TEST_IP_DATABASE_URL })
  const database = `codex_ip_test_${process.pid}_${Date.now()}`
  await admin.query(`create database "${database}"`)
  const temporaryUrl = new URL(process.env.TEST_IP_DATABASE_URL); temporaryUrl.pathname = `/${database}`
  const pool = new Pool({ connectionString: temporaryUrl.toString() })
  t.after(async () => { await pool.end(); await admin.query(`drop database "${database}"`); await admin.end() })
  await pool.query(await readFile(new URL('../database/ip-blocking.sql', import.meta.url), 'utf8'))
  const server = createServer({ pool, authorize: async () => ({ id: 'test' }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close())
  const url = `http://127.0.0.1:${server.address().port}/api/ip-state`
  const get = async () => (await (await fetch(url)).json()).data
  const put = data => fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
  assert.deepEqual(await get(), { threshold: 4, revision: 0, entries: [], exclusions: [] })
  const responses = await Promise.all([put(sample), put({ ...sample, exclusions: ['9.9.9.9'] })])
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409])
  const saved = await get(); assert.equal(saved.revision, 1); assert.equal(saved.entries[0].ip, '1.2.3.4'); assert.equal(saved.exclusions.length, 1)
  const invalid = await put({ ...saved, entries: [{ ip: '1.2.3.4', time: 'invalid' }] }); assert.equal(invalid.status, 400)
  assert.deepEqual(await get(), saved)
  await pool.query(`create function fail_ip_insert() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$; create trigger fail_ip_insert before insert on public.ip_exclusions for each row execute function fail_ip_insert()`)
  const failed = await put({ ...saved, entries: [{ ip: '4.4.4.4', time: '' }], exclusions: ['7.7.7.7'] })
  assert.equal(failed.status, 500); assert.deepEqual(await get(), saved)
})
