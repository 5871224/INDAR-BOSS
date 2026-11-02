import { Pool } from 'pg'

const sourceUrl = process.env.SUPABASE_SETTINGS_API || 'https://jblrnncqnrqtzwayxtnw.supabase.co/functions/v1/soyal-settings'
const targetUrl = String(process.env.DATABASE_URL || '').trim()
const expectedDatabase = process.env.SOYAL_DATABASE_NAME || 'soyal'

if (!targetUrl) throw new Error('請設定 DATABASE_URL，且必須指向獨立 soyal database')

async function readSettings(type) {
  const response = await fetch(`${sourceUrl}?type=${encodeURIComponent(type)}`)
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Supabase ${type} 匯出失敗：HTTP ${response.status}`)
  if (!Array.isArray(result.data)) throw new Error(`Supabase ${type} 回傳格式不正確`)
  return result.data
}

function numberValue(value, type) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) throw new Error(`${type} 含有不合法代碼：${value}`)
  return number
}

function nameValue(value, type) {
  const name = String(value ?? '').trim()
  if (!name || name.length > 200) throw new Error(`${type} 含有不合法名稱`)
  return name
}

const pool = new Pool({ connectionString: targetUrl, ssl: false, max: 2 })
try {
  const database = (await pool.query('select current_database() as name')).rows[0].name
  if (database !== expectedDatabase) throw new Error(`安全停止：目前連線到 ${database}，不是 ${expectedDatabase}`)

  const doors = await readSettings('doors')
  const users = await readSettings('users')
  await pool.query('begin')
  for (const row of doors) {
    await pool.query(
      `insert into public.door_settings (door_no, door_name) values ($1, $2)
       on conflict (door_no) do update set door_name = excluded.door_name, updated_at = now()`,
      [numberValue(row.door_no, 'doors'), nameValue(row.door_name, 'doors')]
    )
  }
  for (const row of users) {
    await pool.query(
      `insert into public.user_settings (user_address, user_name) values ($1, $2)
       on conflict (user_address) do update set user_name = excluded.user_name, updated_at = now()`,
      [numberValue(row.user_address, 'users'), nameValue(row.user_name, 'users')]
    )
  }
  await pool.query('commit')
  console.log(`匯入完成：doors=${doors.length}, users=${users.length}, database=${database}`)
} catch (error) {
  await pool.query('rollback').catch(() => {})
  throw error
} finally {
  await pool.end()
}
