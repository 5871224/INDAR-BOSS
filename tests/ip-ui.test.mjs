import { test } from 'node:test';
import assert from 'node:assert/strict';

// Exercise the actual event handlers against a simulated shared API.
test('排除設定視窗、匯入 CSV 與本機舊資料均安全寫入共用清單', async () => {
  const elements = new Map();
  const element = () => ({ value: '', textContent: '', hidden: true, files: [], dataset: {}, style: {}, open: false, classList: { toggle() {} }, append() {}, replaceChildren() {}, setAttribute() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; } });
  globalThis.document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element };
  globalThis.window = { frameElement: null, top: { indarAuth: { goToLogin() {} } } };
  globalThis.confirm = () => true;
  const legacy = JSON.stringify({ entries: [{ ip: '4.4.4.4', time: '2025/1/1' }], exclusions: ['8.8.8.8'], threshold: 6 });
  const local = new Map([['indar-boss-ip-v1', legacy]]);
  globalThis.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) };
  let shared = { entries: [], exclusions: [], threshold: 4, revision: 0 }, fail = false;
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/api/access')) return { ok: true };
    assert.equal(url, '../../api/ip-state');
    if (options.method === 'PUT') {
      if (fail) return { ok: false, status: 409, json: async () => ({ error: '清單已被其他使用者更新' }) };
      const body = JSON.parse(options.body); assert.equal(body.revision, shared.revision);
      shared = { ...body, revision: body.revision + 1 };
    }
    return { ok: true, json: async () => ({ data: structuredClone(shared) }) };
  };
  const $ = id => document.getElementById(id);
  const change = (id, text) => { const target = $(id); target.files = [{ text: async () => text }]; return target.onchange({ target }); };
  await import('../pages/ip/app.js?shared'); await new Promise(resolve => setImmediate(resolve));
  assert.equal($('importLocal').hidden, false);
  await $('importLocal').onclick();
  assert.deepEqual(shared.entries, [{ ip: '4.4.4.4', time: '2025/1/1' }]);
  assert.deepEqual(shared.exclusions, ['8.8.8.8']);
  assert.equal(local.get('indar-boss-ip-v1'), legacy);
  $('openExclusions').onclick(); assert.equal($('exclusionDialog').open, true);
  $('exclusions').value += '\n7.7.7.7'; assert.equal(window.hasUnsavedExclusions(), true);
  fail = true; await $('saveExclusions').onclick();
  assert.equal($('exclusionDialog').open, true); assert.match($('exclusionStatus').textContent, /其他使用者/);
  fail = false; await $('saveExclusions').onclick();
  assert.equal($('exclusionDialog').open, false); assert.deepEqual(shared.exclusions, ['8.8.8.8', '7.7.7.7']);
  await change('events', 'eventTime,dstIp,srcIp\n2025-01-02 10:00:00,7.7.7.7,1.2.3.5');
  assert.equal(shared.entries.some(e => e.ip === '7.7.7.7'), false);
  assert.equal(shared.entries.some(e => e.ip === '1.2.3.5'), true);
  const before = JSON.stringify(shared);
  await change('list', 'IP,更新時間\nnot-ip,2025/1/2');
  assert.equal(JSON.stringify(shared), before);
});
