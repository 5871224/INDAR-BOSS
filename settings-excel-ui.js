import { exportDoorExcel, exportUserExcel, importDoorExcel, importUserExcel } from './excel.js';

const SETTINGS_API = './api/settings';
const $ = selector => document.querySelector(selector);

async function request(type, method = 'GET', payload = {}) {
  const url = method === 'GET' ? `${SETTINGS_API}?type=${encodeURIComponent(type)}` : SETTINGS_API;
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (method !== 'GET') options.body = JSON.stringify({ type, ...payload });
  const response = await fetch(url, options);
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok) throw new Error(result.error || `設定 API 錯誤 (${response.status})`);
  return result;
}

function setMessage(selector, text, isError = false) {
  const element = $(selector);
  if (!element) return;
  element.textContent = text;
  element.classList.toggle('error', isError);
}

async function runLimited(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function upsertDoorRows(rows) {
  const current = (await request('doors')).data || [];
  const map = new Map(current.map(row => [String(row.door_no), row]));
  let created = 0, updated = 0, skipped = 0;
  await runLimited(rows, 6, async row => {
    const existing = map.get(String(row.door_no));
    if (existing) {
      if (String(existing.door_name) === row.door_name) { skipped++; return; }
      await request('doors', 'PUT', { id: existing.id, data: row });
      updated++;
    } else {
      await request('doors', 'POST', { data: row });
      created++;
    }
  });
  return { created, updated, skipped };
}

async function upsertUserRows(rows) {
  const current = (await request('users')).data || [];
  const map = new Map(current.map(row => [String(row.user_address), row]));
  let created = 0, updated = 0, skipped = 0;
  await runLimited(rows, 6, async row => {
    const existing = map.get(String(row.user_address));
    if (existing) {
      if (String(existing.user_name) === row.user_name) { skipped++; return; }
      await request('users', 'PUT', { id: existing.id, data: row });
      updated++;
    } else {
      await request('users', 'POST', { data: row });
      created++;
    }
  });
  return { created, updated, skipped };
}

function refreshMainSettings(type) {
  const dialog = $(type === 'doors' ? '#doorSettingsDialog' : '#userSettingsDialog');
  const button = $(type === 'doors' ? '#doorSettingsBtn' : '#userSettingsBtn');
  if (dialog?.open) dialog.close();
  button?.click();
}

$('#doorExportExcel')?.addEventListener('click', async () => {
  const button = $('#doorExportExcel');
  try {
    button.disabled = true;
    setMessage('#doorMessage', '正在產生 Excel…');
    const rows = (await request('doors')).data || [];
    exportDoorExcel(rows);
    setMessage('#doorMessage', `已匯出 ${rows.length} 筆門號設定`);
  } catch (error) {
    setMessage('#doorMessage', error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('#userExportExcel')?.addEventListener('click', async () => {
  const button = $('#userExportExcel');
  try {
    button.disabled = true;
    setMessage('#userMessage', '正在產生 Excel…');
    const rows = (await request('users')).data || [];
    exportUserExcel(rows);
    setMessage('#userMessage', `已匯出 ${rows.length} 筆使用者設定`);
  } catch (error) {
    setMessage('#userMessage', error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('#doorImportExcel')?.addEventListener('click', () => $('#doorExcelInput')?.click());
$('#userImportExcel')?.addEventListener('click', () => $('#userExcelInput')?.click());

$('#doorExcelInput')?.addEventListener('change', async event => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  const button = $('#doorImportExcel');
  try {
    button.disabled = true;
    setMessage('#doorMessage', '正在讀取 Excel…');
    const rows = await importDoorExcel(file);
    setMessage('#doorMessage', `正在匯入 ${rows.length} 筆…`);
    const result = await upsertDoorRows(rows);
    refreshMainSettings('doors');
    setMessage('#doorMessage', `匯入完成：新增 ${result.created}、更新 ${result.updated}、未變更 ${result.skipped}`);
  } catch (error) {
    setMessage('#doorMessage', error.message, true);
  } finally {
    button.disabled = false;
    input.value = '';
  }
});

$('#userExcelInput')?.addEventListener('change', async event => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  const button = $('#userImportExcel');
  try {
    button.disabled = true;
    setMessage('#userMessage', '正在讀取 Excel…');
    const rows = await importUserExcel(file);
    setMessage('#userMessage', `正在匯入 ${rows.length} 筆…`);
    const result = await upsertUserRows(rows);
    refreshMainSettings('users');
    setMessage('#userMessage', `匯入完成：新增 ${result.created}、更新 ${result.updated}、未變更 ${result.skipped}`);
  } catch (error) {
    setMessage('#userMessage', error.message, true);
  } finally {
    button.disabled = false;
    input.value = '';
  }
});
