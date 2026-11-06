export function ipAddress(value) {
  const parts = String(value).trim().split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || +p > 255)) return null;
  return parts.map(Number).join('.');
}
export const ipOrder = ip => ip.split('.').map(n => n.padStart(3, '0')).join('.');

// '*' matches one complete IPv4 octet. Exact IPs retain their existing format.
export function exclusionPattern(value) {
  const parts = String(value ?? '').trim().split('.');
  if (parts.length !== 4) return null;
  const normalized = parts.map(part => {
    if (part === '*') return '*';
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    return String(Number(part));
  });
  if (normalized.some(part => part === null)) return null;
  return normalized.join('.');
}
export function matchesExclusion(ip, pattern) {
  const address = ipAddress(ip);
  const normalized = exclusionPattern(pattern);
  if (!address || !normalized) return false;
  const source = address.split('.');
  return normalized.split('.').every((part, index) => part === '*' || part === source[index]);
}

// Unanchored wildcard search: '*' stands for any number of characters.
export function wildcardSearch(value, expression) {
  const source = String(value ?? '').toLowerCase();
  const parts = String(expression ?? '').toLowerCase().split('*');
  let cursor = 0;
  for (const part of parts) {
    if (!part) continue;
    const at = source.indexOf(part, cursor);
    if (at < 0) return false;
    cursor = at + part.length;
  }
  return true;
}
export function displayDate(value) {
  const match = String(value ?? '').trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : String(value ?? '').trim();
}
export function timestamp(value) {
  const match = String(value).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i);
  if (!match) return NaN;
  const [, y, mo, d, h = '0', mi = '0', s = '0', fraction = '', zone = ''] = match;
  const year = +y, month = +mo, day = +d, hour = +h, minute = +mi, second = +s, ms = +(fraction.padEnd(3, '0') || 0);
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return NaN;
  if (!zone) return new Date(year, month - 1, day, hour, minute, second, ms).getTime();
  const z = zone.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (zone.toUpperCase() !== 'Z' && (!z || +z[2] > 23 || +z[3] > 59)) return NaN;
  const offset = z ? (z[1] === '+' ? 1 : -1) * (+z[2] * 60 + +z[3]) : 0;
  return Date.UTC(year, month - 1, day, hour, minute, second, ms) - offset * 60000;
}

// CSV quotes, embedded commas and embedded newlines are supported.
export function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') { quoted = false; closed = true; } else field += c; }
    else if (c === '"' && !field && !closed) quoted = true;
    else if (c === ',') { row.push(field); field = ''; closed = false; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; closed = false; }
    else if (closed || c === '"') throw new Error('CSV 引號格式有誤');
    else field += c;
  }
  if (quoted) throw new Error('CSV 引號未結束');
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v !== ''));
}

export function mergeEvents(entries, exclusions, csv) {
  // A single CSV string or several { name, text } files share one import pass.
  // Validate every file before returning any changes for the database commit.
  const sources = Array.isArray(csv) ? csv : [csv];
  if (!sources.length) throw new Error('未選擇 CSV 檔案');
  const latest = new Map(); let skipped = 0;
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    const text = typeof source === 'string' ? source : source?.text;
    const name = typeof source === 'string' ? '' : String(source?.name || `第 ${index + 1} 個檔案`);
    if (typeof text !== 'string') throw new Error(`${name || 'CSV'} 無法讀取`);
    let rows;
    try { rows = parseCsv(text); }
    catch (error) { throw new Error(`${name ? name + '：' : ''}${error.message}`); }
    const headers = rows.shift()?.map(s => s.trim());
    const cols = ['eventTime', 'dstIp', 'srcIp'].map(h => headers?.indexOf(h) ?? -1);
    if (cols.some(i => i < 0)) throw new Error(`${name ? name + '：' : ''}CSV 需要 eventTime、dstIp、srcIp 欄位`);
    for (const row of rows) {
      const date = timestamp(row[cols[0]]); if (!Number.isFinite(date)) { skipped++; continue; }
      for (const col of cols.slice(1)) {
        const ip = ipAddress(row[col] || ''); if (!ip) { if (row[col]?.trim()) skipped++; continue; }
        if (!latest.has(ip) || date > latest.get(ip).date) latest.set(ip, { date, time: row[cols[0]].trim() });
      }
    }
  }
  const next = new Map(entries.map(e => [e.ip, { ...e }])); const counts = {};
  const patterns = exclusions.map(exclusionPattern).filter(Boolean);
  for (const [ip, event] of latest) {
    const matched = patterns.filter(pattern => matchesExclusion(ip, pattern));
    if (matched.length) {
      for (const pattern of matched) counts[pattern] = (counts[pattern] || 0) + 1;
      continue;
    }
    const current = next.get(ip);
    if (!current || !Number.isFinite(timestamp(current.time)) || event.date > timestamp(current.time)) next.set(ip, { ip, time: event.time });
  }
  return { entries: [...next.values()], counts, skipped, count: latest.size };
}

export function rulesFor(entries, threshold) {
  const groups = new Map();
  for (const e of entries) { const prefix = e.ip.split('.').slice(0, 3).join('.'); const group = groups.get(prefix) || []; group.push(e); groups.set(prefix, group); }
  return entries.map(e => {
    const prefix = e.ip.split('.').slice(0, 3).join('.'); const group = groups.get(prefix);
    const merged = group.length >= threshold;
    const time = merged ? group.reduce((max, x) => timestamp(x.time) > timestamp(max) || !max ? x.time : max, '') : e.time;
    return { ...e, time, merged, rule: `-A ${merged ? prefix + '.0/24' : e.ip + '/32'} DROP` };
  });
}

// Spreadsheet copies use tabs between columns and newlines between rows.
export function exclusionPasteValues(text) {
  return String(text).split(/\r\n|\n|\r/).flatMap(row => row.split('\t')).map(value => value.trim()).filter(Boolean);
}
