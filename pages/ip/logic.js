export function ipAddress(value) {
  const parts = String(value).trim().split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || +p > 255)) return null;
  return parts.map(Number).join('.');
}
export const ipOrder = ip => ip.split('.').map(n => n.padStart(3, '0')).join('.');
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

export function checkLines(text) {
  const lines = text.split(/\r?\n/); while (lines.length && !lines.at(-1).trim()) lines.pop();
  const rules = /^-A/i.test(lines[0]?.trim() || '');
  const seen = [new Map(), new Map(), new Map()];
  const rows = lines.map((original, index) => ({ original, index, output: '', errors: [] }));
  function duplicate(map, key, row, label) {
    const previous = map.get(key);
    if (previous) { if (!previous.errors.includes(label)) previous.errors.push(label); row.errors.push(label); }
    map.set(key, row);
  }
  for (const row of rows) {
    if (rules) {
      const match = row.original.trim().match(/^-A\s+(\d{1,3}(?:\.\d{1,3}){3})\/32\s+DROP$/i);
      const ip = match && ipAddress(match[1]);
      if (!ip) row.errors.push('格式或 IP 有誤');
      else { row.output = `-A ${ip}/32 DROP`; duplicate(seen[0], ip, row, 'IP 重複'); }
    } else {
      const value = row.original.trim().toLowerCase();
      if ((value.match(/ /g) || []).length !== 3) { row.errors.push('空格數有誤'); continue; }
      const [name, mac, rawIp] = value.split(' ');
      if (!/^[0-9a-z-]+$/.test(name)) row.errors.push('名稱有誤');
      duplicate(seen[0], name, row, '名稱重複');
      duplicate(seen[1], mac, row, 'MAC 重複');
      if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) row.errors.push('MAC 有誤');
      const ip = ipAddress(rawIp);
      if (!ip || !ip.startsWith('192.168.1.')) row.errors.push('IP 有誤');
      else if (ip.endsWith('.0')) row.errors.push('IP 為 0');
      else { duplicate(seen[2], ip, row, 'IP 重複'); row.output = `${name} ${mac} ${ip} -`; }
    }
  }
  if (rules) rows.sort((a, b) => (a.output ? ipOrder(a.output.split(' ')[1].split('/')[0]) : a.original).localeCompare(b.output ? ipOrder(b.output.split(' ')[1].split('/')[0]) : b.original));
  return { rules, rows };
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
  const rows = parseCsv(csv); const headers = rows.shift()?.map(s => s.trim());
  const cols = ['eventTime', 'dstIp', 'srcIp'].map(h => headers?.indexOf(h) ?? -1);
  if (cols.some(i => i < 0)) throw new Error('CSV 需要 eventTime、dstIp、srcIp 欄位');
  const latest = new Map(); let skipped = 0;
  for (const row of rows) {
    const date = timestamp(row[cols[0]]); if (!Number.isFinite(date)) { skipped++; continue; }
    for (const col of cols.slice(1)) {
      const ip = ipAddress(row[col] || ''); if (!ip) { if (row[col]?.trim()) skipped++; continue; }
      if (!latest.has(ip) || date > latest.get(ip).date) latest.set(ip, { date, time: row[cols[0]].trim() });
    }
  }
  const next = new Map(entries.map(e => [e.ip, { ...e }])); const counts = {};
  for (const [ip, event] of latest) {
    if (exclusions.includes(ip)) { counts[ip] = 1; continue; }
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
