// The RepoHQ usage beacon: the browser script run in a fake browser (node:vm), and which
// pages load it. Nothing here reaches the network: fetch is a recorder.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { SIGNAL_URL, beaconClient } from '../src/beacon.js'
import { formClient } from '../src/client.js'
import { createApp } from '../src/web.js'
import { PUBLIC_PATHS } from '../src/pages.js'
import { checkoutEvent, generatePage, makeTestApp, postWebhook, silentLog } from './helpers.js'

const ORIGIN = 'https://giftlet.example'

// A storage that can be shared between "page loads" (pass the same Map) or made to throw.
function fakeStorage(map, broken) {
  return {
    getItem(key) {
      if (broken) throw new Error('SecurityError')
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      if (broken) throw new Error('QuotaExceededError')
      map.set(key, String(value))
    },
  }
}

// Loads the beacon into a fresh page and returns what it sent plus a way to fire events.
function loadPage({
  page = 'public',
  referrer = '',
  webdriver = false,
  local = new Map(),
  session = new Map(),
  brokenStorage = false,
  fetch,
} = {}) {
  const sent = []
  const listeners = {}
  const context = {
    window: { localStorage: fakeStorage(local, brokenStorage), sessionStorage: fakeStorage(session, brokenStorage) },
    document: {
      referrer,
      currentScript: { dataset: page ? { page } : {} },
      addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    },
    navigator: { webdriver },
    location: { origin: ORIGIN, href: `${ORIGIN}/p/AbCdEfGhIjKlMnOpQrSt_-` },
    URL,
    fetch:
      fetch ??
      ((url, init) => {
        sent.push({ url, init, body: JSON.parse(init.body) })
        return Promise.resolve(new Response(null, { status: 204 }))
      }),
  }
  vm.runInNewContext(`(${beaconClient})()`, context)
  const fire = (type, event = {}) => (listeners[type] ?? []).forEach((fn) => fn(event))
  const clickOn = (matches) => fire('click', { target: { closest: (selector) => (matches(selector) ? {} : null) } })
  return { sent, fire, clickOn, local, session }
}

const kinds = (sent) => sent.map((s) => s.body.kind)

describe('beacon: what it sends', () => {
  test('a visit to a public page: one fire-and-forget JSON POST with keepalive and no cookies', () => {
    const { sent } = loadPage({ referrer: 'https://www.reddit.com/r/LongDistance/' })
    assert.equal(sent.length, 1)
    const [{ url, init, body }] = sent
    assert.equal(url, 'https://repohq.vercel.app/api/ideas/signal')
    assert.equal(url, SIGNAL_URL)
    assert.equal(init.method, 'POST')
    assert.equal(init.keepalive, true)
    assert.equal(init.credentials, 'omit')
    assert.equal(init.headers['content-type'], 'application/json')
    assert.deepEqual(body, { slug: 'giftlet', kind: 'visit', referrer: 'https://www.reddit.com/r/LongDistance/' })
  })

  test('the referrer is sent only when it is another site; our own pages (and gift links) never leave', () => {
    for (const referrer of ['', `${ORIGIN}/p/AbCdEfGhIjKlMnOpQrSt_-`, `${ORIGIN}/birthday`, 'not a url']) {
      const { sent } = loadPage({ referrer })
      assert.equal(sent[0].body.referrer, null, referrer)
    }
    const { sent } = loadPage({ referrer: 'https://giftlet.example.evil.test/x' })
    assert.equal(sent[0].body.referrer, 'https://giftlet.example.evil.test/x')
  })

  test('the payload is exactly slug, kind and referrer: never the page address', () => {
    const { sent, fire, clickOn } = loadPage({ page: 'public' })
    fire('giftlet:activate')
    clickOn((s) => s === '[data-signal="checkout"]')
    assert.deepEqual(kinds(sent), ['visit', 'activate', 'checkout'])
    for (const { init, body } of sent) {
      assert.deepEqual(Object.keys(body), ['slug', 'kind', 'referrer'])
      assert.ok(!init.body.includes('/p/'), 'no gift link in the body')
    }
  })
})

describe('beacon: when it sends', () => {
  test('visit: once per browser session', () => {
    const local = new Map()
    const session = new Map()
    assert.deepEqual(kinds(loadPage({ local, session }).sent), ['visit'])
    assert.deepEqual(kinds(loadPage({ local, session }).sent), [], 'second page, same session')
    assert.deepEqual(kinds(loadPage({ local, session: new Map() }).sent), ['visit'], 'a new session')
  })

  test('visit: only on public pages (gift pages load the beacon for the Buy button only)', () => {
    assert.deepEqual(kinds(loadPage({ page: 'private' }).sent), [])
    assert.deepEqual(kinds(loadPage({ page: null }).sent), [])
  })

  test('activate: the first page made in this browser, once ever', () => {
    const local = new Map()
    const first = loadPage({ local })
    first.fire('giftlet:activate')
    first.fire('giftlet:activate')
    assert.deepEqual(kinds(first.sent), ['visit', 'activate'])
    const later = loadPage({ local, session: new Map() })
    later.fire('giftlet:activate')
    assert.deepEqual(kinds(later.sent), ['visit'], 'a later session: no second activate')
  })

  test('checkout: every click on the Buy button, and only on it', () => {
    const { sent, clickOn } = loadPage({ page: 'private' })
    clickOn(() => false)
    assert.deepEqual(kinds(sent), [])
    clickOn((s) => s === '[data-signal="checkout"]')
    clickOn((s) => s === '[data-signal="checkout"]')
    assert.deepEqual(kinds(sent), ['checkout', 'checkout'])
  })
})

describe('beacon: when it sends nothing', () => {
  test('automated browsers (navigator.webdriver), for every event', () => {
    const { sent, fire, clickOn, session, local } = loadPage({ webdriver: true })
    fire('giftlet:activate')
    clickOn(() => true)
    assert.deepEqual(sent, [])
    assert.equal(session.size, 0, 'nothing remembered either')
    assert.equal(local.size, 0)
  })

  test('the owner\'s browser (localStorage "repohq:notrack"), for every event', () => {
    const local = new Map([['repohq:notrack', '1']])
    const { sent, fire, clickOn, session } = loadPage({ local })
    fire('giftlet:activate')
    clickOn(() => true)
    assert.deepEqual(sent, [])
    assert.equal(session.size, 0)
    assert.ok(!local.has('repohq:activate'))
  })

  test('blocked storage: nothing is sent and nothing throws', () => {
    const { sent, fire, clickOn } = loadPage({ brokenStorage: true })
    fire('giftlet:activate')
    clickOn(() => true)
    assert.deepEqual(sent, [])
  })

  test('a failing network never breaks the page', async () => {
    assert.doesNotThrow(() =>
      loadPage({
        fetch: () => {
          throw new TypeError('Failed to fetch')
        },
      }),
    )
    let rejected = false
    loadPage({ fetch: () => Promise.reject(new TypeError('offline')).finally(() => (rejected = true)) })
    await new Promise((resolve) => setImmediate(resolve))
    assert.ok(rejected)
  })
})

describe('beacon: which pages load it', () => {
  const BEACON = /<script src="\/beacon\.js" data-page="(public|private)" defer><\/script>/

  test('off by default (local runs, previews, tests): no page loads it', async () => {
    const { app } = await makeTestApp({ paymentLink: 'https://example.com/pay' })
    for (const path of PUBLIC_PATHS) assert.doesNotMatch(await (await app.request(path)).text(), /beacon\.js/, path)
    const { html } = await generatePage(app)
    assert.doesNotMatch(html, /beacon\.js/)
  })

  test('in production: every public page with data-page="public"', async () => {
    const app = createApp({ store: null, beacon: true, log: silentLog })
    for (const path of PUBLIC_PATHS) {
      assert.equal((await (await app.request(path)).text()).match(BEACON)?.[1], 'public', path)
    }
  })

  test('in production: an unpaid page with a Buy button (and its 402 page) loads it as "private"; paid, removed and error pages do not', async () => {
    const { app } = await makeTestApp({ paymentLink: 'https://example.com/pay', beacon: true })
    const { slug, html } = await generatePage(app)
    assert.equal(html.match(BEACON)?.[1], 'private')
    assert.equal((await (await app.request(`/p/${slug}/print`)).text()).match(BEACON)?.[1], 'private')
    await postWebhook(app, checkoutEvent({ slug }))
    assert.doesNotMatch(await (await app.request(`/p/${slug}`)).text(), /beacon\.js/)
    for (const path of ['/nope', `/p/${slug}/takedown`, '/paid']) {
      assert.doesNotMatch(await (await app.request(path)).text(), /beacon\.js/, path)
    }
  })

  test('in production without payments: no Buy button, so the gift page does not load it', async () => {
    const { app } = await makeTestApp({ createCheckout: null, beacon: true })
    const { html } = await generatePage(app)
    assert.doesNotMatch(html, /beacon\.js/)
  })

  test('/beacon.js is served as JavaScript that parses, and the CSP lets it reach RepoHQ only', async () => {
    const app = createApp({ store: null, log: silentLog })
    const res = await app.request('/beacon.js')
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /^text\/javascript/)
    const code = await res.text()
    assert.doesNotThrow(() => new Function(code))
    assert.ok(code.includes(SIGNAL_URL))
    const csp = (await app.request('/')).headers.get('content-security-policy')
    const connect = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src'))
    assert.equal(connect, "connect-src 'self' https://repohq.vercel.app")
  })

  test('the form script announces "activate" only after /generate succeeded, before leaving for the new page', () => {
    const code = String(formClient)
    const ok = code.indexOf('if (!res.ok) throw')
    const activate = code.indexOf("dispatchEvent(new Event('giftlet:activate'))")
    const leave = code.indexOf('window.location.assign(body.url)')
    assert.ok(ok > 0 && activate > ok && leave > activate, 'res.ok check → activate → navigate')
  })
})
