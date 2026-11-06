import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const script = readFileSync(new URL('../pages/soyal/app.js', import.meta.url), 'utf8').replace(/^import .*;\s*$/gm, '')
const settle = () => new Promise(resolve => setImmediate(resolve))

async function fixture({ access = [401] } = {}) {
  const elements = new Map(), requests = [], redirects = []
  class Element {
    constructor(tag) {
      this.tag = tag; this.hidden = false; this.value = ''; this.disabled = false; this.textContent = ''; this.listeners = {}; this.dataset = {}
      const classes = new Set()
      this.classList = {
        add: name => classes.add(name), remove: name => classes.delete(name),
        toggle: (name, value) => value ? classes.add(name) : classes.delete(name)
      }
    }
    addEventListener(name, callback) { this.listeners[name] = callback }
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
  vm.runInNewContext(script, {
    document: {
      querySelector(selector) { const element = elements.get(selector.slice(1)); assert.ok(element, selector); return element },
      querySelectorAll() { return [] },
      getElementById(id) { return elements.get(id) }
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, options })
      let status = 200, body = {}
      if (url === './api/access') {
        status = access[Math.min(accessIndex++, access.length - 1)]
        body = status === 200 ? { allowed: true } : { error: status === 403 ? '尚未授權' : '請先登入' }
      } else if (url.startsWith('./api/settings?type=')) body = { data: [] }
      else throw new Error(`unexpected request: ${url}`)
      return { ok: status === 200, status, json: async () => body }
    },
    window: { indarAuth: { goToLogin: target => redirects.push(target) } }
  })
  await settle()
  return {
    elements, requests, redirects
  }
}

test('logged-out visitors use the shared login page and SOYAL stays closed', async () => {
  const f = await fixture()
  assert.deepEqual(f.redirects, ['/soyal/'])
  assert.equal(f.elements.get('appShell').hidden, true)
  assert.equal(f.requests.filter(item => item.url === './api/access').length, 1)
})

test('the shared login page returns to SOYAL and permission is checked before opening', async () => {
  const f = await fixture({ access: [200] })
  assert.equal(f.requests.filter(item => item.url === './api/access').length, 1)
  assert.equal(f.requests.filter(item => item.url.startsWith('./api/settings?')).length, 2)
  assert.equal(f.elements.get('appShell').hidden, false)
  assert.deepEqual(f.redirects, [])
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
