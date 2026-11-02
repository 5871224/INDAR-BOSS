import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const script = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/^import .*;\s*$/gm, '')
const settle = () => new Promise(resolve => setImmediate(resolve))

async function fixture({ access = [401], signInStatus = 200 } = {}) {
  const elements = new Map(), requests = []
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
  // The real page hides the application and form until their status is known.
  elements.get('appShell').hidden = true
  elements.get('loginForm').hidden = true
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
      } else if (url === '/sched/api/v1/auth/sign-in') {
        status = signInStatus
        body = status === 200 ? { authenticated: true } : { error: { message: '員工代碼或密碼不正確' } }
      } else if (url.startsWith('./api/settings?type=')) body = { data: [] }
      else throw new Error(`unexpected request: ${url}`)
      return { ok: status === 200, status, json: async () => body }
    }
  })
  await settle()
  return {
    elements, requests,
    async login(account, password) {
      elements.get('loginUser').value = account
      elements.get('loginPassword').value = password
      await elements.get('loginForm').listeners.submit({ preventDefault() {} })
      await settle()
    }
  }
}

test('logged-out visitors see an inline login form and failed passwords do not open SOYAL', async () => {
  const f = await fixture({ signInStatus: 401 })
  assert.equal(f.elements.get('loginForm').hidden, false)
  assert.equal(f.elements.get('appShell').hidden, true)
  await f.login(' 0270 ', 'wrong')
  const request = f.requests.find(item => item.url.endsWith('/auth/sign-in'))
  assert.deepEqual(JSON.parse(request.options.body), { loginAccount: '0270', password: 'wrong' })
  assert.equal(request.options.credentials, 'same-origin')
  assert.equal(f.elements.get('accessMessage').textContent, '員工代碼或密碼不正確')
  assert.equal(f.elements.get('loginPassword').value, '')
  assert.equal(f.elements.get('appShell').hidden, true)
  assert.equal(f.requests.filter(item => item.url === './api/access').length, 1)
})

test('after sign-in the SOYAL permission is checked before the application opens', async () => {
  const f = await fixture({ access: [401, 200] })
  await f.login('0270', 'password')
  assert.equal(f.requests.filter(item => item.url === './api/access').length, 2)
  assert.equal(f.requests.filter(item => item.url.startsWith('./api/settings?')).length, 2)
  assert.equal(f.elements.get('appShell').hidden, false)
  assert.equal(f.elements.get('loginForm').hidden, true)
  assert.equal(f.elements.get('loginPassword').value, '')
})

test('an authenticated employee without SOYAL permission remains locked out', async () => {
  const f = await fixture({ access: [401, 403] })
  await f.login('0270', 'password')
  assert.equal(f.elements.get('appShell').hidden, true)
  assert.equal(f.elements.get('loginForm').hidden, false)
  assert.match(f.elements.get('accessMessage').textContent, /尚未開放使用 SOYAL/)
  assert.equal(f.requests.filter(item => item.url.startsWith('./api/settings?')).length, 0)
})

test('an already authenticated and authorized visitor enters without signing in again', async () => {
  const f = await fixture({ access: [200] })
  assert.equal(f.elements.get('appShell').hidden, false)
  assert.equal(f.elements.get('loginForm').hidden, true)
  assert.equal(f.requests.some(item => item.url.endsWith('/auth/sign-in')), false)
})
