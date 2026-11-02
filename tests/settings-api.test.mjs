import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, normalizeData } from '../server.mjs'

test('normalizes the two supported setting types', () => {
  assert.deepEqual(normalizeData('doors', { door_no: '3', door_name: '大門' }), { door_no: 3, door_name: '大門' })
  assert.deepEqual(normalizeData('users', { user_address: 12, user_name: '張三' }), { user_address: 12, user_name: '張三' })
  assert.throws(() => normalizeData('doors', { door_no: -1, door_name: '錯誤' }), /NUMBER_INVALID/)
  assert.throws(() => normalizeData('users', { user_address: 1, user_name: '' }), /NAME_INVALID/)
})

test('serves the settings contract without requiring Supabase', async t => {
  const pool = {
    async query(sql) {
      if (sql.startsWith('select')) return { rows: [{ id: 1, door_no: 3, door_name: '大門' }], rowCount: 1 }
      return { rows: [{ id: 1, door_no: 3, door_name: '大門' }], rowCount: 1 }
    },
    async end() {}
  }
  const server = createServer({ pool, authorize: async () => ({ id: 'test-user' }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const { port } = server.address()

  const response = await fetch(`http://127.0.0.1:${port}/api/settings?type=doors`)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).data, [{ id: 1, door_no: 3, door_name: '大門' }])
})

test('checks the separate SOYAL access list before returning the user identity', async t => {
  const pool = {
    async query() { return { rows: [], rowCount: 1 } },
    async end() {}
  }
  const actor = { id: '11111111-1111-4111-8111-111111111111', code: 'A001', name: '管理員' }
  const server = createServer({ pool, authorizeAccess: async () => actor })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const { port } = server.address()

  const response = await fetch(`http://127.0.0.1:${port}/api/access?check=1`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { allowed: true, user: actor })
})

test('admin can replace the SOYAL access list only with current employees', async t => {
  const queries = []
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params })
      if (sql.startsWith('select employee_id')) return { rows: [], rowCount: 0 }
      return { rows: [], rowCount: 1 }
    },
    async end() {}
  }
  const employee = { id: '22222222-2222-4222-8222-222222222222', code: 'A002', name: 'SOYAL 使用者' }
  const server = createServer({
    pool,
    authorizeAdmin: async () => ({ id: '11111111-1111-4111-8111-111111111111', code: 'ADM', name: '管理員' }),
    directory: async () => [employee]
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const { port } = server.address()

  const response = await fetch(`http://127.0.0.1:${port}/api/admin/access`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [employee.id] })
  })
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).access, [employee])
  assert.ok(queries.some(query => query.sql.startsWith('delete from public.soyal_access')))
  assert.ok(queries.some(query => query.sql.includes('insert into public.soyal_access')))
})
