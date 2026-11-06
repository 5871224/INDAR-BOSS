const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function xmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function columnName(index) {
  let n = index + 1, out = '';
  while (n > 0) {
    n--;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function buildSheetXml(headers, rows, widths) {
  const allRows = [headers, ...rows];
  const rowXml = allRows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`;
      if (rowIndex === 0) return `<c r="${ref}" t="inlineStr" s="1"><is><t>${xmlEscape(value)}</t></is></c>`;
      if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');

  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const ref = `A1:${columnName(headers.length - 1)}${Math.max(1, allRows.length)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${ref}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${cols}</cols>
  <sheetData>${rowXml}</sheetData>
  <autoFilter ref="${ref}"/>
</worksheet>`;
}

function workbookParts(sheetName, headers, rows, widths) {
  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
    'xl/worksheets/sheet1.xml': buildSheetXml(headers, rows, widths),
  };
}

let crcTable;
function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}
function crc32(bytes) {
  const table = getCrcTable();
  let c = 0xFFFFFFFF;
  for (const byte of bytes) c = table[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function writeU16(view, offset, value) { view.setUint16(offset, value, true); }
function writeU32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

function makeZip(files) {
  const entries = Object.entries(files).map(([name, content]) => ({
    name,
    nameBytes: encoder.encode(name),
    data: encoder.encode(content),
    offset: 0,
  }));
  entries.forEach(entry => { entry.crc = crc32(entry.data); });

  const localParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    entry.offset = localOffset;
    const header = new Uint8Array(30 + entry.nameBytes.length);
    const view = new DataView(header.buffer);
    writeU32(view, 0, 0x04034B50); writeU16(view, 4, 20); writeU16(view, 6, 0); writeU16(view, 8, 0);
    writeU16(view, 10, 0); writeU16(view, 12, 0); writeU32(view, 14, entry.crc);
    writeU32(view, 18, entry.data.length); writeU32(view, 22, entry.data.length);
    writeU16(view, 26, entry.nameBytes.length); writeU16(view, 28, 0); header.set(entry.nameBytes, 30);
    localParts.push(header, entry.data);
    localOffset += header.length + entry.data.length;
  }

  const centralParts = [];
  let centralSize = 0;
  for (const entry of entries) {
    const header = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(header.buffer);
    writeU32(view, 0, 0x02014B50); writeU16(view, 4, 20); writeU16(view, 6, 20); writeU16(view, 8, 0); writeU16(view, 10, 0);
    writeU16(view, 12, 0); writeU16(view, 14, 0); writeU32(view, 16, entry.crc); writeU32(view, 20, entry.data.length); writeU32(view, 24, entry.data.length);
    writeU16(view, 28, entry.nameBytes.length); writeU16(view, 30, 0); writeU16(view, 32, 0); writeU16(view, 34, 0); writeU16(view, 36, 0);
    writeU32(view, 38, 0); writeU32(view, 42, entry.offset); header.set(entry.nameBytes, 46);
    centralParts.push(header); centralSize += header.length;
  }

  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  writeU32(view, 0, 0x06054B50); writeU16(view, 4, 0); writeU16(view, 6, 0);
  writeU16(view, 8, entries.length); writeU16(view, 10, entries.length); writeU32(view, 12, centralSize); writeU32(view, 16, localOffset); writeU16(view, 20, 0);
  return new Blob([...localParts, ...centralParts, end], { type: XLSX_MIME });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportDoorExcel(rows) {
  const headers = ['門號', '門名稱'];
  const values = rows.map(row => [Number(row.door_no), String(row.door_name ?? '')]);
  downloadBlob(makeZip(workbookParts('門號設定', headers, values, [10, 30])), 'SOYAL_門號設定.xlsx');
}

export function exportUserExcel(rows) {
  const headers = ['使用者位址', '使用者名稱'];
  const values = rows.map(row => [String(Number(row.user_address)).padStart(4, '0'), String(row.user_name ?? '')]);
  downloadBlob(makeZip(workbookParts('使用者設定', headers, values, [16, 30])), 'SOYAL_使用者設定.xlsx');
}

function findEndOfCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) if (view.getUint32(i, true) === 0x06054B50) return i;
  throw new Error('不是有效的 XLSX/ZIP 檔案');
}

function listZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(bytes);
  const total = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let i = 0; i < total; i++) {
    if (view.getUint32(offset, true) !== 0x02014B50) throw new Error('XLSX ZIP 目錄損壞');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('此瀏覽器不支援解壓縮 XLSX');
  let stream;
  try { stream = new DecompressionStream('deflate-raw'); }
  catch { throw new Error('此瀏覽器不支援 XLSX 的 ZIP 壓縮格式'); }
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

async function extractZipEntry(bytes, entries, name) {
  const entry = entries.get(name);
  if (!entry) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(entry.localOffset, true) !== 0x04034B50) throw new Error('XLSX ZIP 項目損壞');
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateRaw(compressed);
  throw new Error(`不支援 XLSX ZIP 壓縮方法 ${entry.method}`);
}
async function extractText(bytes, entries, name) {
  const data = await extractZipEntry(bytes, entries, name);
  return data ? decoder.decode(data) : null;
}
function parseXml(text, label) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`${label} XML 無法解析`);
  return doc;
}
function normalizeTarget(target) {
  const clean = target.replaceAll('\\', '/');
  if (clean.startsWith('/')) return clean.slice(1);
  return clean.startsWith('xl/') ? clean : `xl/${clean}`;
}

async function getWorksheetPath(bytes, entries) {
  const workbookText = await extractText(bytes, entries, 'xl/workbook.xml');
  const relsText = await extractText(bytes, entries, 'xl/_rels/workbook.xml.rels');
  if (!workbookText || !relsText) return 'xl/worksheets/sheet1.xml';
  const workbookDoc = parseXml(workbookText, 'workbook');
  const firstSheet = workbookDoc.getElementsByTagNameNS('*', 'sheet')[0];
  if (!firstSheet) throw new Error('Excel 沒有工作表');
  const relId = firstSheet.getAttribute('r:id') || firstSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const relsDoc = parseXml(relsText, 'workbook relationships');
  const rel = [...relsDoc.getElementsByTagNameNS('*', 'Relationship')].find(node => node.getAttribute('Id') === relId);
  return rel ? normalizeTarget(rel.getAttribute('Target') || 'worksheets/sheet1.xml') : 'xl/worksheets/sheet1.xml';
}

async function getSharedStrings(bytes, entries) {
  const text = await extractText(bytes, entries, 'xl/sharedStrings.xml');
  if (!text) return [];
  const doc = parseXml(text, 'sharedStrings');
  return [...doc.getElementsByTagNameNS('*', 'si')].map(si => [...si.getElementsByTagNameNS('*', 't')].map(t => t.textContent ?? '').join(''));
}
function columnIndexFromRef(ref) {
  const match = String(ref || '').match(/^([A-Z]+)/i);
  if (!match) return -1;
  let n = 0;
  for (const ch of match[1].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}
function cellValue(cell, sharedStrings) {
  const type = cell.getAttribute('t') || '';
  if (type === 'inlineStr') return [...cell.getElementsByTagNameNS('*', 't')].map(t => t.textContent ?? '').join('');
  const v = cell.getElementsByTagNameNS('*', 'v')[0]?.textContent ?? '';
  if (type === 's') return sharedStrings[Number(v)] ?? '';
  if (type === 'str') return v;
  if (type === 'b') return v === '1';
  if (v === '') return '';
  const number = Number(v);
  return Number.isFinite(number) ? number : v;
}

async function readTable(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = listZipEntries(bytes);
  const sheetPath = await getWorksheetPath(bytes, entries);
  const sheetText = await extractText(bytes, entries, sheetPath);
  if (!sheetText) throw new Error('找不到 Excel 工作表資料');
  const sharedStrings = await getSharedStrings(bytes, entries);
  const sheetDoc = parseXml(sheetText, 'worksheet');
  const rows = [...sheetDoc.getElementsByTagNameNS('*', 'row')].map(row => {
    const values = [];
    for (const cell of row.getElementsByTagNameNS('*', 'c')) {
      const col = columnIndexFromRef(cell.getAttribute('r'));
      if (col >= 0) values[col] = cellValue(cell, sharedStrings);
    }
    return values;
  }).filter(row => row.some(value => String(value ?? '').trim() !== ''));
  if (!rows.length) throw new Error('Excel 沒有資料');
  const headers = rows[0].map(value => String(value ?? '').trim());
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function toNonNegativeInteger(value, label, rowNumber) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`第 ${rowNumber} 列「${label}」不可空白`);
  const number = Number(text.replace(/,/g, ''));
  if (!Number.isInteger(number) || number < 0) throw new Error(`第 ${rowNumber} 列「${label}」必須為非負整數`);
  return number;
}
function nonEmptyText(value, label, rowNumber) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`第 ${rowNumber} 列「${label}」不可空白`);
  return text;
}

export async function importDoorExcel(file) {
  const source = await readTable(file);
  const unique = new Map();
  source.forEach((row, index) => {
    const rowNumber = index + 2;
    const door_no = toNonNegativeInteger(row['門號'] ?? row.Door ?? row.door_no, '門號', rowNumber);
    const door_name = nonEmptyText(row['門名稱'] ?? row['名稱'], '門名稱', rowNumber);
    unique.set(String(door_no), { door_no, door_name });
  });
  if (!unique.size) throw new Error('Excel 沒有可匯入的門號設定');
  return [...unique.values()];
}

export async function importUserExcel(file) {
  const source = await readTable(file);
  const unique = new Map();
  source.forEach((row, index) => {
    const rowNumber = index + 2;
    const user_address = toNonNegativeInteger(row['使用者位址'] ?? row.Address ?? row['User Address'], '使用者位址', rowNumber);
    const user_name = nonEmptyText(row['使用者名稱'] ?? row['名稱'] ?? row['姓名'], '使用者名稱', rowNumber);
    unique.set(String(user_address), { user_address, user_name });
  });
  if (!unique.size) throw new Error('Excel 沒有可匯入的使用者設定');
  return [...unique.values()];
}
