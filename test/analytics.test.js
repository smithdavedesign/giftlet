// First-party analytics (src/analytics.js + the /c pixel route), landing page extras,
// and the form's ?occasion= / ?from= handling.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { OCCASIONS } from '../src/answers.js'
import { EVENTS, PIXEL_GIF, formatFunnel, shouldCount } from '../src/analytics.js'
import { LANDING_PAGES } from '../src/pages.js'
import { createApp } from '../src/web.js'
import { BROWSER_UA, generatePage, makeTestApp, silentLog } from './helpers.js'

const browser = { headers: { 'user-agent': BROWSER_UA } }

async function counts(db) {
  const { rows } = await db.query('SELECT event, occasion, count FROM daily_counts ORDER BY event, occasion')
  return rows.map((r) => `${r.event}/${r.occasion}=${r.count}`)
}

const pixels = (html) => [...html.matchAll(/<img class="px" src="([^"]+)"/g)].map((m) => m[1])

describe('shouldCount', () => {
  const req = (headers = {}, method = 'GET') => new Request('http://giftlet.test/c/landing_view/birthday', { method, headers })

  test('counts a GET from a browser', () => {
    assert.equal(shouldCount(req({ 'user-agent': BROWSER_UA })), true)
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    assert.equal(shouldCount(req({ 'user-agent': chrome })), true)
  })

  test('skips crawlers, link previewers, headless browsers, scripts and empty user agents', () => {
    const skipped = [
      '',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.23.20.0',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/128.0.0.0 Safari/537.36',
      'curl/8.5.0',
      'node',
      'python-requests/2.31',
    ]
    for (const ua of skipped) assert.equal(shouldCount(req({ 'user-agent': ua })), false, ua)
  })

  test('skips prefetch/prerender and anything but GET', () => {
    assert.equal(shouldCount(req({ 'user-agent': BROWSER_UA, 'sec-purpose': 'prefetch;prerender' })), false)
    assert.equal(shouldCount(req({ 'user-agent': BROWSER_UA, purpose: 'prefetch' })), false)
    assert.equal(shouldCount(req({ 'user-agent': BROWSER_UA }, 'HEAD')), false)
  })
})

describe('GET /c/:event/:occasion? (the counting pixel)', () => {
  test('answers a no-store 1×1 GIF and counts a browser hit', async () => {
    const { app, db } = await makeTestApp()
    const res = await app.request('/c/landing_view/birthday', browser)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/gif')
    assert.match(res.headers.get('cache-control'), /no-store/)
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(PIXEL_GIF))
    await app.request('/c/landing_view/birthday', browser)
    await app.request('/c/make_click/birthday', browser)
    await app.request('/c/credit_click', browser)
    assert.deepEqual(await counts(db), ['credit_click/=1', 'landing_view/birthday=2', 'make_click/birthday=1'])
  })

  test('the GIF is a real 1×1 GIF', () => {
    const gif = Buffer.from(PIXEL_GIF)
    assert.equal(gif.subarray(0, 6).toString('latin1'), 'GIF89a')
    assert.equal(gif.readUInt16LE(6), 1)
    assert.equal(gif.readUInt16LE(8), 1)
  })

  test('bots get the GIF but are not counted', async () => {
    const { app, db, store } = await makeTestApp()
    await store.ensureSchema()
    const res = await app.request('/c/landing_view/birthday', { headers: { 'user-agent': 'Googlebot/2.1' } })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/gif')
    assert.deepEqual(await counts(db), [])
  })

  test('unknown events and occasions are 404 and never reach the database', async () => {
    const { app, db, store } = await makeTestApp()
    await store.ensureSchema()
    for (const path of ['/c/nope', '/c/landing_view/valentines', '/c/landing_view/toString', '/c/toString', '/c/LANDING_VIEW/birthday']) {
      assert.equal((await app.request(path, browser)).status, 404, path)
    }
    assert.deepEqual(await counts(db), [])
  })

  test('every event in EVENTS is accepted, with and without an occasion', async () => {
    const { app, db } = await makeTestApp()
    for (const event of EVENTS) {
      assert.equal((await app.request(`/c/${event}`, browser)).status, 200)
      for (const occasion of Object.keys(OCCASIONS)) assert.equal((await app.request(`/c/${event}/${occasion}`, browser)).status, 200)
    }
    assert.equal((await counts(db)).length, EVENTS.length * (Object.keys(OCCASIONS).length + 1))
  })

  test('a database failure still answers the GIF and logs a warning', async () => {
    const warnings = []
    const store = {
      countEvent: async () => {
        throw new Error('timeout')
      },
    }
    const app = createApp({ store, log: { ...silentLog, warn: (m) => warnings.push(m) } })
    const res = await app.request('/c/landing_view/birthday', browser)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/gif')
    assert.equal(warnings.length, 1)
  })

  test('without a database it still answers the GIF', async () => {
    const app = createApp({ store: null, log: silentLog })
    const res = await app.request('/c/landing_view/birthday', browser)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/gif')
  })
})

describe('landing pages', () => {
  for (const [occasion, landing] of Object.entries(LANDING_PAGES)) {
    test(`${landing.path} is indexable, cacheable, strict-CSP, and counts its view with a pixel`, async () => {
      const { app, db, store } = await makeTestApp()
      await store.ensureSchema()
      const res = await app.request(landing.path, browser)
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('x-robots-tag'), null)
      assert.match(res.headers.get('cache-control'), /public, max-age=\d+/)
      assert.match(res.headers.get('content-security-policy'), /default-src 'none'/)
      const html = await res.text()
      assert.doesNotMatch(html, /noindex/)
      assert.match(html, /<meta property="og:title" content="[^"]+">/)
      assert.match(html, /<meta property="og:description" content="[^"]+">/)
      assert.ok(html.includes('$9'), 'states the price')
      assert.match(html, /Joke stat/)
      assert.deepEqual(pixels(html), [`/c/landing_view/${occasion}`])
      // Rendering the page writes nothing: only the pixel request counts.
      assert.deepEqual(await counts(db), [])
      // It links to the other occasions.
      for (const other of Object.values(LANDING_PAGES)) {
        if (other !== landing) assert.ok(html.includes(`href="${other.path}"`), other.path)
      }
    })
  }

  test('landing pages render without a database', async () => {
    const app = createApp({ store: null, log: silentLog })
    for (const landing of Object.values(LANDING_PAGES)) assert.equal((await app.request(landing.path)).status, 200)
  })
})

describe('the form: ?occasion= and ?from=', () => {
  const selected = (html) => [...html.match(/<select id="occasion"[\s\S]*?<\/select>/)[0].matchAll(/<option value="([a-z]+)" selected>/g)].map((m) => m[1])

  test('preselects a valid occasion and ignores anything else', async () => {
    const { app } = await makeTestApp()
    for (const occasion of Object.keys(OCCASIONS)) {
      assert.deepEqual(selected(await (await app.request(`/?occasion=${occasion}`)).text()), [occasion])
    }
    for (const query of ['', '?occasion=valentines', '?occasion=toString', '?occasion=%22%3E%3Cscript%3E']) {
      const html = await (await app.request(`/${query}`)).text()
      assert.deepEqual(selected(html), [], query)
      assert.doesNotMatch(html, /<script>/)
    }
  })

  test('a visit from a landing link carries a make_click pixel for its occasion', async () => {
    const { app } = await makeTestApp()
    assert.deepEqual(pixels(await (await app.request('/?occasion=farewell&from=landing')).text()), ['/c/make_click/farewell'])
    assert.deepEqual(pixels(await (await app.request('/?from=landing')).text()), ['/c/make_click'])
  })

  test('a visit from a gift page credit carries a credit_click pixel', async () => {
    const { app } = await makeTestApp()
    assert.deepEqual(pixels(await (await app.request('/?from=credit')).text()), ['/c/credit_click'])
  })

  test('a plain visit, or an unknown ?from=, has no pixel', async () => {
    const { app } = await makeTestApp()
    for (const query of ['', '?from=email', '?occasion=birthday', '?from=toString']) {
      assert.deepEqual(pixels(await (await app.request(`/${query}`)).text()), [], query)
    }
  })

  test('the gift page credit links to the form tagged as a credit click', async () => {
    const { app } = await makeTestApp()
    const { html } = await generatePage(app)
    assert.match(html, /<p class="credit">[^]*?<a href="\/\?from=credit">Make one for someone →<\/a>/)
  })
})

describe('formatFunnel', () => {
  const report = {
    days: 30,
    since: '2026-09-23',
    rows: [
      { occasion: 'birthday', landingViews: 200, makeClicks: 9, pagesMade: 6, pagesPaid: 3, pagesRemoved: 0 },
      { occasion: 'anniversary', landingViews: 0, makeClicks: 0, pagesMade: 0, pagesPaid: 0, pagesRemoved: 0 },
      { occasion: 'farewell', landingViews: 40, makeClicks: 1, pagesMade: 2, pagesPaid: 0, pagesRemoved: 1 },
    ],
    totals: { landingViews: 240, makeClicks: 10, pagesMade: 8, pagesPaid: 3, pagesRemoved: 1 },
    creditClicks: 2,
  }

  test('prints one line per occasion with click and paid rates, and the totals', () => {
    const out = formatFunnel(report)
    assert.match(out, /last 30 days/)
    assert.match(out, /2026-09-23/)
    assert.match(out, /birthday\s+200\s+9\s+4\.5%\s+6\s+3\s+50\.0%\s+0/)
    assert.match(out, /farewell\s+40\s+1\s+2\.5%\s+2\s+0\s+0\.0%\s+1/)
    assert.match(out, /total\s+240\s+10\s+4\.2%\s+8\s+3\s+37\.5%\s+1/)
  })

  test('shows a dash instead of dividing by zero', () => {
    assert.match(formatFunnel(report), /anniversary\s+0\s+0\s+–\s+0\s+0\s+–\s+0/)
  })

  test('reports credit clicks per paid page, and the PRD demand-test targets', () => {
    const out = formatFunnel(report)
    assert.match(out, /credit clicks: 2 \(0\.67 per paid page\)/i)
    assert.match(out, /3%/)
    assert.match(out, /5 paid/)
  })
})
