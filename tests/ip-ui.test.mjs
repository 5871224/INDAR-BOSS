import { test } from 'node:test';
import assert from 'node:assert/strict';

// Exercise the real event handlers with a tiny DOM, without a browser dependency.
test('匯入前檢查排除編輯，讀取失敗時保護原始資料', async () => {
  const elements = new Map();
  const element = () => ({ value: '', textContent: '', files: [], dataset: {}, classList: { toggle() {} }, append() {}, replaceChildren() {}, setAttribute() {} });
  globalThis.document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element };
  globalThis.fetch = async () => ({ ok: true });
  globalThis.confirm = () => true;
  let saved = null;
  globalThis.localStorage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const $ = id => document.getElementById(id);
  const change = (id, text) => { const target = $(id); target.files = [{ text: async () => text }]; return target.onchange({ target }); };
  await import('../pages/ip/app.js?normal'); await new Promise(resolve => setImmediate(resolve));
  await change('list', 'IP,轉格式,更新時間,排除IP\n001.002.003.004,,2025/1/2,9.9.9.9\n,,,8.8.8.8');
  assert.equal(JSON.parse(saved).entries[0].ip, '1.2.3.4');
  assert.deepEqual(JSON.parse(saved).exclusions, ['9.9.9.9', '8.8.8.8']);
  const before = saved; $('exclusions').value += '\n7.7.7.7';
  await change('events', 'eventTime,dstIp,srcIp\n2025-01-02 10:00:00,7.7.7.7,1.2.3.5');
  assert.equal(saved, before); assert.match($('blockStatus').textContent, /未儲存/);
  $('saveExclusions').onclick();
  await change('events', 'eventTime,dstIp,srcIp\n2025-01-02 10:00:00,7.7.7.7,1.2.3.5');
  assert.equal(JSON.parse(saved).entries.some(e => e.ip === '7.7.7.7'), false);
  assert.match($('excludeCounts').textContent, /7\.7\.7\.7：1/);
  const beforeInvalid = saved;
  await change('list', 'IP,更新時間\nnot-ip,2025/1/2');
  assert.equal(saved, beforeInvalid);
  elements.clear(); saved = '{broken';
  await import('../pages/ip/app.js?broken'); await new Promise(resolve => setImmediate(resolve));
  $('threshold').value = '5'; $('setThreshold').onclick();
  assert.equal(saved, '{broken'); assert.match($('blockStatus').textContent, /讀取失敗/);
});
