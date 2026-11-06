import { checkLines, ipAddress, ipOrder, mergeEvents, parseCsv, rulesFor, timestamp } from './logic.js';

const $ = id => document.getElementById(id);
const storageKey = 'indar-boss-ip-v1';
let state = { entries: [], exclusions: [], threshold: 4 }, counts = null, checked = [], loadFailed = false, rawSaved = null;

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
function commit(next, restoring = false) {
  if (loadFailed && !restoring) throw new Error('本機資料讀取失敗，請先還原備份，避免覆寫原資料');
  const valid = validateState(next);
  localStorage.setItem(storageKey, JSON.stringify(valid));
  state = valid; loadFailed = false; render();
}
function status(message, error = false) { $('blockStatus').textContent = message; $('blockStatus').classList.toggle('status-error', error); }
function action(fn) { try { fn(); } catch (error) { status(error.message || '操作失敗；資料未變更', true); } }
async function fileAction(input, fn) {
  try { const file = input.files[0]; if (file) await fn(file); }
  catch (error) { status(error.message || '操作失敗；資料未變更', true); }
  finally { input.value = ''; }
}
function render() {
  $('threshold').value = state.threshold;
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
$('setThreshold').onclick = () => action(() => { const threshold = Number($('threshold').value); commit({ ...state, threshold }); status('已更新合併數量'); });
$('saveExclusions').onclick = () => action(() => {
  const raw = $('exclusions').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean); const exclusions = raw.map(ipAddress);
  if (exclusions.some(ip => !ip)) throw new Error('排除清單包含無效 IP；請修正後再儲存');
  commit({ ...state, exclusions: [...new Set(exclusions)] }); $('exclusions').value = state.exclusions.join('\n'); status('已儲存排除清單');
});
$('sort').onchange = render;
$('blockRows').onclick = event => action(() => { const ip = event.target.dataset.ip; if (ip && confirm(`確定刪除 ${ip}？`)) { commit({ ...state, entries: state.entries.filter(e => e.ip !== ip) }); status('已刪除'); } });
$('copyRules').onclick = () => copy([...new Set(rulesFor(state.entries, state.threshold).sort((a,b) => ipOrder(a.ip).localeCompare(ipOrder(b.ip))).map(e => e.rule))].join('\r\n'), $('blockStatus'));
$('events').onchange = event => fileAction(event.target, async file => { if ($('exclusions').value !== state.exclusions.join('\n')) throw new Error('排除清單有未儲存的修改，請先儲存'); const result = mergeEvents(state.entries, state.exclusions, await file.text()); commit({ ...state, entries: result.entries }); counts = result.counts; render(); status(`已處理 ${result.count} 個不同 IP；略過 ${result.skipped} 個無效時間或 IP`); });
$('list').onchange = event => fileAction(event.target, async file => {
  const rows = parseCsv(await file.text()); const headers = rows.shift()?.map(s => s.trim()); const ipCol = headers?.indexOf('IP') ?? -1, timeCol = headers?.indexOf('更新時間') ?? -1;
  if (ipCol < 0 || timeCol < 0) throw new Error('既有清單 CSV 需要 IP、更新時間欄位');
  if (headers.includes('排除IP') && $('exclusions').value !== state.exclusions.join('\n')) throw new Error('排除清單有未儲存的修改，請先儲存');
  const next = new Map(state.entries.map(e => [e.ip, e])); const exclusions = new Set(state.exclusions); const exclusionCol = headers.indexOf('排除IP');
  for (const [i, row] of rows.entries()) {
    const exclusion = exclusionCol >= 0 ? (row[exclusionCol] || '').trim() : '';
    if (exclusion) { const normalized = ipAddress(exclusion); if (!normalized) throw new Error(`第 ${i + 2} 行排除 IP 有誤，未匯入任何資料`); exclusions.add(normalized); }
    if (!(row[ipCol] || '').trim() && !(row[timeCol] || '').trim()) continue;
    const ip = ipAddress(row[ipCol] || ''), time = (row[timeCol] || '').trim();
    if (!ip || (time && !Number.isFinite(timestamp(time)))) throw new Error(`第 ${i + 2} 行 IP 或時間有誤，未匯入任何資料`);
    const prev = next.get(ip); if (!prev || (time && (!prev.time || timestamp(time) > timestamp(prev.time)))) next.set(ip, { ip, time });
  }
  commit({ ...state, entries: [...next.values()], exclusions: [...exclusions] }); if (exclusionCol >= 0) $('exclusions').value = state.exclusions.join('\n'); status(`已匯入 ${rows.length} 行既有清單`);
});
$('backup').onclick = () => action(() => { if (loadFailed && rawSaved === null) throw new Error('本機儲存空間無法讀取，無法下載備份'); const blob = new Blob([loadFailed ? rawSaved : JSON.stringify(state, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = loadFailed ? 'IP檢查原始資料.json' : 'IP檢查備份.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status(loadFailed ? '已下載無法解析的原始資料' : '已下載備份'); });
$('restore').onchange = event => fileAction(event.target, async file => { const restored = validateState(JSON.parse(await file.text())); if (!confirm(`備份有 ${restored.entries.length} 筆 IP，還原將取代目前清單與設定（包括尚未儲存的排除清單）。${loadFailed ? '目前本機資料無法解析，建議先按「下載備份」保存原始資料。' : ''}繼續？`)) return; commit(restored, true); $('exclusions').value = state.exclusions.join('\n'); counts = null; render(); status('已還原備份'); });

async function start() {
  try {
    const response = await fetch('../../api/access', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) { window.top.indarAuth.goToLogin('/boss/#ip'); return; }
    if (!response.ok) throw new Error(response.status === 403 ? '此帳號尚未開放使用 BOSS，請聯絡管理員。' : 'BOSS 權限服務暫時無法使用，請稍後再試。');
    try { rawSaved = localStorage.getItem(storageKey); if (rawSaved !== null) state = validateState(JSON.parse(rawSaved)); }
    catch (error) { loadFailed = true; status(`無法讀取本機資料：${error.message}。請還原備份，避免覆寫原資料。`, true); }
    $('exclusions').value = state.exclusions.join('\n'); render(); $('accessGate').hidden = true; $('appShell').hidden = false;
  } catch (error) { $('accessMessage').textContent = error.message; }
}
start();
