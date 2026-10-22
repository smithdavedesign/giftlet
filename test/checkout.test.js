// Pay-after-preview routes: POST /p/<slug>/checkout, the Stripe webhook beyond the
// exit criteria, return-from-Stripe notices, and the "make one" credit.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/web.js'
import {
  SESSION_ID,
  WEBHOOK_SECRET,
  checkoutEvent,
  fakeCheckout,
  generatePage,
  hasWatermark,
  keepsakeHref,
  makeTestApp,
  postWebhook,
  silentLog,
} from './helpers.js'

const isLocked = async (app, slug) => hasWatermark(await (await app.request(`/p/${slug}`)).text())

describe('POST /p/<slug>/checkout', () => {
  test('an unpaid page 303s to the Stripe Checkout URL, asking for a session for this slug', async () => {
    const { calls, createCheckout } = fakeCheckout()
    const { app } = await makeTestApp({ createCheckout })
    const { slug } = await generatePage(app)
    const res = await app.request(`/p/${slug}/checkout`, { method: 'POST' })
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), `https://checkout.stripe.com/c/pay/${SESSION_ID}`)
    assert.deepEqual(calls, [{ slug, origin: 'http://localhost' }])
  })

  test('the origin for Stripe’s return URLs comes from the request', async () => {
    const { calls, createCheckout } = fakeCheckout()
    const { app } = await makeTestApp({ createCheckout })
    const { slug } = await generatePage(app)
    await app.request(`https://giftlet.example/p/${slug}/checkout`, { method: 'POST' })
    assert.equal(calls[0].origin, 'https://giftlet.example')
  })

  test('an already-paid page goes back to the page without creating a session', async () => {
    const { calls, createCheckout } = fakeCheckout()
    const { app } = await makeTestApp({ createCheckout })
    const { slug } = await generatePage(app)
    await postWebhook(app, checkoutEvent({ slug }))
    const res = await app.request(`/p/${slug}/checkout`, { method: 'POST' })
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), `/p/${slug}`)
    assert.equal(calls.length, 0)
  })

  test('unknown, malformed and taken-down pages are 404 and never reach Stripe', async () => {
    const { calls, createCheckout } = fakeCheckout()
    const { app } = await makeTestApp({ createCheckout })
    const { slug } = await generatePage(app)
    await app.request(`/p/${slug}/takedown`, { method: 'POST' })
    for (const target of [slug, 'AAAAAAAAAAAAAAAAAAAAAA', 'short']) {
      assert.equal((await app.request(`/p/${target}/checkout`, { method: 'POST' })).status, 404, target)
    }
    assert.equal(calls.length, 0)
  })

  test('GET does not start a checkout (link previewers fetch URLs)', async () => {
    const { calls, createCheckout } = fakeCheckout()
    const { app } = await makeTestApp({ createCheckout })
    const { slug } = await generatePage(app)
    assert.equal((await app.request(`/p/${slug}/checkout`)).status, 404)
    assert.equal(calls.length, 0)
  })

  test('without Stripe configured, the preview still renders and the button answers 503', async () => {
    const { app } = await makeTestApp({ createCheckout: null })
    const { slug, html } = await generatePage(app)
    assert.ok(hasWatermark(html))
    const res = await app.request(`/p/${slug}/checkout`, { method: 'POST' })
    assert.equal(res.status, 503)
    assert.match(res.headers.get('content-type'), /text\/html/)
    assert.match(await res.text(), /payments/i)
  })

  test('a Stripe failure answers 502 with a way back, logs it, and leaves the page locked', async () => {
    const errors = []
    const createCheckout = async () => {
      throw new Error('Stripe checkout failed (HTTP 500)')
    }
    const { app } = await makeTestApp({ createCheckout, log: { warn() {}, error: (line) => errors.push(line) } })
    const { slug } = await generatePage(app)
    const res = await app.request(`/p/${slug}/checkout`, { method: 'POST' })
    assert.equal(res.status, 502)
    assert.ok((await res.text()).includes(`href="/p/${slug}"`), 'links back to the page')
    assert.equal(errors.length, 1)
    assert.match(errors[0], /HTTP 500/)
    assert.ok(!errors[0].includes(slug), 'the slug (the page’s secret) is not logged')
    assert.ok(await isLocked(app, slug))
  })

  test('the CSP lets the unlock form redirect to Stripe Checkout, and nowhere else', async () => {
    const { app } = await makeTestApp()
    const { page } = await generatePage(app)
    const csp = page.headers.get('content-security-policy')
    const formAction = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('form-action'))
    assert.equal(formAction, "form-action 'self' https://checkout.stripe.com")
  })

  test('the unlock form posts to the checkout route and shows the price', async () => {
    const { app } = await makeTestApp()
    const { slug, html } = await generatePage(app)
    assert.match(html, new RegExp(`<form method="post" action="/p/${slug}/checkout">`))
    assert.match(html, /\$9/)
  })
})

describe('POST /stripe/webhook beyond the exit criteria', () => {
  test('a completed session that is not paid yet (delayed method) stays locked until async_payment_succeeded', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    const pending = await postWebhook(app, checkoutEvent({ slug, paymentStatus: 'unpaid' }))
    assert.equal(pending.status, 200)
    assert.ok(await isLocked(app, slug))
    const settled = await postWebhook(app, checkoutEvent({ slug, type: 'checkout.session.async_payment_succeeded' }))
    assert.equal(settled.status, 200)
    assert.ok(!(await isLocked(app, slug)))
  })

  test('a failed or expired session never unlocks', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    for (const type of ['checkout.session.async_payment_failed', 'checkout.session.expired', 'payment_intent.succeeded']) {
      assert.equal((await postWebhook(app, checkoutEvent({ slug, type }))).status, 200, type)
    }
    assert.ok(await isLocked(app, slug))
  })

  test('a paid session from another app on the same Stripe account is ignored', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    assert.equal((await postWebhook(app, checkoutEvent({ slug, app: 'squadwrap' }))).status, 200)
    assert.equal((await postWebhook(app, checkoutEvent({ slug, app: null }))).status, 200)
    assert.ok(await isLocked(app, slug))
  })

  test('a paid event for an unknown or malformed slug is acknowledged and changes nothing', async () => {
    const { app } = await makeTestApp()
    for (const slug of ['AAAAAAAAAAAAAAAAAAAAAA', 'bad slug!', undefined, 42]) {
      assert.equal((await postWebhook(app, checkoutEvent({ slug }))).status, 200, String(slug))
    }
  })

  test('a paid event for a taken-down page does not bring it back', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    await app.request(`/p/${slug}/takedown`, { method: 'POST' })
    assert.equal((await postWebhook(app, checkoutEvent({ slug }))).status, 200)
    assert.equal((await app.request(`/p/${slug}`)).status, 404)
  })

  test('a payment for a page that is gone is logged with its session id so it can be refunded', async () => {
    const warnings = []
    const { app } = await makeTestApp({ log: { warn: (line) => warnings.push(line), error() {} } })
    const { slug } = await generatePage(app)
    await app.request(`/p/${slug}/takedown`, { method: 'POST' })
    await postWebhook(app, checkoutEvent({ slug }))
    assert.equal(warnings.length, 1)
    assert.ok(warnings[0].includes(SESSION_ID))
    assert.match(warnings[0], /refund/i)
    assert.ok(!warnings[0].includes(slug), 'the slug (the page’s secret) is not logged')
  })

  test('a redelivered payment for a paid page is not reported as needing a refund', async () => {
    const warnings = []
    const { app } = await makeTestApp({ log: { warn: (line) => warnings.push(line), error() {} } })
    const { slug } = await generatePage(app)
    await postWebhook(app, checkoutEvent({ slug }))
    await postWebhook(app, checkoutEvent({ slug }))
    assert.deepEqual(warnings, [])
  })

  test('a correctly signed body that is not JSON is rejected with 400', async () => {
    const { app } = await makeTestApp()
    const res = await postWebhook(app, null, { body: 'not json at all' })
    assert.equal(res.status, 400)
  })

  test('an oversized body is rejected with 413', async () => {
    const { app } = await makeTestApp()
    const res = await postWebhook(app, null, { body: `{"pad":"${'x'.repeat(1024 * 1024)}"}` })
    assert.equal(res.status, 413)
  })

  test('a database failure answers 500 so Stripe retries the event', async () => {
    const failingStore = {
      markPaid: async () => {
        throw new Error('connection to server at db.internal failed')
      },
    }
    const app = createApp({ store: failingStore, stripeWebhookSecret: WEBHOOK_SECRET, log: silentLog })
    const res = await postWebhook(app, checkoutEvent({ slug: 'AAAAAAAAAAAAAAAAAAAAAA' }))
    assert.equal(res.status, 500)
    assert.doesNotMatch(await res.text(), /db\.internal/)
  })

  test('the response is JSON and never a redirect (Stripe treats 3xx as failure)', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    const res = await postWebhook(app, checkoutEvent({ slug }))
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /application\/json/)
    assert.deepEqual(await res.json(), { received: true })
  })
})

describe('coming back from Stripe', () => {
  test('?checkout=success before the webhook says the payment is being confirmed', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    const html = await (await app.request(`/p/${slug}?checkout=success`)).text()
    assert.match(html, /confirming your payment/i)
    assert.ok(hasWatermark(html))
  })

  test('?checkout=success after the webhook says the page is unlocked and ready to send', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app, { name: 'Maya' })
    await postWebhook(app, checkoutEvent({ slug }))
    const html = await (await app.request(`/p/${slug}?checkout=success`)).text()
    assert.match(html, /unlocked/i)
    assert.ok(html.includes(keepsakeHref(slug)))
  })

  test('the thank-you note gives the clean link to send, not the ?checkout=success address', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    await postWebhook(app, checkoutEvent({ slug }))
    const html = await (await app.request(`https://giftlet.example/p/${slug}?checkout=success`)).text()
    const notice = html.match(/<p class="notice"[^]*?<\/p>/)[0]
    assert.ok(notice.includes(`<a href="/p/${slug}">https://giftlet.example/p/${slug}</a>`), notice)
    assert.ok(!notice.includes('checkout=success'))
  })

  test('without the query there is no notice, and other values are ignored', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    for (const query of ['', '?checkout=cancel', '?checkout=%3Cscript%3E']) {
      const html = await (await app.request(`/p/${slug}${query}`)).text()
      assert.doesNotMatch(html, /class="notice"/, query)
    }
  })
})

describe('"make one" credit', () => {
  test('every gift page, paid or not, links back to the maker', async () => {
    const { app } = await makeTestApp()
    const { slug, html } = await generatePage(app)
    // M3 tags the link (?from=credit) so recipients opening it can be counted.
    const credit = /<p class="credit">[^]*?<a href="\/\?from=credit">Make one[^<]*<\/a>/
    assert.match(html, credit)
    await postWebhook(app, checkoutEvent({ slug }))
    assert.match(await (await app.request(`/p/${slug}`)).text(), credit)
  })
})
