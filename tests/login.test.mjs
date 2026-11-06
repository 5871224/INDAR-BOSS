import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const script = readFileSync(new URL('../pages/soyal/app.js', import.meta.url), 'utf8').replace(/^import .*;\s*$/gm, '')
const settle = () => new Promise(resolve => setImmediate(resolve))

async function fixture({ access = [401], hash = '', signout = 200, settings = 200 } = {}) {
  const elements = new Map(), requests = [], redirects = [], windowListeners = {}
  class Element {
    constructor(tag) {
      this.tag = tag; this.hidden = false; this.value = ''; this.disabled = false; this.textContent = ''; this.listeners = {}; this.dataset = {}; this.attributes = {}; this.style = {}
      const classes = new Set()
      this.classList = {
        add: name => classes.add(name), remove: name => classes.delete(name),
        toggle: (name, value) => value ? classes.add(name) : classes.delete(name)
      }
    }
    addEventListener(name, callback) { this.listeners[name] = callback }
    setAttribute(name, value) { this.attributes[name] = value }
    getAttribute(name) { return this.attributes[name] || null }
    close() { this.open = false }
    showModal() { this.open = true }
  }
  for (const [, tag, attributes, id] of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const element = new Element(tag)
    element.hidden = /\bhidden\b/.test(attributes)
    elements.set(id, element)
  }
  // The real page hides the application until its access status is known.
  elements.get('appShell').hidden = true
  let accessIndex = 0
  const location = { hash }
  vm.runInNewContext(script, {
    document: {
      body: new Element('body'),
      querySelector(selector) { const element = elements.get(selector.slice(1)); assert.ok(element, selector); return element },
      querySelectorAll() { return [] },
      getElementById(id) { return elements.get(id) }
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, options })
      let status = 200, body = {}
      if (url === './api/access') {
        status = access[Math.min(accessIndex++, access.length - 1)]
        body = status === 200 ? { allowed: true, user: { name: '測試', code: '0001' } } : { error: status === 403 ? '尚未授權' : '請先登入' }
      } else if (url.startsWith('./api/settings?type=')) { status = settings; body = { data: [], error: '設定失敗' } }
      else if (url === '/sched/api/v1/auth/sign-out') { status = signout; body = { error: '登出失敗' } }
      else throw new Error(`unexpected request: ${url}`)
      return { ok: status === 200, status, json: async () => body }
    },
    location,
    window: { addEventListener(name, callback) { windowListeners[name] = callback }, indarAuth: { goToLogin: target => redirects.push(target) } }
  })
  await settle()
  return {
    elements, requests, redirects, location, windowListeners
  }
}

test('logged-out visitors use the shared login page and SOYAL stays closed', async () => {
  const f = await fixture()
  assert.deepEqual(f.redirects, ['/boss/'])
  assert.equal(f.elements.get('appShell').hidden, true)
  assert.equal(f.requests.filter(item => item.url === './api/access').length, 1)
})

test('the shared login page defaults to IP inspection and checks permission before opening', async () => {
  const f = await fixture({ access: [200] })
  assert.equal(f.requests.filter(item => item.url === './api/access').length, 1)
  assert.equal(f.requests.filter(item => item.url.startsWith('./api/settings?')).length, 2)
  assert.equal(f.elements.get('appShell').hidden, false)
  assert.equal(f.elements.get('ipPage').hidden, false)
  assert.equal(f.elements.get('soyalPage').hidden, true)
  assert.equal(f.elements.get('ipTab').attributes['aria-current'], 'page')
  assert.deepEqual(f.redirects, [])
})

test('explicit #soyal URL opens SOYAL without changing the default tab', async () => {
  const f = await fixture({ access: [200], hash: '#soyal' })
  assert.equal(f.elements.get('soyalPage').hidden, false)
  assert.equal(f.elements.get('ipPage').hidden, true)
  assert.equal(f.elements.get('soyalTab').attributes['aria-current'], 'page')
})

test('an authenticated employee without SOYAL permission remains locked out', async () => {
  const f = await fixture({ access: [403] })
  assert.equal(f.elements.get('appShell').hidden, true)
  assert.match(f.elements.get('accessMessage').textContent, /尚未開放使用 BOSS/)
  assert.equal(f.requests.filter(item => item.url.startsWith('./api/settings?')).length, 0)
  assert.deepEqual(f.redirects, [])
})

test('an already authenticated and authorized visitor enters without signing in again', async () => {
  const f = await fixture({ access: [200] })
  assert.equal(f.elements.get('appShell').hidden, false)
  assert.equal(f.requests.some(item => item.url.endsWith('/auth/sign-in')), false)
})

test('IP tab navigation keeps the shell and identity, and sign-out uses the shared session', async () => {
  const f = await fixture({ access: [200], hash: '#ip' })
  assert.equal(f.elements.get('accountName').textContent, '測試（0001）')
  assert.equal(f.elements.get('soyalPage').hidden, true)
  assert.equal(f.elements.get('ipPage').hidden, false)
  f.location.hash = '#soyal'; f.windowListeners.hashchange()
  assert.equal(f.elements.get('soyalPage').hidden, false)
  assert.equal(f.elements.get('ipPage').hidden, true)
  await f.elements.get('logoutBtn').listeners.click()
  assert.equal(f.requests.at(-1).url, '/sched/api/v1/auth/sign-out')
  assert.equal(f.requests.at(-1).options.method, 'POST')
  assert.deepEqual(f.redirects, ['/boss/'])
})

test('failed sign-out stays on the page and reports the error', async () => {
  const f = await fixture({ access: [200], signout: 500 })
  await f.elements.get('logoutBtn').listeners.click()
  assert.deepEqual(f.redirects, [])
  assert.equal(f.elements.get('headerMessage').textContent, '登出失敗')
})

test('an expired sign-out redirects to the shared login page', async () => {
  const f = await fixture({ access: [200], signout: 401 })
  await f.elements.get('logoutBtn').listeners.click()
  assert.deepEqual(f.redirects, ['/boss/'])
})

test('SOYAL settings failure does not block the IP page', async () => {
  const f = await fixture({ access: [200], hash: '#ip', settings: 500 })
  assert.equal(f.elements.get('appShell').hidden, false)
  assert.equal(f.elements.get('ipPage').hidden, false)
  assert.match(f.elements.get('headerMessage').textContent, /設定讀取失敗/)
})

test('an unauthenticated IP link returns to IP after login', async () => {
  const f = await fixture({ hash: '#ip' })
  assert.deepEqual(f.redirects, ['/boss/#ip'])
})

test('IP 內容使用外層頁面捲動，且僅主表格表頭黏附外層視窗', () => {
  const parentCss = readFileSync(new URL('../pages/soyal/styles.css', import.meta.url), 'utf8')
  const ipCss = readFileSync(new URL('../pages/ip/styles.css', import.meta.url), 'utf8')
  assert.match(parentCss, /body\.ip-active\{height:auto;overflow-y:auto\}/)
  assert.match(parentCss, /body\.ip-active #ipPage\{display:block;width:100%;height:150px;overflow:hidden\}/)
  assert.doesNotMatch(parentCss, /body\.ip-active\{height:100dvh;overflow:hidden\}/)
  assert.match(ipCss, /\.table-wrap th\{position:sticky;top:var\(--ip-sticky-top,0px\);transition:none;animation:none\}/)
  assert.match(script, /window\.addEventListener\('scroll', syncIpStickyHeader, \{passive: true\}\)/)
  assert.match(script, /new ResizeObserver\(resizeIpFrame\)/)
})

test('IP 與 SOYAL 共用一致的分頁上方間距', () => {
  const css = readFileSync(new URL('../pages/soyal/styles.css', import.meta.url), 'utf8')
  assert.match(css, /\.header\{background:#f4f7fb;margin:-28px -28px 8px;padding:28px 28px 10px\}/)
  assert.match(css, /@media\(max-width:700px\)\{\.header\{margin:-14px -14px 8px;padding:14px 14px 8px\}\}/)
  assert.doesNotMatch(css, /body\.ip-active \.header\{/)
})

test('SOYAL 標題同列與共用頁面寬度', () => {
  const stylesheet = readFileSync(new URL('../pages/soyal/styles.css', import.meta.url), 'utf8')
  assert.match(html, /<div class="soyal-actions">\s*<h2 class="soyal-title">SOYAL檔案解析<\/h2>\s*<button id="doorSettingsBtn"/)
  assert.doesNotMatch(html, /可同時解析多個 SOYAL \.msg/)
  assert.match(stylesheet, /\.wrap\{max-width:none;width:100%;margin:0;padding:28px\}/)
  assert.match(stylesheet, /\.soyal-actions \.soyal-title\{[^}]*margin:0 auto 0 0\}/)
  assert.match(stylesheet, /#soyalPage\{width:100%;min-width:0\}/)
})

test('SOYAL 主表格使用瀏覽器外層垂直捲軸，換頁返回表格頂部', () => {
  const css = readFileSync(new URL('../pages/soyal/styles.css', import.meta.url), 'utf8')
  assert.match(css, /\.table-card\{padding:0;overflow:visible\}/)
  assert.match(css, /\.table-wrap\{width:100%;max-height:none;overflow:visible\}/)
  assert.doesNotMatch(css, /\.table-wrap\{overflow:auto;max-height:68vh\}/)
  assert.match(script, /currentPage=next;render\(\);paginationBar\.scrollIntoView\?\.\(\{ block: 'start' \}\)/)
  assert.match(css, /#tableWrap table\{border-collapse:separate;border-spacing:0\}/)
  assert.doesNotMatch(script, /tableWrap\.scrollTop=0/)
})

test('IP 與 SOYAL 表格表頭共用加深的藍灰色', () => {
  const ipCss = readFileSync(new URL('../pages/ip/styles.css', import.meta.url), 'utf8')
  const soyalCss = readFileSync(new URL('../pages/soyal/styles.css', import.meta.url), 'utf8')
  for (const css of [ipCss, soyalCss]) {
    assert.match(css, /th\{position:sticky;top:0;background:#d3e0f0;color:#233a57;/)
    assert.match(css, /box-shadow:0 1px 0 #b7c9df/)
  }
  assert.match(soyalCss, /th\.sortable:hover\{background:#bed1e8\}/)
})

test('兩個主表格以原生 sticky 固定表頭，不使用 translate3d 動畫', () => {
  const ipCss = readFileSync(new URL('../pages/ip/styles.css', import.meta.url), 'utf8')
  const soyalCss = readFileSync(new URL('../pages/soyal/styles.css', import.meta.url), 'utf8')
  assert.match(ipCss, /\.table-wrap th\{position:sticky;top:var\(--ip-sticky-top,0px\);transition:none;animation:none\}/)
  assert.match(soyalCss, /th\{position:sticky;top:var\(--soyal-pagination-height,64px\)/)
  assert.match(script, /root\.style\.setProperty\('--ip-sticky-top', value\)/)
  assert.doesNotMatch(script, /translate3d|header\.style\.transform/)
  assert.doesNotMatch(ipCss, /will-change:transform/)
})

test('SOYAL 將分頁控制列放表格上方，固定列動態量測高度', () => {
  const css = readFileSync(new URL('../pages/soyal/styles.css', import.meta.url), 'utf8')
  const tableStart = html.indexOf('<div class="table-wrap" id="tableWrap">')
  const paginationStart = html.indexOf('<div class="pagination" id="pagination">')
  assert.ok(paginationStart > 0 && paginationStart < tableStart)
  assert.match(css, /\.pagination\{position:sticky;top:0;z-index:5;/)
  assert.match(script, /new ResizeObserver\(syncPaginationHeight\)/)
  assert.match(script, /resultSection\.style\.setProperty\?\.\('--soyal-pagination-height'/)
})
