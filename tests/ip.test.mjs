import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipAddress, mergeEvents, parseCsv, rulesFor, timestamp } from '../pages/ip/logic.js';

test('檢查 IP 格式', () => {
  assert.equal(ipAddress('192.168.001.002'), '192.168.1.2');
  assert.equal(ipAddress('192.168.1.256'), null);
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
