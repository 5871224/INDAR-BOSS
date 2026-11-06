import { checkLines, ipAddress, ipOrder, mergeEvents, parseCsv, rulesFor, timestamp } from './logic.js';

const $ = id => document.getElementById(id);
const storageKey = 'indar-boss-ip-v1';
let state = { entries: [], exclusions: [], threshold: 4 }, revision = 0, counts = null, checked = [], rawSaved = null, saving = false;

function validateState(input) {
  if (!input || !Array.isArray(input.entries) || !Array.isArray(input.exclusions) || !Number.isInteger(input.threshold) || input.threshold < 2 || input.threshold > 254) throw new Error('備份格式有誤');
  const entries = new Map();
  for (const item of input.entries) {
    const ip = ipAddress(item?.ip); const time = String(item?.time || '').trim();
    if (!ip || (time && !Number.isFinite(timestamp(time))) || entries.has(ip)) throw new Error('清單含無效、重複的 IP 或無效時間');
    entries.set(ip, { ip, time });
  }
  const exclusions = input.exclusions.map(ipAddress);
  if (exclusions.some(ip => !ip) || new Set(exclusions).size !== exclusions.length) throw new Error('排除清單含無效或重複 IP');
  return { entries: [...entries.values()], exclusions, threshold: input.threshold };
}
async function apiState(method = 'GET', body) {
  let response;
  try { response = await fetch('../../api/ip-state', { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('無法連線資料庫服務，資料未變更'); }
  if (response.status === 401) { window.top.indarAuth.goToLogin('/boss/#ip'); throw new Error('登入已逾期，請重新登入'); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '無法讀取或儲存 IP 清單');
  return result.data;
}
async function commit(next, expectedRevision = revision) {
  if (expectedRevision !== revision) throw new Error('清單已變更，請重新執行操作');
  if (saving) throw new Error('資料儲存中，請稍候');
  const valid = validateState(next);
  saving = true; $('saveExclusions').disabled = true;
  try {
    const saved = await apiState('PUT', { ...valid, revision });
    state = validateState(saved); revision = saved.revision; render();
  } finally { saving = false; $('saveExclusions').disabled = false; }
}
function status(message, error = false) { $('blockStatus').textContent = message; $('blockStatus').classList.toggle('status-error', error); }
async function action(fn) { try { await fn(); } catch (error) { status(error.message || '操作失敗；資料未變更', true); } }
async function fileAction(input, fn) {
  try { const file = input.files[0]; if (file) await fn(file); }
  catch (error) { status(error.message || '操作失敗；資料未變更', true); }
  finally { input.value = ''; }
}
function render() {
  $('threshold').value = state.threshold;
  $('exclusionSummary').textContent = `目前 ${state.exclusions.length} 個排除 IP`;
  $('excludeCounts').textContent = counts ? `本次匯入排除 IP 次數：${state.exclusions.map(ip => `${ip}：${counts[ip] || 0}`).join('、') || '無排除 IP'}` : '';
  let rows = rulesFor(state.entries, state.threshold);
  rows.sort($('sort').value === 'time' ? (a, b) => (timestamp(b.time) || 0) - (timestamp(a.time) || 0) || ipOrder(a.ip).localeCompare(ipOrder(b.ip)) : (a, b) => ipOrder(a.ip).localeCompare(ipOrder(b.ip)));
  $('blockRows').replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr'); if (row.merged) tr.className = 'merged';
    for (const value of [ipOrder(row.ip), row.rule, row.time]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    const td = document.createElement('td'), button = document.createElement('button'); button.textContent = '刪除'; button.dataset.ip = row.ip; button.setAttribute('aria-label', `刪除 ${row.ip}`); td.append(button); tr.append(td); return tr;
  }));
}
function showChecks() {
  $('checkRows').replaceChildren(...checked.map(row => {
    const tr = document.createElement('tr');
    for (const [i, value] of [row.original, row.output, row.errors.join('、') || '通過'].entries()) { const td = document.createElement('td'); td.textContent = value; if (i === 2 && row.errors.length) td.className = 'error'; tr.append(td); }
    return tr;
  }));
}
async function copy(text, el) {
  try { if (!text) throw new Error('沒有可複製的資料'); await navigator.clipboard.writeText(text); el.textContent = '已複製'; }
  catch (error) { el.textContent = error.message || '複製失敗，請確認瀏覽器權限'; }
}

$('check').onclick = () => { const result = checkLines($('checkInput').value); checked = result.rows; showChecks(); $('checkStatus').textContent = `${result.rules ? '阻擋規則' : '名稱、MAC、IP'}：${checked.length} 筆，${checked.filter(r => r.errors.length).length} 筆有誤`; };
$('checkInput').oninput = () => { if (checked.length) { checked = []; showChecks(); $('checkStatus').textContent = '資料已變更，請重新檢查'; } };
$('clearCheck').onclick = () => { $('checkInput').value = ''; checked = []; showChecks(); $('checkStatus').textContent = ''; };
$('copyChecked').onclick = () => copy(checked.map(r => r.output).filter(Boolean).join('\r\n'), $('checkStatus'));
$('setThreshold').onclick = () => action(async () => { const threshold = Number($('threshold').value); await commit({ ...state, threshold }); status('已更新合併數量'); });
window.hasUnsavedExclusions = () => $('exclusionDialog').open && $('exclusions').value !== state.exclusions.join('\n');
$('openExclusions').onclick = () => {
  $('exclusions').value = state.exclusions.join('\n'); $('exclusionStatus').textContent = '';
  const dialog = $('exclusionDialog');
  try {
    const frame = window.frameElement;
    if (frame) { dialog.style.position = 'absolute'; dialog.style.top = `${Math.max(12, -frame.getBoundingClientRect().top + 16)}px`; dialog.style.maxHeight = `${Math.max(200, window.parent.innerHeight - 32)}px`; }
  } catch {} // The same-origin BOSS page normally contains this frame.
  dialog.showModal(); $('exclusions').focus();
};
$('cancelExclusions').onclick = () => $('exclusionDialog').close();
$('saveExclusions').onclick = async () => {
  try {
    const raw = $('exclusions').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean); const exclusions = raw.map(ipAddress);
    if (exclusions.some(ip => !ip)) throw new Error('排除清單包含無效 IP；請修正後再儲存');
    $('exclusionStatus').textContent = '儲存中…';
    await commit({ ...state, exclusions: [...new Set(exclusions)] });
    $('exclusionDialog').close(); status('已儲存排除清單');
  } catch (error) { $('exclusionStatus').textContent = error.message || '儲存失敗，資料未變更'; }
};
$('sort').onchange = render;
$('blockRows').onclick = event => action(async () => { const ip = event.target.dataset.ip; if (ip && confirm(`確定刪除 ${ip}？`)) { await commit({ ...state, entries: state.entries.filter(e => e.ip !== ip) }); status('已刪除'); } });
$('copyRules').onclick = () => copy([...new Set(rulesFor(state.entries, state.threshold).sort((a,b) => ipOrder(a.ip).localeCompare(ipOrder(b.ip))).map(e => e.rule))].join('\r\n'), $('blockStatus'));
$('events').onchange = event => fileAction(event.target, async file => { const started = revision; const text = await file.text(); if (started !== revision) throw new Error('清單已變更，請重新匯入'); const result = mergeEvents(state.entries, state.exclusions, text); await commit({ ...state, entries: result.entries }, started); counts = result.counts; render(); status(`已處理 ${result.count} 個不同 IP；略過 ${result.skipped} 個無效時間或 IP`); });
$('list').onchange = event => fileAction(event.target, async file => {
  const started = revision; const text = await file.text(); if (started !== revision) throw new Error('清單已變更，請重新匯入');
  const rows = parseCsv(text); const headers = rows.shift()?.map(s => s.trim()); const ipCol = headers?.indexOf('IP') ?? -1, timeCol = headers?.indexOf('更新時間') ?? -1;
  if (ipCol < 0 || timeCol < 0) throw new Error('既有清單 CSV 需要 IP、更新時間欄位');
  const next = new Map(state.entries.map(e => [e.ip, e])); const exclusions = new Set(state.exclusions); const exclusionCol = headers.indexOf('排除IP');
  for (const [i, row] of rows.entries()) {
    const exclusion = exclusionCol >= 0 ? (row[exclusionCol] || '').trim() : '';
    if (exclusion) { const normalized = ipAddress(exclusion); if (!normalized) throw new Error(`第 ${i + 2} 行排除 IP 有誤，未匯入任何資料`); exclusions.add(normalized); }
    if (!(row[ipCol] || '').trim() && !(row[timeCol] || '').trim()) continue;
    const ip = ipAddress(row[ipCol] || ''), time = (row[timeCol] || '').trim();
    if (!ip || (time && !Number.isFinite(timestamp(time)))) throw new Error(`第 ${i + 2} 行 IP 或時間有誤，未匯入任何資料`);
    const prev = next.get(ip); if (!prev || (time && (!prev.time || timestamp(time) > timestamp(prev.time)))) next.set(ip, { ip, time });
  }
  await commit({ ...state, entries: [...next.values()], exclusions: [...exclusions] }, started); status(`已匯入 ${rows.length} 行既有清單`);
});
function download(text, name) { const blob = new Blob([text], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
$('backup').onclick = () => action(() => { download(JSON.stringify(state, null, 2), 'IP檢查備份.json'); status('已下載備份'); });
$('downloadLocal').onclick = () => action(() => { if (rawSaved === null) throw new Error('沒有可下載的舊資料'); download(rawSaved, 'IP檢查本機舊資料.json'); });
$('importLocal').onclick = () => action(async () => {
  const old = validateState(JSON.parse(rawSaved)); const entries = new Map(state.entries.map(entry => [entry.ip, entry]));
  for (const entry of old.entries) { const current = entries.get(entry.ip); if (!current || (entry.time && (!current.time || timestamp(entry.time) > timestamp(current.time)))) entries.set(entry.ip, entry); }
  const exclusions = [...new Set([...state.exclusions, ...old.exclusions])];
  if (!confirm(`將此瀏覽器的 ${old.entries.length} 筆 IP 和 ${old.exclusions.length} 個排除 IP 合併至共用清單，繼續？`)) return;
  await commit({ ...state, entries: [...entries.values()], exclusions, threshold: revision === 0 ? old.threshold : state.threshold });
  try { localStorage.setItem(storageKey + '-imported', rawSaved); } catch {}
  $('importLocal').hidden = true; status('已合併此瀏覽器的舊資料');
});
$('restore').onchange = event => fileAction(event.target, async file => { const started = revision; const restored = validateState(JSON.parse(await file.text())); if (!confirm(`備份有 ${restored.entries.length} 筆 IP，還原將取代共用清單與設定。繼續？`)) return; await commit(restored, started); counts = null; render(); status('已還原備份'); });

async function start() {
  try {
    const response = await fetch('../../api/access', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) { window.top.indarAuth.goToLogin('/boss/#ip'); return; }
    if (!response.ok) throw new Error(response.status === 403 ? '此帳號尚未開放使用 BOSS，請聯絡管理員。' : 'BOSS 權限服務暫時無法使用，請稍後再試。');
    const saved = await apiState();
    state = validateState(saved); revision = saved.revision;
    if (!Number.isInteger(revision) || revision < 0) throw new Error('資料庫版本不正確');
    try {
      rawSaved = localStorage.getItem(storageKey);
      if (rawSaved !== null) {
        $('downloadLocal').hidden = false;
        if (localStorage.getItem(storageKey + '-imported') !== rawSaved) {
          try { validateState(JSON.parse(rawSaved)); $('importLocal').hidden = false; }
          catch { status('本機舊資料無法解析；可先下載舊資料備份。', true); }
        }
      }
    } catch { status('無法讀取此瀏覽器的舊資料；資料庫清單仍可使用。', true); }
    render(); $('accessGate').hidden = true; $('appShell').hidden = false;
  } catch (error) { $('accessMessage').textContent = error.message; }
}
start();
