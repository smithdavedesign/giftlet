// Go-live: search and sharing tags on every public page, robots.txt and the sitemap, the
// drawn share image, the privacy and terms pages, and the Buy button (STRIPE_PAYMENT_LINK).
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { createApp, siteOrigin } from '../src/web.js'
import { PRICE } from '../src/payments.js'
import { ISSUES_URL, LANDING_PAGES, PUBLIC_PATHS } from '../src/pages.js'
import { SHARE_IMAGE, crc32 } from '../src/share-image.js'
import {
  PAYMENT_LINK_ID,
  SESSION_ID,
  checkoutEvent,
  generatePage,
  hasWatermark,
  keepsakeHref,
  makeTestApp,
  postWebhook,
  silentLog,
} from './helpers.js'

const SITE = 'https://giftlet.example'
// A placeholder, like the screenshot run's: the real link only ever comes from the env.
const PAY = 'https://example.com/pay'

const meta = (html, attr, key) =>
  html.match(new RegExp(`<meta ${attr}="${key.replace(/[.:]/g, '\\$&')}" content="([^"]*)">`))?.[1] ?? null
const titleOf = (html) => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? null
const canonicalOf = (html) => html.match(/<link rel="canonical" href="([^"]+)">/)?.[1] ?? null
const jsonLdOf = (html) => {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  return blocks.map((m) => JSON.parse(m[1]))
}
const decode = (value) => value.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')

function warningsLog() {
  const warnings = []
  return { warnings, log: { ...silentLog, warn: (line) => warnings.push(line) } }
}

describe('search and sharing: every public page', () => {
  test('the public pages are the form, each occasion landing page, privacy and terms', () => {
    const landings = Object.values(LANDING_PAGES).map((p) => p.path)
    assert.deepEqual(PUBLIC_PATHS, ['/', ...landings, '/privacy', '/terms'])
    assert.equal(new Set(PUBLIC_PATHS).size, PUBLIC_PATHS.length)
  })

  test('each has a unique title and meta description (50–160 characters) and is indexable', async () => {
    const app = createApp({ store: null, siteUrl: SITE, log: silentLog })
    const titles = new Set()
    const descriptions = new Set()
    for (const path of PUBLIC_PATHS) {
      const res = await app.request(path)
      assert.equal(res.status, 200, path)
      assert.match(res.headers.get('content-type'), /^text\/html/, path)
      assert.equal(res.headers.get('x-robots-tag'), null, path)
      const html = await res.text()
      assert.doesNotMatch(html, /noindex/, path)
      const title = titleOf(html)
      const description = meta(html, 'name', 'description')
      assert.ok(title, `${path} has a title`)
      assert.ok(description && description.length >= 50 && description.length <= 160, `${path} description: ${description}`)
      titles.add(title)
      descriptions.add(description)
    }
    assert.equal(titles.size, PUBLIC_PATHS.length, 'titles are unique')
    assert.equal(descriptions.size, PUBLIC_PATHS.length, 'descriptions are unique')
  })

  test('each has a canonical URL, Open Graph and Twitter card tags with the 1200×630 image', async () => {
    const app = createApp({ store: null, siteUrl: SITE, log: silentLog })
    for (const path of PUBLIC_PATHS) {
      const html = await (await app.request(path)).text()
      const url = `${SITE}${path}`
      assert.equal(canonicalOf(html), url, path)
      assert.equal(meta(html, 'property', 'og:url'), url, path)
      assert.equal(meta(html, 'property', 'og:type'), 'website')
      assert.equal(meta(html, 'property', 'og:site_name'), 'giftlet')
      assert.equal(meta(html, 'property', 'og:title'), titleOf(html), path)
      assert.equal(meta(html, 'property', 'og:description'), meta(html, 'name', 'description'), path)
      assert.equal(meta(html, 'property', 'og:image'), `${SITE}/og.png`, path)
      assert.equal(meta(html, 'property', 'og:image:width'), '1200')
      assert.equal(meta(html, 'property', 'og:image:height'), '630')
      assert.ok(meta(html, 'property', 'og:image:alt'))
      assert.equal(meta(html, 'name', 'twitter:card'), 'summary_large_image', path)
      assert.equal(meta(html, 'name', 'twitter:title'), titleOf(html), path)
      assert.equal(meta(html, 'name', 'twitter:description'), meta(html, 'name', 'description'), path)
      assert.equal(meta(html, 'name', 'twitter:image'), `${SITE}/og.png`, path)
    }
  })

  test('each carries JSON-LD: a SoftwareApplication with an Offer of $9 (USD), once', async () => {
    const app = createApp({ store: null, siteUrl: SITE, log: silentLog })
    for (const path of PUBLIC_PATHS) {
      const blocks = jsonLdOf(await (await app.request(path)).text())
      assert.equal(blocks.length, 1, path)
      const [data] = blocks
      assert.equal(data['@context'], 'https://schema.org')
      assert.equal(data['@type'], 'SoftwareApplication')
      assert.equal(data.name, 'giftlet')
      assert.equal(data.url, `${SITE}/`)
      assert.ok(data.applicationCategory && data.operatingSystem && data.description)
      assert.equal(data.offers['@type'], 'Offer')
      assert.equal(data.offers.price, '9.00')
      assert.equal(Number(data.offers.price) * 100, PRICE.cents)
      assert.equal(data.offers.priceCurrency, 'USD')
      assert.match(data.offers.description, /once/)
      assert.match(data.offers.description, /no subscription/i)
    }
  })

  test("without SITE_URL the absolute URLs use the request's own origin", async () => {
    const app = createApp({ store: null, log: silentLog })
    const html = await (await app.request('https://preview.giftlet.example/terms')).text()
    assert.equal(canonicalOf(html), 'https://preview.giftlet.example/terms')
    assert.equal(meta(html, 'property', 'og:image'), 'https://preview.giftlet.example/og.png')
  })

  test('siteOrigin takes SITE_URL or a bare Vercel host and keeps only the origin', () => {
    assert.equal(siteOrigin('giftlet.vercel.app'), 'https://giftlet.vercel.app')
    assert.equal(siteOrigin('https://giftlet.example/'), 'https://giftlet.example')
    assert.equal(siteOrigin(' https://giftlet.example/some/path?q=1 '), 'https://giftlet.example')
    assert.equal(siteOrigin('http://localhost:3000'), 'http://localhost:3000')
    for (const empty of [undefined, null, '', '  ', 'https://']) assert.equal(siteOrigin(empty), null, String(empty))
  })

  test('private and error pages get none of it: no canonical, no og:image, no JSON-LD', async () => {
    const { app } = await makeTestApp({ siteUrl: SITE })
    const { html } = await generatePage(app)
    const notFound = await (await app.request('/nope')).text()
    for (const page of [html, notFound]) {
      assert.equal(canonicalOf(page), null)
      assert.equal(meta(page, 'property', 'og:image'), null)
      assert.equal(jsonLdOf(page).length, 0)
      assert.match(page, /noindex/)
    }
  })

  test('every public page links Privacy, Terms and the contact issues in its footer, with the price line', async () => {
    const app = createApp({ store: null, log: silentLog })
    for (const path of PUBLIC_PATHS) {
      const html = await (await app.request(path)).text()
      const footer = html.slice(html.lastIndexOf('<footer'))
      assert.ok(footer.includes('href="/privacy"'), `${path} links privacy`)
      assert.ok(footer.includes('href="/terms"'), `${path} links terms`)
      assert.ok(footer.includes(`href="${ISSUES_URL}"`), `${path} links the issues`)
      assert.match(footer, /\$9 once per page · refund on request within 7 days/, path)
    }
  })

  test('gift pages link Privacy and Terms in their footer too (paid and unpaid)', async () => {
    const { app } = await makeTestApp()
    const { slug, html } = await generatePage(app)
    await postWebhook(app, checkoutEvent({ slug }))
    const paid = await (await app.request(`/p/${slug}`)).text()
    for (const page of [html, paid]) {
      const footer = page.slice(page.lastIndexOf('<footer'))
      assert.ok(footer.includes('href="/privacy"') && footer.includes('href="/terms"'))
    }
  })
})

describe('robots.txt and sitemap.xml', () => {
  test('robots.txt allows indexing and points at the sitemap', async () => {
    const app = createApp({ store: null, siteUrl: SITE, log: silentLog })
    const res = await app.request('/robots.txt')
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /^text\/plain/)
    const body = await res.text()
    assert.match(body, /^User-agent: \*$/m)
    assert.match(body, /^Allow: \/$/m)
    assert.doesNotMatch(body, /^Disallow: \/\s*$/m, 'nothing blanket-disallowed')
    assert.match(body, new RegExp(`^Sitemap: ${SITE}/sitemap\\.xml$`, 'm'))
  })

  test('sitemap.xml lists exactly the public pages, as absolute URLs that answer 200', async () => {
    const app = createApp({ store: null, siteUrl: SITE, log: silentLog })
    const res = await app.request('/sitemap.xml')
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /^application\/xml/)
    const body = await res.text()
    assert.match(body, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
    assert.match(body, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/)
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    assert.deepEqual(locs, PUBLIC_PATHS.map((path) => `${SITE}${path}`))
    assert.ok(!locs.some((loc) => loc.includes('/p/')), 'no gift pages')
    for (const loc of locs) assert.equal((await app.request(loc.slice(SITE.length))).status, 200, loc)
  })
})

describe('the share image (og:image)', () => {
  // Walks the PNG's chunks, checking each CRC, and returns them.
  function pngChunks(bytes) {
    const buf = Buffer.from(bytes)
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature')
    const chunks = []
    for (let at = 8; at < buf.length; ) {
      const length = buf.readUInt32BE(at)
      const type = buf.subarray(at + 4, at + 8).toString('latin1')
      const data = buf.subarray(at + 8, at + 8 + length)
      assert.equal(buf.readUInt32BE(at + 8 + length), crc32(buf.subarray(at + 4, at + 8 + length)), `${type} CRC`)
      chunks.push({ type, data })
      at += 12 + length
    }
    return chunks
  }

  test('/og.png is a valid, cacheable 1200×630 PNG with a real picture on it', async () => {
    const app = createApp({ store: null, log: silentLog })
    const res = await app.request('/og.png')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.match(res.headers.get('cache-control'), /public/)
    const chunks = pngChunks(new Uint8Array(await res.arrayBuffer()))
    assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND'])
    const ihdr = chunks[0].data
    assert.equal(ihdr.readUInt32BE(0), SHARE_IMAGE.width)
    assert.equal(ihdr.readUInt32BE(4), SHARE_IMAGE.height)
    assert.deepEqual([SHARE_IMAGE.width, SHARE_IMAGE.height], [1200, 630])
    assert.deepEqual([...ihdr.subarray(8)], [8, 2, 0, 0, 0], '8-bit RGB')

    const raw = inflateSync(chunks[1].data)
    const stride = 1 + 1200 * 3
    assert.equal(raw.length, 630 * stride)
    const colours = new Set()
    for (let y = 0; y < 630; y += 3) {
      for (let x = 0; x < 1200; x += 3) {
        const i = y * stride + 1 + x * 3
        colours.add((raw[i] << 16) | (raw[i + 1] << 8) | raw[i + 2])
      }
    }
    assert.ok(colours.size > 50, `not a blank image (${colours.size} colours)`)
    // The title's accent pink and the tagline's ink are both on it.
    assert.ok(colours.has(0xe8457c), 'accent')
    assert.ok(colours.has(0x2b1d3a), 'ink')
  })

  test('it is drawn once and served the same every time', async () => {
    const app = createApp({ store: null, log: silentLog })
    const a = new Uint8Array(await (await app.request('/og.png')).arrayBuffer())
    const b = new Uint8Array(await (await app.request('/og.png')).arrayBuffer())
    assert.deepEqual(a, b)
  })
})

describe('privacy and terms', () => {
  test('/privacy says what is collected, names the three beacon events, and has no cookies', async () => {
    const app = createApp({ store: null, log: silentLog })
    const html = await (await app.request('/privacy')).text()
    for (const event of ['visit', 'activate', 'checkout']) assert.match(html, new RegExp(`<code>${event}</code>`), event)
    assert.match(html, /idea-factory\.1426davejobs\.workers\.dev/)
    assert.match(html, /<h2>Cookies<\/h2>\s*<p>None\./)
    assert.match(html, /Gemini/)
    assert.match(html, /never the photos/)
    assert.match(html, /Stripe/)
    assert.match(html, /repohq:visit/)
    assert.match(html, /repohq:activate/)
    assert.match(html, /Remove this page/)
    assert.ok(html.includes(`href="${ISSUES_URL}"`), 'contact through the issues')
  })

  test('/terms has the price and refund line from REVENUE.md and no warranty', async () => {
    const app = createApp({ store: null, log: silentLog })
    const html = await (await app.request('/terms')).text()
    assert.match(html, /<strong>\$9, once<\/strong>, per page: no subscription/)
    assert.match(html, /<strong>Refund on request within 7 days<\/strong>/)
    assert.match(html, /<h2>No warranty<\/h2>/)
    assert.match(html, /"as is", without warranty of any kind/)
    assert.match(html, /Celebrations only/)
    assert.ok(html.includes(`href="${ISSUES_URL}"`), 'contact through the issues')
  })

  test('both are cacheable and dated', async () => {
    const app = createApp({ store: null, log: silentLog })
    for (const path of ['/privacy', '/terms']) {
      const res = await app.request(path)
      assert.match(res.headers.get('cache-control'), /public/)
      assert.match(await res.text(), /Last updated \d{1,2} \w+ 20\d\d/)
    }
  })
})

describe('the Buy button ("Unlock for $9")', () => {
  const BUY = /data-signal="checkout"/

  test('is hidden when no payment is configured: no link, no form, and the page says payments are off', async () => {
    const { app } = await makeTestApp({ createCheckout: null })
    const { slug, html } = await generatePage(app)
    assert.doesNotMatch(html, BUY)
    assert.ok(!html.includes(`/p/${slug}/checkout`))
    assert.doesNotMatch(html, /client_reference_id/)
    assert.doesNotMatch(html, />Unlock for \$9</)
    assert.match(html, /Payments aren't switched on yet/)
    assert.ok(hasWatermark(html), 'still a preview')
    const locked = await (await app.request(`/p/${slug}/print`)).text()
    assert.doesNotMatch(locked, BUY)
    assert.match(locked, /Payments aren't switched on yet/)
  })

  test('with STRIPE_PAYMENT_LINK it links to the payment link for this page, and nothing else', async () => {
    const { app } = await makeTestApp({ createCheckout: null, paymentLink: PAY })
    const { slug, html } = await generatePage(app)
    const buy = html.match(/<a class="cta buy" href="([^"]+)" data-signal="checkout">Unlock for \$9<\/a>/)
    assert.ok(buy, 'a Buy link')
    assert.equal(decode(buy[1]), `${PAY}?client_reference_id=${slug}`)
    assert.equal(html.match(/data-signal="checkout"/g).length, 1, 'one Buy button')
    assert.ok(!html.includes(`action="/p/${slug}/checkout"`), 'no Checkout Session form')
    assert.match(html, /refund on request within 7 days/)
    // The 402 keepsake page offers the same link.
    const locked = await (await app.request(`/p/${slug}/print`)).text()
    assert.ok(decode(locked).includes(`href="${PAY}?client_reference_id=${slug}" data-signal="checkout"`))
  })

  test('the payment link wins over a Checkout Session when both are configured', async () => {
    const { app } = await makeTestApp({ paymentLink: PAY })
    const { slug, html } = await generatePage(app)
    assert.ok(decode(html).includes(`href="${PAY}?client_reference_id=${slug}"`))
    assert.ok(!html.includes(`action="/p/${slug}/checkout"`))
  })

  test('the link keeps its own query and is HTML-escaped', async () => {
    const { app } = await makeTestApp({ paymentLink: `${PAY}?prefilled_promo_code=GIFT` })
    const { slug, html } = await generatePage(app)
    assert.ok(html.includes(`href="${PAY}?prefilled_promo_code=GIFT&amp;client_reference_id=${slug}"`))
  })

  test('a paid page has no Buy button', async () => {
    const { app } = await makeTestApp({ paymentLink: PAY })
    const { slug } = await generatePage(app)
    await postWebhook(app, checkoutEvent({ slug }))
    const html = await (await app.request(`/p/${slug}`)).text()
    assert.doesNotMatch(html, BUY)
    assert.doesNotMatch(html, /client_reference_id/)
    assert.ok(html.includes(keepsakeHref(slug)))
  })

  test('stays hidden, with a warning, when STRIPE_WEBHOOK_SECRET is missing (a payment could never unlock the page)', async () => {
    const { warnings, log } = warningsLog()
    const { app } = await makeTestApp({ createCheckout: null, paymentLink: PAY, stripeWebhookSecret: '', log })
    const { html } = await generatePage(app)
    assert.doesNotMatch(html, BUY)
    assert.match(html, /Payments aren't switched on yet/)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /STRIPE_WEBHOOK_SECRET/)
    assert.ok(!warnings[0].includes(PAY), 'the link itself is not logged')
  })

  test('the Checkout Session route refuses to start a payment without the webhook secret', async () => {
    const { app } = await makeTestApp({ stripeWebhookSecret: '' })
    const { slug } = await generatePage(app)
    const res = await app.request(`/p/${slug}/checkout`, { method: 'POST' })
    assert.equal(res.status, 503)
  })

  test('stays hidden, with a warning, when STRIPE_PAYMENT_LINK is not an https URL', async () => {
    for (const bad of ['http://example.com/pay', 'javascript:alert(1)', 'not a url']) {
      const { warnings, log } = warningsLog()
      const { app } = await makeTestApp({ createCheckout: null, paymentLink: bad, log })
      const { html } = await generatePage(app)
      assert.doesNotMatch(html, BUY, bad)
      assert.ok(!html.includes(bad), bad)
      assert.equal(warnings.length, 1, bad)
      assert.match(warnings[0], /STRIPE_PAYMENT_LINK/)
    }
  })

  test('paying through the payment link unlocks the page via the signed webhook (no app tag needed)', async () => {
    const { app } = await makeTestApp({ createCheckout: null, paymentLink: PAY })
    const { slug } = await generatePage(app)
    const res = await postWebhook(app, checkoutEvent({ slug, app: null, paymentLink: PAYMENT_LINK_ID }))
    assert.equal(res.status, 200)
    const html = await (await app.request(`/p/${slug}`)).text()
    assert.ok(!hasWatermark(html))
    assert.ok(html.includes(keepsakeHref(slug)))
  })

  test('a cheaper payment from another product with this page as reference does not unlock it', async () => {
    const { app } = await makeTestApp({ createCheckout: null, paymentLink: PAY })
    const { slug } = await generatePage(app)
    await postWebhook(app, checkoutEvent({ slug, app: null, paymentLink: PAYMENT_LINK_ID, amountTotal: 300 }))
    assert.ok(hasWatermark(await (await app.request(`/p/${slug}`)).text()))
  })
})

describe('GET /paid (the payment link return URL)', () => {
  const refreshOf = (html) => html.match(/<meta http-equiv="refresh" content="([^"]+)">/)?.[1] ?? null

  test('once the webhook has unlocked the page, it sends the buyer back to it with the thank-you note', async () => {
    const { app } = await makeTestApp({ createCheckout: null, paymentLink: PAY })
    const { slug } = await generatePage(app)
    await postWebhook(app, checkoutEvent({ slug, app: null, paymentLink: PAYMENT_LINK_ID }))
    const res = await app.request(`/paid?session_id=${SESSION_ID}`)
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), `/p/${slug}?checkout=success`)
    assert.match(res.headers.get('cache-control'), /no-store/)
    const page = await (await app.request(res.headers.get('location'))).text()
    assert.match(page, /The page is unlocked/)
  })

  test('before the webhook lands it waits, reloading itself, and gives up after about a minute', async () => {
    const { app } = await makeTestApp({ createCheckout: null, paymentLink: PAY })
    await generatePage(app)
    const first = await app.request(`/paid?session_id=${SESSION_ID}`)
    assert.equal(first.status, 200)
    assert.match(first.headers.get('x-robots-tag'), /noindex/)
    assert.match(first.headers.get('cache-control'), /no-store/)
    const html = await first.text()
    assert.equal(decode(refreshOf(html)), `3; url=/paid?session_id=${SESSION_ID}&wait=1`)
    assert.match(html, /waiting for Stripe/)
    assert.equal(decode(refreshOf(await (await app.request(`/paid?session_id=${SESSION_ID}&wait=19`)).text())), `3; url=/paid?session_id=${SESSION_ID}&wait=20`)
    const last = await (await app.request(`/paid?session_id=${SESSION_ID}&wait=20`)).text()
    assert.equal(refreshOf(last), null)
    assert.match(last, /open your gift page&#39;s link again|open your gift page's link again/)
    assert.ok(last.includes(`href="${ISSUES_URL}"`))
  })

  test('a missing or malformed session id gets the plain thank-you page, never a lookup or a reflected value', async () => {
    const lookups = []
    const store = { findPaidSlug: async (id) => (lookups.push(id), null) }
    const app = createApp({ store, log: silentLog })
    for (const query of ['', '?session_id=', '?session_id=%3Cscript%3E', '?session_id=cs_test_short', '?session_id=pi_123456789012', `?session_id=${SESSION_ID}%22`]) {
      const res = await app.request(`/paid${query}`)
      assert.equal(res.status, 200, query)
      const html = await res.text()
      assert.equal(refreshOf(html), null, query)
      assert.doesNotMatch(html, /<script>|cs_test_short/, query)
    }
    assert.deepEqual(lookups, [])
  })

  test('an odd ?wait= counts as the first try', async () => {
    const { app } = await makeTestApp()
    for (const wait of ['-1', 'abc', '1e3', '99999']) {
      const html = await (await app.request(`/paid?session_id=${SESSION_ID}&wait=${wait}`)).text()
      assert.equal(decode(refreshOf(html)), `3; url=/paid?session_id=${SESSION_ID}&wait=1`, wait)
    }
  })

  test('a taken-down page is not redirected to; no database answers 503', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    await postWebhook(app, checkoutEvent({ slug }))
    await app.request(`/p/${slug}/takedown`, { method: 'POST' })
    assert.equal((await app.request(`/paid?session_id=${SESSION_ID}`)).status, 200)
    const noDb = createApp({ store: null, log: silentLog })
    assert.equal((await noDb.request(`/paid?session_id=${SESSION_ID}`)).status, 503)
  })
})
