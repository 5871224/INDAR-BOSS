import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const DEFAULT_PORT = 3070
const MAX_BODY_BYTES = 1024 * 1024

const definitions = Object.freeze({
  doors: Object.freeze({ table: 'door_settings', key: 'door_no', name: 'door_name' }),
  users: Object.freeze({ table: 'user_settings', key: 'user_address', name: 'user_name' })
})

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

export function createPool(env = process.env) {
  const connectionString = String(env.DATABASE_URL || '').trim()
  if (!connectionString) throw new Error('DATABASE_URL_REQUIRED')
  const max = Math.max(1, Number(env.PGPOOL_MAX || 5) || 5)
  const idleTimeoutMillis = Math.max(1000, Number(env.PG_IDLE_TIMEOUT_MS || 30000) || 30000)
  const connectionTimeoutMillis = Math.max(1000, Number(env.PG_CONNECTION_TIMEOUT_MS || 10000) || 10000)
  return new Pool({
    connectionString,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    ssl: parseBoolean(env.POSTGRES_SSL, false)
      ? { rejectUnauthorized: parseBoolean(env.POSTGRES_SSL_REJECT_UNAUTHORIZED, true) }
      : false
  })
}

export function getDefinition(type) {
  const definition = definitions[type]
  if (!definition) throw new Error('TYPE_INVALID')
  return definition
}

export function normalizeData(type, value) {
  const definition = getDefinition(type)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DATA_INVALID')
  const number = Number(value[definition.key])
  const name = String(value[definition.name] ?? '').trim()
  if (!Number.isInteger(number) || number < 0) throw new Error('NUMBER_INVALID')
  if (!name || name.length > 200) throw new Error('NAME_INVALID')
  return { [definition.key]: number, [definition.name]: name }
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('BODY_TOO_LARGE'), { statusCode: 413 })
    chunks.push(chunk)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('JSON_INVALID'), { statusCode: 400 })
  }
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload)
  })
  response.end(payload)
}

function errorMessage(error) {
  return ({
    TYPE_INVALID: '設定類型不正確',
    DATA_INVALID: '資料格式不正確',
    NUMBER_INVALID: '代碼必須是非負整數',
    NAME_INVALID: '名稱不可空白且最多 200 字',
    JSON_INVALID: 'JSON 格式不正確',
    BODY_TOO_LARGE: '請求內容過大',
    ID_INVALID: '資料 ID 不正確'
  })[error.message] || '設定 API 發生錯誤'
}

async function handleSettings(request, response, pool) {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  if (url.pathname === '/health' && request.method === 'GET') {
    await pool.query('select 1')
    return sendJson(response, 200, { ready: true })
  }
  if (url.pathname !== '/api/settings') return sendJson(response, 404, { error: '找不到 API' })

  const body = request.method === 'GET' ? {} : await readJson(request)
  const type = request.method === 'GET' ? url.searchParams.get('type') : body.type
  const definition = getDefinition(type)
  const table = `public.${definition.table}`
  const columns = `id, ${definition.key}, ${definition.name}`

  if (request.method === 'GET') {
    const result = await pool.query(`select ${columns} from ${table} order by ${definition.key}, id`)
    return sendJson(response, 200, { data: result.rows })
  }

  if (!['POST', 'PUT', 'DELETE'].includes(request.method)) {
    response.setHeader('allow', 'GET, POST, PUT, DELETE')
    return sendJson(response, 405, { error: '不支援的 HTTP 方法' })
  }

  if (request.method === 'DELETE') {
    const id = Number(body.id)
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('ID_INVALID'), { statusCode: 400 })
    const result = await pool.query(`delete from ${table} where id = $1 returning ${columns}`, [id])
    if (!result.rowCount) return sendJson(response, 404, { error: '資料不存在' })
    return sendJson(response, 200, { data: result.rows[0] })
  }

  const data = normalizeData(type, body.data)
  if (request.method === 'POST') {
    const result = await pool.query(
      `insert into ${table} (${definition.key}, ${definition.name}) values ($1, $2)
       on conflict (${definition.key}) do update set ${definition.name} = excluded.${definition.name}, updated_at = now()
       returning ${columns}`,
      [data[definition.key], data[definition.name]]
    )
    return sendJson(response, 200, { data: result.rows[0] })
  }

  const id = Number(body.id)
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('ID_INVALID'), { statusCode: 400 })
  const result = await pool.query(
    `update ${table} set ${definition.key} = $1, ${definition.name} = $2, updated_at = now()
     where id = $3 returning ${columns}`,
    [data[definition.key], data[definition.name], id]
  )
  if (!result.rowCount) return sendJson(response, 404, { error: '資料不存在' })
  return sendJson(response, 200, { data: result.rows[0] })
}

export function createServer({ pool = createPool() } = {}) {
  return http.createServer(async (request, response) => {
    try {
      await handleSettings(request, response, pool)
    } catch (error) {
      const statusCode = Number(error.statusCode) || (error.code === '23505' ? 409 : 500)
      if (statusCode >= 500) console.error(error)
      sendJson(response, statusCode, { error: errorMessage(error) })
    }
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Math.max(1, Number(process.env.PORT || DEFAULT_PORT) || DEFAULT_PORT)
  const pool = createPool()
  const server = createServer({ pool })
  server.listen(port, '127.0.0.1', () => console.log(`INDAR-SOYAL API listening on 127.0.0.1:${port}`))
  const shutdown = async () => {
    server.close()
    await pool.end()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
