import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipAddress, exclusionPattern, matchesExclusion, wildcardSearch, displayDate, mergeEvents, parseCsv, rulesFor, timestamp } from '../pages/ip/logic.js';

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

test('萬用字元排除 IP 與文字搜尋', () => {
  assert.equal(exclusionPattern('220.130.148.*'), '220.130.148.*');
  assert.equal(exclusionPattern('220.130.001.*'), '220.130.1.*');
  assert.equal(exclusionPattern('220.*.148.*'), '220.*.148.*');
  assert.equal(exclusionPattern('220.130.148.256'), null);
  assert.equal(exclusionPattern('220.130.148.1*'), null);
  assert.equal(exclusionPattern('220.130.*'), null);
  assert.equal(matchesExclusion('220.130.148.6','220.130.148.*'), true);
  assert.equal(matchesExclusion('220.130.149.6','220.130.148.*'), false);
  const csv = 'eventTime,dstIp,srcIp\n2026/11/6 10:15:11,220.130.148.6,8.8.8.8\n2026/11/6 10:17:12,220.130.148.5,220.131.148.5';
  const result = mergeEvents([], ['220.130.148.*','8.8.8.8'], csv);
  assert.deepEqual(result.entries.map(row => row.ip), ['220.131.148.5']);
  assert.equal(result.counts['220.130.148.*'],2);
  assert.equal(result.counts['8.8.8.8'],1);
  assert.equal(displayDate('2026/11/6 10:15:11'), '2026/11/6');
  assert.equal(displayDate('2026-11-06T08:15:00Z'), '2026/11/06');
  assert.equal(wildcardSearch('220.130.148.6','220.*.148.*'), true);
  assert.equal(wildcardSearch('2026/11/6','2026*11*6'), true);
  assert.equal(wildcardSearch('2026/11/6','2025*'), false);
});

test('多個 CSV 一次合併去重、取最新事件，且任何檔案錯誤都拒絕匯入', () => {
  const files = [
    { name: '第一份.csv', text: 'eventTime,dstIp,srcIp\n2026-11-05 09:00:00,1.2.3.4,8.8.8.8\n2026-11-05 10:00:00,1.2.3.5,1.2.3.4' },
    { name: '第二份.csv', text: 'eventTime,dstIp,srcIp\n2026-11-06 11:00:00,1.2.3.4,1.2.3.6\ninvalid,1.2.3.9,1.2.3.10' }
  ];
  const original = [{ ip: '1.2.3.4', time: '2026-11-04 07:00:00' }];
  const result = mergeEvents(original, ['8.8.8.*'], files);
  assert.equal(result.count, 4); // Across both files, not summed per file.
  assert.equal(result.skipped, 1);
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries.find(row => row.ip === '1.2.3.4').time, '2026-11-06 11:00:00');
  assert.equal(result.counts['8.8.8.*'], 1);
  assert.deepEqual(original, [{ ip: '1.2.3.4', time: '2026-11-04 07:00:00' }]);
  assert.throws(
    () => mergeEvents(original, [], [...files, { name: '錯誤.csv', text: 'wrong,columns\nx,y' }]),
    /錯誤.csv：CSV 需要/
  );
  const reversed = mergeEvents([], [], [...files].reverse());
  assert.equal(reversed.entries.find(row => row.ip === '1.2.3.4').time, '2026-11-06 11:00:00');
});
