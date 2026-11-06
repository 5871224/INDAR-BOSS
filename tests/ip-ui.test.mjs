import { test } from 'node:test';
import assert from 'node:assert/strict';

// Exercise actual DOM event handlers and their shared API requests.
test('排除表格可貼上 Excel 資料、驗證與儲存到資料庫', async () => {
  const elements = new Map();
  const element = () => ({
    value: '', textContent: '', hidden: true, files: [], dataset: {}, style: {}, open: false, children: [], listeners: {}, attributes: {},
    classList: { toggle() {} },
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = [...items]; },
    setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(name, fn) { this.listeners[name] = fn; }, focus() { this.focused = true; },
    showModal() { this.open = true; }, close() { this.open = false; },
    querySelector(selector) {
      const index = selector.match(/^\[data-index="(\d+)"\]$/)?.[1];
      function find(node) { if (node.dataset.index === index && index !== undefined) return node; for (const child of node.children) { const found = find(child); if (found) return found; } return null; }
      return find(this);
    }
  });
  globalThis.document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element };
  globalThis.window = { frameElement: null, top: { indarAuth: { goToLogin() {} } } };
  let approve = true; globalThis.confirm = () => approve;
  globalThis.localStorage = { getItem() { throw new Error('unexpected localStorage read') }, setItem() { throw new Error('unexpected localStorage write') }, removeItem() { throw new Error('unexpected localStorage removal') } };
  let shared = { entries: [{ ip: '4.4.4.4', time: '2025/1/1' }], exclusions: ['8.8.8.8'], threshold: 6, revision: 0 }, fail = false;
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
  const input = index => $('exclusionRows').querySelector(`[data-index="${index}"]`);
  const paste = (index, text) => { let prevented = false; $('exclusionRows').listeners.paste({ target: input(index), clipboardData: { getData: () => text }, preventDefault() { prevented = true; } }); return prevented; };
  const change = (id, text) => { const target = $(id); target.files = [{ text: async () => text }]; return target.onchange({ target }); };
  await import('../pages/ip/app.js?shared'); await new Promise(resolve => setImmediate(resolve));
  $('openExclusions').onclick(); assert.equal($('exclusionDialog').open, true);
  assert.equal(input(0).value, '8.8.8.8'); assert.equal(input(1).value, '');
  assert.equal(paste(1, ' 7.7.7.7\t1.2.3.4\r\n9.9.9.9\t\r\n'), true);
  assert.equal(input(0).value, '8.8.8.8'); assert.equal(input(1).value, '7.7.7.7'); assert.equal(input(3).value, '9.9.9.9');
  assert.equal(window.hasUnsavedExclusions(), true);
  let prevented = false; $('exclusionRows').listeners.keydown({ target: input(1), key: 'ArrowDown', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(input(2).focused, true);
  $('addExclusion').onclick(); assert.equal(input(5).value, '');
  $('exclusionRows').listeners.click({ target: { dataset: { remove: '5' } } }); assert.equal(input(5), null);
  approve = false; paste(0, '1.1.1.1\n2.2.2.2'); assert.equal(input(0).value, '8.8.8.8'); approve = true;
  fail = true; await $('saveExclusions').onclick();
  assert.equal($('exclusionDialog').open, true); assert.match($('exclusionStatus').textContent, /其他使用者/);
  fail = false; await $('saveExclusions').onclick();
  assert.equal($('exclusionDialog').open, false); assert.deepEqual(shared.exclusions, ['8.8.8.8', '7.7.7.7', '1.2.3.4', '9.9.9.9']);
  $('openExclusions').onclick(); input(4).value = 'bad-ip'; $('exclusionRows').listeners.input({ target: input(4) });
  await $('saveExclusions').onclick(); assert.match($('exclusionStatus').textContent, /第 5 列 IP 格式有誤/); assert.equal(input(4).attributes['aria-invalid'], 'true');
  $('cancelExclusions').onclick();
  await change('events', 'eventTime,dstIp,srcIp\n2025-01-02 10:00:00,7.7.7.7,1.2.3.5');
  assert.equal(shared.entries.some(e => e.ip === '7.7.7.7'), false);
  assert.equal(shared.entries.some(e => e.ip === '1.2.3.5'), true);
  const before = JSON.stringify(shared);
  await change('list', 'IP,更新時間\nnot-ip,2025/1/2');
  assert.equal(JSON.stringify(shared), before);
});
