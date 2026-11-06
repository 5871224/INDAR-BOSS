import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const DEFAULT_PORT = 3070
const MAX_BODY_BYTES = 1024 * 1024
const SCHED_API_BASE = String(process.env.SCHED_API_BASE || 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '')
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

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

function sessionCookie(request) {
  const match = String(request.headers.cookie || '').match(/(?:^|;\s*)indar_session=([^;]+)/)
  if (!match) return ''
  try { return decodeURIComponent(match[1]) } catch { return '' }
}

function isActiveEmployee(profile) {
  const value = profile && typeof profile === 'object' ? profile : {}
  if (value.deleted_at) return false
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
  if (value.hire_date && String(value.hire_date).slice(0, 10) > today) return false
  if (value.leave_date && String(value.leave_date).slice(0, 10) < today) return false
  return true
}

async function callSched(path, request, body) {
  const cookie = sessionCookie(request)
  if (!cookie) throw new HttpError(401, 'AUTH_REQUIRED', '請先登入班表帳號')
  let response
  try {
    response = await fetch(`${SCHED_API_BASE}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: `indar_session=${encodeURIComponent(cookie)}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000)
    })
  } catch {
    throw new HttpError(503, 'SCHED_UNAVAILABLE', '班表系統暫時無法驗證登入')
  }
  const value = await response.json().catch(() => ({}))
  if (!response.ok) {
    const status = response.status === 401 ? 401 : response.status === 403 ? 403 : 503
    const code = response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'SCHED_PERMISSION_DENIED' : 'SCHED_UNAVAILABLE'
    throw new HttpError(status, code, value.error?.message || '班表系統無法完成權限驗證')
  }
  return value
}

async function readIndarActor(request) {
  const [context, bundle] = await Promise.all([
    callSched('auth/context', request),
    callSched('access/bundle', request)
  ])
  const actor = bundle.actor && typeof bundle.actor === 'object' ? bundle.actor : {}
  const profile = context.profile && typeof context.profile === 'object' ? context.profile : {}
  const id = String(actor.id || context.user?.id || '')
  if (!id || !isActiveEmployee(profile)) throw new HttpError(403, 'ACCOUNT_INACTIVE', '此帳號目前無法使用 BOSS')
  return {
    id,
    code: String(actor.employeeCode || profile.employee_code || ''),
    name: String(actor.fullName || profile.full_name || ''),
    permissions: Array.isArray(actor.permissions) ? actor.permissions : []
  }
}

async function requireSoyalAccess(request, pool) {
  const actor = await readIndarActor(request)
  const result = await pool.query('select 1 from public.soyal_access where employee_id = $1::uuid', [actor.id])
  if (!result.rowCount) throw new HttpError(403, 'SOYAL_ACCESS_REQUIRED', '此帳號尚未開放使用 BOSS')
  return actor
}

async function requireSoyalAdmin(request) {
  const actor = await readIndarActor(request)
  if (!actor.permissions.includes('permission_settings')) {
    throw new HttpError(403, 'SOYAL_ADMIN_REQUIRED', '需要班表系統管理權限')
  }
  return actor
}

async function readEmployeeDirectory(request) {
  const rows = await callSched('members', request, { action: 'get_employee_admin_directory_v3' })
  if (!Array.isArray(rows)) throw new HttpError(503, 'DIRECTORY_UNAVAILABLE', '無法讀取班表員工名單')
  return rows.filter(isActiveEmployee).map(row => ({
    id: String(row.id),
    code: String(row.employee_code || ''),
    name: String(row.full_name || '')
  })).filter(row => UUID_PATTERN.test(row.id) && row.code && row.name)
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
  if (error instanceof HttpError) return error.message
  return ({
    TYPE_INVALID: '設定類型不正確',
    DATA_INVALID: '資料格式不正確',
    NUMBER_INVALID: '代碼必須是非負整數',
    NAME_INVALID: '名稱不可空白且最多 200 字',
    JSON_INVALID: 'JSON 格式不正確',
    BODY_TOO_LARGE: '請求內容過大',
    ID_INVALID: '資料 ID 不正確',
    AUTH_REQUIRED: '請先登入班表帳號',
    SOYAL_ACCESS_REQUIRED: '此帳號尚未開放使用 BOSS',
    SOYAL_ADMIN_REQUIRED: '需要班表系統管理權限',
    ACCESS_LIST_INVALID: 'BOSS 權限名單不正確，請重新整理後再試',
    SCHED_UNAVAILABLE: '班表系統暫時無法驗證登入',
    DIRECTORY_UNAVAILABLE: '無法讀取班表員工名單'
  })[error.message] || '設定 API 發生錯誤'
}

async function handleAccess(request, response, pool, { authorizeAccess, authorizeAdmin, directory }) {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  if (url.pathname === '/api/access') {
    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET')
      return sendJson(response, 405, { error: '不支援的 HTTP 方法' })
    }
    const actor = await authorizeAccess(request, pool)
    return sendJson(response, 200, { allowed: true, user: { id: actor.id, code: actor.code, name: actor.name } })
  }
  if (url.pathname !== '/api/admin/access') return sendJson(response, 404, { error: '找不到 API' })
  const actor = await authorizeAdmin(request, pool)
  if (request.method === 'GET') {
    const result = await pool.query('select employee_id as id, employee_code as code, employee_name as name from public.soyal_access order by employee_code, employee_name')
    let employees = []
    let directoryError = ''
    try { employees = await directory(request) } catch (error) {
      if (error.statusCode === 403) directoryError = '此帳號沒有班表「成員設定」權限，無法讀取員工名單'
      else throw error
    }
    return sendJson(response, 200, { access: result.rows, employees, directoryError })
  }
  if (request.method !== 'POST') {
    response.setHeader('allow', 'GET, POST')
    return sendJson(response, 405, { error: '不支援的 HTTP 方法' })
  }
  const body = await readJson(request)
  const ids = body.ids
  if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => typeof id !== 'string' || !UUID_PATTERN.test(id)) || new Set(ids).size !== ids.length) {
    throw Object.assign(new Error('ACCESS_LIST_INVALID'), { statusCode: 400 })
  }
  const employees = await directory(request)
  const byId = new Map(employees.map(employee => [employee.id, employee]))
  const selected = ids.map(id => byId.get(id)).filter(Boolean)
  if (selected.length !== ids.length) throw Object.assign(new Error('ACCESS_LIST_INVALID'), { statusCode: 400 })

  await pool.query('begin')
  try {
    await pool.query('delete from public.soyal_access where not (employee_id = any($1::uuid[]))', [ids])
    for (const employee of selected) {
      await pool.query(
        `insert into public.soyal_access (employee_id, employee_code, employee_name, updated_at)
         values ($1::uuid, $2, $3, now())
         on conflict (employee_id) do update set employee_code = excluded.employee_code, employee_name = excluded.employee_name, updated_at = now()`,
        [employee.id, employee.code, employee.name]
      )
    }
    await pool.query('commit')
  } catch (error) {
    await pool.query('rollback').catch(() => {})
    throw error
  }
  console.log('soyal access updated', JSON.stringify({ by: actor.code, count: selected.length }))
  return sendJson(response, 200, { access: selected })
}

async function handleSettings(request, response, pool, options) {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  if (url.pathname === '/health' && request.method === 'GET') {
    await pool.query('select 1')
    return sendJson(response, 200, { ready: true })
  }
  if (url.pathname === '/api/access' || url.pathname === '/api/admin/access') return handleAccess(request, response, pool, options)
  if (url.pathname !== '/api/settings') return sendJson(response, 404, { error: '找不到 API' })

  await options.authorize(request, pool)

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

export async function authorizeRequest(request, pool) {
  return requireSoyalAccess(request, pool)
}

export function createServer({
  pool = createPool(),
  authorize = authorizeRequest,
  authorizeAccess = authorize,
  authorizeAdmin = requireSoyalAdmin,
  directory = readEmployeeDirectory
} = {}) {
  const options = { authorize, authorizeAccess, authorizeAdmin, directory }
  return http.createServer(async (request, response) => {
    try {
      await handleSettings(request, response, pool, options)
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
