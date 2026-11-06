import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLines, ipAddress, mergeEvents, parseCsv, rulesFor, timestamp } from '../pages/ip/logic.js';

test('檢查兩種格式與重複資料', () => {
  assert.equal(ipAddress('192.168.001.002'), '192.168.1.2');
  assert.equal(ipAddress('192.168.1.256'), null);
  const input = 'PC-1 aa:bb:cc:dd:ee:ff 192.168.1.02 -\npc-1 aa:bb:cc:dd:ee:ff 192.168.1.2 -';
  const rows = checkLines(input).rows;
  assert.equal(rows[0].output, 'pc-1 aa:bb:cc:dd:ee:ff 192.168.1.2 -');
  for (const row of rows) assert.deepEqual(row.errors, ['名稱重複', 'MAC 重複', 'IP 重複']);
  const rules = checkLines('-A 1.2.3.010/32 DROP\n-A 1.2.3.10/32 DROP\n-A 1.2.3.999/32 DROP').rows;
  assert.equal(rules.filter(r => r.errors.includes('IP 重複')).length, 2);
  assert.equal(rules.filter(r => r.errors.includes('格式或 IP 有誤')).length, 1);
});

test('CSV 與事件合併、排除、網段合併及時間', () => {
  assert.deepEqual(parseCsv('a,b\r\n"hello,world","x""y"\r\n'), [['a','b'],['hello,world','x"y']]);
  assert.throws(() => parseCsv('"unterminated'));
  assert.ok(Number.isNaN(timestamp('2025-02-29 00:00:00')));
  assert.equal(timestamp('2025-01-01T08:00:00+08:00'), timestamp('2025-01-01T00:00:00Z'));
  const csv = 'eventTime,dstIp,srcIp\n2025-01-01 10:00:00,1.2.3.1,9.9.9.9\n2025-01-02 10:00:00,1.2.3.1,1.2.3.2';
  const result = mergeEvents([], ['9.9.9.9'], csv);
  assert.equal(result.entries.length, 2); assert.equal(result.counts['9.9.9.9'], 1);
  assert.equal(result.entries.find(e => e.ip === '1.2.3.1').time, '2025-01-02 10:00:00');
  assert.deepEqual(rulesFor(result.entries, 2).map(r => r.rule), ['-A 1.2.3.0/24 DROP', '-A 1.2.3.0/24 DROP']);
  assert.throws(() => mergeEvents([], [], 'eventTime,dstIp\n'));
});
