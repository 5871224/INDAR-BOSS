import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('the mirrored header focuses copy actions and yields to the exclusion modal until it closes', () => {
  const app = readFileSync(new URL('../pages/soyal/app.js', import.meta.url), 'utf8')
  const start = app.indexOf('function syncIpHeader()')
  const end = app.indexOf('\nfunction resizeIpFrame()', start)
  assert.ok(start >= 0 && end > start)
  const calls = []
  let sourceFocused = false
  const sourceButton = {
    focus(options) { sourceFocused = true; calls.push({ action: 'focus', preventScroll: options.preventScroll }) },
    click() {
      if (!sourceFocused) throw new Error('Document is not focused.')
      calls.push({ action: 'copy' })
    }
  }
  const listeners = {}
  const proxyButton = { id: 'copyRules', addEventListener: (name, listener) => { listeners[name] = listener } }
  const head = { innerHTML: '<button id="copyRules">複製</button>', rows: [{ cells: [{ getBoundingClientRect: () => ({ width: 200 }) }] }] }
  const table = { tHead: head, getBoundingClientRect: () => ({ width: 200 }) }
  const wrap = { getBoundingClientRect: () => ({ height: 400, top: -300 }) }
  const modal = { open: false }
  const doc = {
    querySelector: selector => selector === '.table-wrap table' ? table : wrap,
    getElementById: id => { if (id === 'exclusionDialog') return modal; assert.equal(id, 'copyRules'); return sourceButton }
  }
  const node = () => ({ style: {}, append() {} })
  const stickyTrack = node()
  let syncHeader, closedMenus = 0
  vm.runInNewContext(`${app.slice(start, end)}; register(syncIpHeader); syncIpHeader();`, {
    ipPage: { hidden: false, contentDocument: doc },
    ipStickyTrack: stickyTrack,
    ipHeaderSignature: '',
    ipStickyBar: { replaceChildren() {}, querySelectorAll: () => [proxyButton] },
    closeIpProxyMenu: () => { closedMenus++ },
    register: callback => { syncHeader = callback },
    document: { createElement: node, importNode: () => head }
  })
  listeners.click()
  assert.deepEqual(calls, [{ action: 'focus', preventScroll: true }, { action: 'copy' }])
  assert.equal(stickyTrack.hidden, false)
  modal.open = true
  syncHeader()
  assert.equal(stickyTrack.hidden, true)
  assert.equal(closedMenus, 1)
  modal.open = false
  syncHeader()
  assert.equal(stickyTrack.hidden, false)
})
