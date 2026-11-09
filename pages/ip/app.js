import { ipAddress, ipOrder, exclusionPattern, mergeEvents, rulesFor, timestamp, exclusionPasteValues, wildcardSearch, displayDate } from './logic.js';

const $ = id => document.getElementById(id);
let state = { entries: [], exclusions: [], threshold: 4 }, revision = 0, counts = null, saving = false, exclusionDraft = [''];
const columns = { ip: 'IP', rule: '轉格式', time: '更新日期' };
const columnFilters = { ip: '', rule: '', time: '' };
const thresholdKey = 'indar-boss-ip-threshold';
const deleteSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>';
let sortColumn = 'ip', sortDirection = 'asc', menuColumn = null;
let preferredThreshold = null, copyToastTimer = null;
const currentThreshold = () => preferredThreshold ?? state.threshold;
function readBrowserThreshold() {
  try {
    const raw = localStorage.getItem(thresholdKey);
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 2 && n <= 254 ? n : null;
  } catch { return null; }
}
function saveBrowserThreshold(value) {
  preferredThreshold = value;
  try { localStorage.setItem(thresholdKey, String(value)); } catch { /* Storage may be disabled. */ }
}
function roundedThreshold() {
  const raw = String($('threshold').value).trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.ceil(n) : null;
}
function showCopyToast() {
  const toast = $('copyToast');
  toast.hidden = false;
  clearTimeout(copyToastTimer);
  copyToastTimer = setTimeout(() => { toast.hidden = true; }, 2400);
  copyToastTimer?.unref?.();
}

function columnText(row, column) {
  if (column === 'ip') return row.ip + ' ' + ipOrder(row.ip);
  if (column === 'rule') return row.rule;
  return displayDate(row.time);
}
function compareRows(a, b, column) {
  if (column === 'ip') return ipOrder(a.ip).localeCompare(ipOrder(b.ip));
  if (column === 'time') return (timestamp(a.time) || 0) - (timestamp(b.time) || 0);
  return columnText(a, column).localeCompare(columnText(b, column), 'zh-Hant');
}
function closeColumnMenu() {
  $('columnMenu').hidden = true;
  for (const column of Object.keys(columns)) $('columnTool-' + column).setAttribute('aria-expanded', 'false');
  menuColumn = null;
}
function openColumnMenu(column) {
  if (!columns[column]) return;
  if (menuColumn === column && !$('columnMenu').hidden) { closeColumnMenu(); return; }
  menuColumn = column;
  $('columnSearch').value = columnFilters[column];
  $('columnSortAsc').textContent = column === 'time' ? '舊到新' : '升冪排序';
  $('columnSortDesc').textContent = column === 'time' ? '新到舊' : '降冪排序';
  $('columnMenu').hidden = false;
  for (const key of Object.keys(columns)) $('columnTool-' + key).setAttribute('aria-expanded', String(key === column));
  const rect = $('columnTool-' + column).getBoundingClientRect();
  $('columnMenu').style.left = Math.max(8, Math.min(rect.left, (window.innerWidth || 1024) - 284)) + 'px';
  $('columnMenu').style.top = Math.max(8, Math.min(rect.bottom + 6, (window.innerHeight || 768) - 214)) + 'px';
  $('columnSearch').focus();
}


function validateState(input) {
  if (!input || !Array.isArray(input.entries) || !Array.isArray(input.exclusions) || !Number.isInteger(input.threshold) || input.threshold < 2 || input.threshold > 254) throw new Error('IP 清單格式有誤');
  const entries = new Map();
  for (const item of input.entries) {
    const ip = ipAddress(item?.ip); const time = String(item?.time || '').trim();
    if (!ip || (time && !Number.isFinite(timestamp(time))) || entries.has(ip)) throw new Error('清單含無效、重複的 IP 或無效時間');
    entries.set(ip, { ip, time });
  }
  const exclusions = input.exclusions.map(exclusionPattern);
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
  const files = Array.from(input.files || []);
  if (!files.length || input.disabled) return;
  input.disabled = true;
  try { await fn(files); }
  catch (error) { status(error.message || '操作失敗；資料未變更', true); }
  finally { input.value = ''; input.disabled = false; }
}
function render() {
  if (document.activeElement !== $('threshold')) $('threshold').value = currentThreshold();
  $('exclusionSummary').textContent = String(state.exclusions.length);
  $('excludeCounts').textContent = counts ? `本次匯入排除 IP 次數：${state.exclusions.map(ip => `${ip}：${counts[ip] || 0}`).join('、') || '無排除 IP'}` : '';
  let rows = rulesFor(state.entries, currentThreshold());
  rows = rows.filter(row => Object.keys(columns).every(column =>
    wildcardSearch(columnText(row, column), columnFilters[column])
  ));
  rows.sort((a, b) => {
    const order = compareRows(a, b, sortColumn) * (sortDirection === 'asc' ? 1 : -1);
    return order || ipOrder(a.ip).localeCompare(ipOrder(b.ip));
  });
  for (const column of Object.keys(columns)) {
    $('columnHeader-' + column).setAttribute('aria-sort', sortColumn === column ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
    $('columnTool-' + column).classList.toggle('is-active', sortColumn === column || Boolean(columnFilters[column]));
  }
  $('blockRows').replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr'); if (row.merged) tr.className = 'merged';
    for (const value of [ipOrder(row.ip), row.rule, displayDate(row.time)]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    const td = document.createElement('td'), button = document.createElement('button');
    button.type = 'button'; button.className = 'boss-action-icon boss-action-delete';
    button.innerHTML = deleteSvg; button.dataset.ip = row.ip;
    button.setAttribute('aria-label', `刪除 ${row.ip}`); button.title = `刪除 ${row.ip}`;
    td.append(button); tr.append(td); return tr;
  }));
}
async function copy(text) {
  try {
    if (!text) throw new Error('沒有可複製的資料');
    await navigator.clipboard.writeText(text);
    showCopyToast();
  } catch (error) { status(error.message || '複製失敗，請確認瀏覽器權限', true); }
}

$('threshold').onchange = () => {
  const n = roundedThreshold();
  if (n !== null) $('threshold').value = n;
};
$('setThreshold').onclick = () => {
  const n = roundedThreshold();
  if (n === null || n < 2 || n > 254) {
    $('threshold').setAttribute('aria-invalid', 'true');
    status('合併數量須介於 2～254，請輸入有效數字', true);
    $('threshold').focus();
    return;
  }
  $('threshold').removeAttribute('aria-invalid');
  $('threshold').value = n;
  saveBrowserThreshold(n);
  render();
  status('已套用合併數量');
};
function meaningfulExclusions() { return exclusionDraft.map(value => value.trim()).filter(Boolean); }
function focusExclusion(index) { $('exclusionRows').querySelector(`[data-index="${index}"]`)?.focus({ preventScroll: true }); }

// The iframe grows with table content. Place the modal in the currently visible
// section of the frame instead of centering it in the whole tall document.
function positionExclusionDialog() {
  const dialog = $('exclusionDialog');
  if (!dialog.open) return;
  try {
    const frame = window.frameElement;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const viewport = window.parent.innerHeight;
    const visibleTop = Math.max(0, -rect.top);
    const visibleBottom = Math.min(rect.height, viewport - rect.top);
    const available = Math.max(0, visibleBottom - visibleTop);
    dialog.style.position = 'absolute';
    dialog.style.margin = '0';
    dialog.style.left = '50%';
    dialog.style.right = 'auto';
    dialog.style.bottom = 'auto';
    dialog.style.transform = 'translateX(-50%)';
    dialog.style.maxHeight = Math.max(160, Math.min(viewport - 32, available - 24)) + 'px';
    const height = dialog.getBoundingClientRect().height;
    dialog.style.top = Math.max(12, visibleTop + Math.max(0, available - height) / 2) + 'px';
  } catch { /* Standalone or cross-origin views keep native dialog positioning. */ }
}
let trackingExclusionDialog = false;
function trackExclusionDialog() {
  if (trackingExclusionDialog) return;
  try {
    if (!window.frameElement) return;
    window.parent.addEventListener('scroll', positionExclusionDialog, { passive: true });
    window.parent.addEventListener('resize', positionExclusionDialog);
    trackingExclusionDialog = true;
  } catch { /* Embedded cross-origin fallback. */ }
}
function stopTrackingExclusionDialog() {
  if (!trackingExclusionDialog) return;
  window.parent.removeEventListener('scroll', positionExclusionDialog);
  window.parent.removeEventListener('resize', positionExclusionDialog);
  trackingExclusionDialog = false;
}
$('exclusionDialog').addEventListener('close', () => {
  stopTrackingExclusionDialog();
  document.dispatchEvent(new Event('ip-dialog-change'));
});
function appendExclusionRow(index) {
  const row = document.createElement('tr');
  const number = document.createElement('td'); number.textContent = String(index + 1);
  const cell = document.createElement('td'); const input = document.createElement('input');
  input.type = 'text'; input.value = exclusionDraft[index]; input.dataset.index = String(index);
  input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = '例如 220.130.148.*';
  input.setAttribute('aria-label', `第 ${index + 1} 列排除 IP`);
  const removeCell = document.createElement('td'); const remove = document.createElement('button');
  remove.type = 'button'; remove.className = 'boss-action-icon boss-action-delete';
  remove.innerHTML = deleteSvg; remove.dataset.remove = String(index);
  remove.setAttribute('aria-label', `刪除第 ${index + 1} 列`); remove.title = '刪除';
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
  $('exclusionDialog').showModal();
  document.dispatchEvent(new Event('ip-dialog-change'));
  positionExclusionDialog();
  trackExclusionDialog();
  focusExclusion(exclusionDraft.length - 1);
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
  const value = (event.target.closest?.('button[data-remove]') || event.target).dataset.remove;
  if (value === undefined) return;
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= exclusionDraft.length) return;
  exclusionDraft.splice(index, 1); if (!exclusionDraft.length || exclusionDraft.at(-1).trim()) exclusionDraft.push('');
  renderExclusions(); focusExclusion(Math.min(index, exclusionDraft.length - 1));
});
$('addExclusion').onclick = () => { exclusionDraft.push(''); appendExclusionRow(exclusionDraft.length - 1); focusExclusion(exclusionDraft.length - 1); };
$('closeExclusions').onclick = () => $('exclusionDialog').close();
$('saveExclusions').onclick = async () => {
  try {
    const raw = meaningfulExclusions(); const exclusions = raw.map(exclusionPattern);
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
for (const column of Object.keys(columns)) $('columnTool-' + column).onclick = () => openColumnMenu(column);
$('columnSortAsc').onclick = () => {
  if (!menuColumn) return;
  sortColumn = menuColumn; sortDirection = 'asc'; closeColumnMenu(); render();
};
$('columnSortDesc').onclick = () => {
  if (!menuColumn) return;
  sortColumn = menuColumn; sortDirection = 'desc'; closeColumnMenu(); render();
};
$('columnSearch').oninput = event => {
  if (!menuColumn) return;
  columnFilters[menuColumn] = event.target.value.trim();
  render();
};
$('columnFilterClear').onclick = () => {
  if (!menuColumn) return;
  columnFilters[menuColumn] = '';
  $('columnSearch').value = '';
  render(); $('columnSearch').focus();
};
document.addEventListener('pointerdown', event => {
  if ($('columnMenu').hidden) return;
  if ($('columnMenu').contains(event.target)) return;
  if (Object.keys(columns).some(column => $('columnTool-' + column).contains(event.target))) return;
  closeColumnMenu();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('columnMenu').hidden) closeColumnMenu(); });
window.addEventListener('resize', closeColumnMenu);
window.addEventListener('scroll', closeColumnMenu);
$('blockRows').onclick = event => action(async () => {
  const ip = (event.target.closest?.('button[data-ip]') || event.target).dataset.ip;
  if (ip && confirm(`確定刪除 ${ip}？`)) {
    await commit({ ...state, entries: state.entries.filter(e => e.ip !== ip) }); status('已刪除');
  }
});
$('copyRules').onclick = () => copy([...new Set(rulesFor(state.entries, currentThreshold()).sort((a,b) => ipOrder(a.ip).localeCompare(ipOrder(b.ip))).map(e => e.rule))].join('\r\n'));
$('events').onchange = event => fileAction(event.target, async files => {
  const started = revision;
  const sources = await Promise.all(files.map(async file => ({ name: file.name, text: await file.text() })));
  if (started !== revision) throw new Error('清單已變更，請重新匯入');
  const result = mergeEvents(state.entries, state.exclusions, sources);
  await commit({ ...state, entries: result.entries }, started);
  counts = result.counts;
  render();
  status(`已匯入 ${files.length} 個 CSV，${result.count} 個不同 IP；略過 ${result.skipped} 個無效時間或 IP`);
});

async function start() {
  if (window.top === window) { window.location.replace('../../#ip'); return; }
  try {
    const response = await fetch('../../api/access', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) { window.top.indarAuth.goToLogin('/boss/#ip'); return; }
    if (!response.ok) throw new Error(response.status === 403 ? '此帳號尚未開放使用 BOSS，請聯絡管理員。' : 'BOSS 權限服務暫時無法使用，請稍後再試。');
    const saved = await apiState();
    state = validateState(saved); revision = saved.revision;
    preferredThreshold = readBrowserThreshold();
    if (!Number.isInteger(revision) || revision < 0) throw new Error('資料庫版本不正確');
    render(); $('accessGate').hidden = true; $('appShell').hidden = false;
  } catch (error) { $('accessMessage').textContent = error.message; }
}
start();
