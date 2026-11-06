import { checkLines, ipAddress, ipOrder, mergeEvents, parseCsv, rulesFor, timestamp, exclusionPasteValues } from './logic.js';

const $ = id => document.getElementById(id);
let state = { entries: [], exclusions: [], threshold: 4 }, revision = 0, counts = null, checked = [], saving = false, exclusionDraft = [''];

function validateState(input) {
  if (!input || !Array.isArray(input.entries) || !Array.isArray(input.exclusions) || !Number.isInteger(input.threshold) || input.threshold < 2 || input.threshold > 254) throw new Error('IP 清單格式有誤');
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
function meaningfulExclusions() { return exclusionDraft.map(value => value.trim()).filter(Boolean); }
function focusExclusion(index) { $('exclusionRows').querySelector(`[data-index="${index}"]`)?.focus(); }
function appendExclusionRow(index) {
  const row = document.createElement('tr');
  const number = document.createElement('td'); number.textContent = String(index + 1);
  const cell = document.createElement('td'); const input = document.createElement('input');
  input.type = 'text'; input.value = exclusionDraft[index]; input.dataset.index = String(index);
  input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = '例如 192.168.1.1';
  input.setAttribute('aria-label', `第 ${index + 1} 列排除 IP`);
  const removeCell = document.createElement('td'); const remove = document.createElement('button');
  remove.type = 'button'; remove.textContent = '刪除'; remove.dataset.remove = String(index); remove.setAttribute('aria-label', `刪除第 ${index + 1} 列`);
  cell.append(input); removeCell.append(remove); row.append(number, cell, removeCell); $('exclusionRows').append(row);
}
function renderExclusions() {
  $('exclusionRows').replaceChildren();
  for (let i = 0; i < exclusionDraft.length; i++) appendExclusionRow(i);
}
function ensureBlankRow() {
  if (exclusionDraft.at(-1)?.trim()) { exclusionDraft.push(''); appendExclusionRow(exclusionDraft.length - 1); }
}
window.hasUnsavedExclusions = () => $('exclusionDialog').open && meaningfulExclusions().join('\n') !== state.exclusions.join('\n');
$('openExclusions').onclick = () => {
  exclusionDraft = [...state.exclusions, '']; renderExclusions(); $('exclusionStatus').textContent = '';
  const dialog = $('exclusionDialog');
  try {
    const frame = window.frameElement;
    if (frame) { dialog.style.position = 'absolute'; dialog.style.top = `${Math.max(12, -frame.getBoundingClientRect().top + 16)}px`; dialog.style.maxHeight = `${Math.max(200, window.parent.innerHeight - 32)}px`; }
  } catch {} // The same-origin BOSS page normally contains this frame.
  dialog.showModal(); focusExclusion(exclusionDraft.length - 1);
};
$('exclusionRows').addEventListener('input', event => {
  const index = Number(event.target.dataset.index);
  if (!Number.isInteger(index) || index < 0 || index >= exclusionDraft.length) return;
  exclusionDraft[index] = event.target.value; event.target.removeAttribute('aria-invalid'); ensureBlankRow();
});
$('exclusionRows').addEventListener('paste', event => {
  const index = Number(event.target.dataset.index);
  if (!Number.isInteger(index) || index < 0 || index >= exclusionDraft.length) return;
  const text = event.clipboardData?.getData('text/plain') || '';
  if (!/[\r\n\t]/.test(text)) return; // Ordinary single-cell editing remains native.
  event.preventDefault();
  const values = exclusionPasteValues(text);
  if (!values.length) { $('exclusionStatus').textContent = '沒有可貼上的資料'; return; }
  const next = [...exclusionDraft];
  values.forEach((value, offset) => { next[index + offset] = value; });
  if (next.filter(value => value.trim()).length > 20000) { $('exclusionStatus').textContent = '排除清單最多 20,000 個 IP'; return; }
  const overwritten = values.some((value, offset) => exclusionDraft[index + offset]?.trim() && exclusionDraft[index + offset].trim() !== value);
  if (overwritten && !confirm('貼上會取代所選列開始的既有內容，繼續嗎？')) return;
  exclusionDraft = next;
  if (exclusionDraft.at(-1)?.trim()) exclusionDraft.push('');
  renderExclusions(); focusExclusion(index); $('exclusionStatus').textContent = `已貼上 ${values.length} 格，請確認後儲存`;
});
$('exclusionRows').addEventListener('keydown', event => {
  const index = Number(event.target.dataset.index);
  if (!Number.isInteger(index) || index < 0 || index >= exclusionDraft.length) return;
  if (event.key === 'Enter' || event.key === 'ArrowDown') { event.preventDefault(); ensureBlankRow(); focusExclusion(Math.min(index + 1, exclusionDraft.length - 1)); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); focusExclusion(Math.max(index - 1, 0)); }
});
$('exclusionRows').addEventListener('click', event => {
  const value = event.target.dataset.remove;
  if (value === undefined) return;
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= exclusionDraft.length) return;
  exclusionDraft.splice(index, 1); if (!exclusionDraft.length || exclusionDraft.at(-1).trim()) exclusionDraft.push('');
  renderExclusions(); focusExclusion(Math.min(index, exclusionDraft.length - 1));
});
$('addExclusion').onclick = () => { exclusionDraft.push(''); appendExclusionRow(exclusionDraft.length - 1); focusExclusion(exclusionDraft.length - 1); };
$('cancelExclusions').onclick = () => $('exclusionDialog').close();
$('saveExclusions').onclick = async () => {
  try {
    const raw = meaningfulExclusions(); const exclusions = raw.map(ipAddress);
    const invalid = exclusions.findIndex(ip => !ip);
    if (invalid >= 0) {
      const row = exclusionDraft.findIndex(value => value.trim() === raw[invalid]);
      const input = $('exclusionRows').querySelector(`[data-index="${row}"]`);
      input?.setAttribute('aria-invalid', 'true'); input?.focus();
      throw new Error(`第 ${row + 1} 列 IP 格式有誤；請修正後再儲存`);
    }
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

async function start() {
  try {
    const response = await fetch('../../api/access', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) { window.top.indarAuth.goToLogin('/boss/#ip'); return; }
    if (!response.ok) throw new Error(response.status === 403 ? '此帳號尚未開放使用 BOSS，請聯絡管理員。' : 'BOSS 權限服務暫時無法使用，請稍後再試。');
    const saved = await apiState();
    state = validateState(saved); revision = saved.revision;
    if (!Number.isInteger(revision) || revision < 0) throw new Error('資料庫版本不正確');
    render(); $('accessGate').hidden = true; $('appShell').hidden = false;
  } catch (error) { $('accessMessage').textContent = error.message; }
}
start();
