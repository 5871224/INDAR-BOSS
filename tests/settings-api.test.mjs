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
  const server = createServer({ pool })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const { port } = server.address()

  const response = await fetch(`http://127.0.0.1:${port}/api/settings?type=doors`)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).data, [{ id: 1, door_no: 3, door_name: '大門' }])
})
