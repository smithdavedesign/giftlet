// src/payments.js: Stripe signature verification, which events unlock a page, and
// creating a Checkout Session (against a fake fetch; nothing reaches Stripe).
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PRICE,
  APP_TAG,
  checkoutParams,
  paidCheckout,
  paymentLinkFor,
  paymentLinkUrl,
  stripeCheckout,
  verifyStripeEvent,
} from '../src/payments.js'
import { newSlug } from '../src/web.js'
import { OTHER_SECRET, PAYMENT_LINK_ID, SESSION_ID, WEBHOOK_SECRET, checkoutEvent, silentLog, stripeSignature } from './helpers.js'

const SLUG = 'AbCdEfGhIjKlMnOpQrSt_-'
const NOW_MS = 1_760_000_000_000
const NOW_S = NOW_MS / 1000
const FAKE_KEY = ['sk', 'test', 'A1b2C3d4'.repeat(6)].join('_')

describe('verifyStripeEvent', () => {
  const raw = JSON.stringify(checkoutEvent({ slug: SLUG }))
  const verify = (body, header, options = {}) => verifyStripeEvent(body, header, WEBHOOK_SECRET, { now: NOW_MS, ...options })

  test('returns the parsed event for a valid signature over the exact bytes', () => {
    const header = stripeSignature(raw, { timestamp: NOW_S })
    assert.deepEqual(verify(Buffer.from(raw), header), JSON.parse(raw))
    assert.deepEqual(verify(new TextEncoder().encode(raw), header), JSON.parse(raw))
  })

  test('accepts any one valid v1 among several (secret rotation), in any order', () => {
    const good = stripeSignature(raw, { timestamp: NOW_S }).split(',')[1]
    const old = stripeSignature(raw, { timestamp: NOW_S, secret: OTHER_SECRET }).split(',')[1]
    assert.ok(verify(Buffer.from(raw), `t=${NOW_S},${old},${good}`))
    assert.ok(verify(Buffer.from(raw), `t=${NOW_S}, ${good}, ${old}, v0=${'0'.repeat(64)}`))
  })

  test('accepts timestamps up to 300 s either way and rejects beyond', () => {
    for (const offset of [-300, 300]) {
      assert.ok(verify(Buffer.from(raw), stripeSignature(raw, { timestamp: NOW_S + offset })), String(offset))
    }
    for (const offset of [-301, 301]) {
      assert.equal(verify(Buffer.from(raw), stripeSignature(raw, { timestamp: NOW_S + offset })), null, String(offset))
    }
  })

  test('rejects a wrong secret, changed bytes, and missing or malformed headers', () => {
    const header = stripeSignature(raw, { timestamp: NOW_S })
    assert.equal(verify(Buffer.from(raw), stripeSignature(raw, { timestamp: NOW_S, secret: OTHER_SECRET })), null)
    assert.equal(verify(Buffer.from(`${raw} `), header), null)
    assert.equal(verify(Buffer.from(raw.replace('"paid"', '"unpaid"')), header), null)
    for (const bad of [undefined, null, '', 'garbage', `t=${NOW_S}`, header.split(',')[1], `t=abc,${header.split(',')[1]}`]) {
      assert.equal(verify(Buffer.from(raw), bad), null, String(bad))
    }
    // A truncated or over-long v1 must not throw from timingSafeEqual.
    const v1 = header.split('v1=')[1]
    assert.equal(verify(Buffer.from(raw), `t=${NOW_S},v1=${v1.slice(0, 32)}`), null)
    assert.equal(verify(Buffer.from(raw), `t=${NOW_S},v1=${v1}00`), null)
  })

  test('rejects everything when no secret is configured', () => {
    const header = stripeSignature(raw, { timestamp: NOW_S })
    for (const secret of [undefined, null, '']) {
      assert.equal(verifyStripeEvent(Buffer.from(raw), header, secret, { now: NOW_MS }), null)
    }
  })

  test('rejects a validly signed body that is not a JSON object', () => {
    for (const body of ['not json', '"a string"', '42', 'null']) {
      assert.equal(verify(Buffer.from(body), stripeSignature(body, { timestamp: NOW_S })), null, body)
    }
  })

  test('uses the real clock by default', () => {
    const header = stripeSignature(raw)
    assert.ok(verifyStripeEvent(Buffer.from(raw), header, WEBHOOK_SECRET))
  })
})

describe('paidCheckout', () => {
  test('a paid checkout.session.completed for giftlet unlocks that slug', () => {
    assert.deepEqual(paidCheckout(checkoutEvent({ slug: SLUG })), { slug: SLUG, sessionId: SESSION_ID })
  })

  test('async_payment_succeeded unlocks too', () => {
    const event = checkoutEvent({ slug: SLUG, type: 'checkout.session.async_payment_succeeded' })
    assert.deepEqual(paidCheckout(event), { slug: SLUG, sessionId: SESSION_ID })
  })

  test('nothing else unlocks', () => {
    const cases = [
      ['unpaid completion', checkoutEvent({ slug: SLUG, paymentStatus: 'unpaid' })],
      ['no_payment_required', checkoutEvent({ slug: SLUG, paymentStatus: 'no_payment_required' })],
      ['another app', checkoutEvent({ slug: SLUG, app: 'squadwrap' })],
      ['no app tag', checkoutEvent({ slug: SLUG, app: null })],
      ['async failure', checkoutEvent({ slug: SLUG, type: 'checkout.session.async_payment_failed' })],
      ['expired', checkoutEvent({ slug: SLUG, type: 'checkout.session.expired' })],
      ['other event type', checkoutEvent({ slug: SLUG, type: 'charge.succeeded' })],
      ['no slug', checkoutEvent({ slug: undefined })],
      ['numeric slug', checkoutEvent({ slug: 42 })],
      ['not a session', { ...checkoutEvent({ slug: SLUG }), data: { object: { object: 'charge' } } }],
      ['no data', { type: 'checkout.session.completed' }],
      ['null', null],
      ['string', 'checkout.session.completed'],
    ]
    for (const [label, event] of cases) assert.equal(paidCheckout(event), null, label)
  })

  test('a missing session id still unlocks, with a null id', () => {
    const event = checkoutEvent({ slug: SLUG })
    delete event.data.object.id
    assert.deepEqual(paidCheckout(event), { slug: SLUG, sessionId: null })
  })

  test('a paid session from the Stripe Payment Link unlocks without the app tag when it took at least $9', () => {
    for (const amountTotal of [900, 1900]) {
      const event = checkoutEvent({ slug: SLUG, app: null, paymentLink: PAYMENT_LINK_ID, amountTotal })
      assert.deepEqual(paidCheckout(event), { slug: SLUG, sessionId: SESSION_ID }, String(amountTotal))
    }
    // Tagged on the link (metadata is copied to its sessions): the tag alone is enough.
    const tagged = checkoutEvent({ slug: SLUG, paymentLink: PAYMENT_LINK_ID, amountTotal: 0 })
    assert.deepEqual(paidCheckout(tagged), { slug: SLUG, sessionId: SESSION_ID })
  })

  test("an untagged payment-link session that took less than the price, another currency, or isn't paid never unlocks", () => {
    const link = { slug: SLUG, app: null, paymentLink: PAYMENT_LINK_ID }
    const cases = [
      ['$5 (another product’s cheaper link)', checkoutEvent({ ...link, amountTotal: 500 })],
      ['$8.99', checkoutEvent({ ...link, amountTotal: 899 })],
      ['900 in euros', checkoutEvent({ ...link, currency: 'eur' })],
      ['amount as a string', checkoutEvent({ ...link, amountTotal: '900' })],
      ['no amount', checkoutEvent({ ...link, amountTotal: null })],
      ['unpaid', checkoutEvent({ ...link, paymentStatus: 'unpaid' })],
      ['not from a payment link either', checkoutEvent({ slug: SLUG, app: null })],
      ['payment_link not a string', checkoutEvent({ ...link, paymentLink: { id: PAYMENT_LINK_ID } })],
    ]
    for (const [label, event] of cases) assert.equal(paidCheckout(event), null, label)
  })
})

describe('the payment link (STRIPE_PAYMENT_LINK)', () => {
  test('paymentLinkUrl accepts https URLs only', () => {
    assert.equal(paymentLinkUrl('https://buy.stripe.com/test_00g5kk'), 'https://buy.stripe.com/test_00g5kk')
    assert.equal(paymentLinkUrl('  https://pay.giftlet.example/b/abc  '), 'https://pay.giftlet.example/b/abc')
    for (const bad of [undefined, null, '', '   ', 42, 'http://buy.stripe.com/x', 'javascript:alert(1)', 'buy.stripe.com/x', 'not a url', 'https://someone@buy.stripe.com/x']) {
      assert.equal(paymentLinkUrl(bad), null, String(bad))
    }
  })

  test('paymentLinkFor adds the page as client_reference_id and keeps any other query', () => {
    assert.equal(paymentLinkFor('https://buy.stripe.com/test_00g5kk', SLUG), `https://buy.stripe.com/test_00g5kk?client_reference_id=${SLUG}`)
    const url = new URL(paymentLinkFor('https://buy.stripe.com/x?prefilled_promo_code=HELLO&client_reference_id=old', SLUG))
    assert.equal(url.searchParams.get('prefilled_promo_code'), 'HELLO')
    assert.deepEqual(url.searchParams.getAll('client_reference_id'), [SLUG])
  })

  test('every slug giftlet makes is a valid client_reference_id (letters, digits, - and _, at most 200)', () => {
    for (let i = 0; i < 200; i++) assert.match(newSlug(), /^[A-Za-z0-9_-]{1,200}$/)
  })
})

describe('checkoutParams', () => {
  test('one $9 line item, tagged with the app and slug, returning to the page', () => {
    const params = checkoutParams({ slug: SLUG, origin: 'https://giftlet.example' })
    assert.equal(params.get('mode'), 'payment')
    assert.equal(params.get('line_items[0][quantity]'), '1')
    assert.equal(params.get('line_items[0][price_data][currency]'), 'usd')
    assert.equal(params.get('line_items[0][price_data][unit_amount]'), '900')
    assert.match(params.get('line_items[0][price_data][product_data][name]'), /giftlet/i)
    assert.equal(params.get('client_reference_id'), SLUG)
    assert.equal(params.get(`metadata[app]`), APP_TAG)
    assert.equal(params.get('success_url'), `https://giftlet.example/p/${SLUG}?checkout=success`)
    assert.equal(params.get('cancel_url'), `https://giftlet.example/p/${SLUG}`)
  })

  test('PRICE is $9 in cents, and its label matches', () => {
    assert.deepEqual(PRICE, { cents: 900, currency: 'usd', label: '$9' })
  })

  test('sends nothing about the recipient to Stripe', () => {
    const params = checkoutParams({ slug: SLUG, origin: 'https://giftlet.example' })
    assert.deepEqual(
      [...params.keys()].sort(),
      [
        'cancel_url',
        'client_reference_id',
        'line_items[0][price_data][currency]',
        'line_items[0][price_data][product_data][name]',
        'line_items[0][price_data][unit_amount]',
        'line_items[0][quantity]',
        'metadata[app]',
        'mode',
        'success_url',
      ],
    )
  })
})

describe('stripeCheckout', () => {
  const stripeAnswer = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const GOOD = { id: SESSION_ID, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${SESSION_ID}` }

  test('without a secret key, payments are off (null)', () => {
    assert.equal(stripeCheckout({ secretKey: undefined }), null)
    assert.equal(stripeCheckout({ secretKey: '' }), null)
  })

  test('creates a Checkout Session with the key only in the Authorization header', async () => {
    const calls = []
    const create = stripeCheckout({
      secretKey: FAKE_KEY,
      fetch: async (url, init) => {
        calls.push({ url, init })
        return stripeAnswer(GOOD)
      },
    })
    const session = await create({ slug: SLUG, origin: 'https://giftlet.example' })
    assert.deepEqual(session, { id: SESSION_ID, url: GOOD.url })
    assert.equal(calls.length, 1)
    const [{ url, init }] = calls
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.authorization, `Bearer ${FAKE_KEY}`)
    assert.equal(init.headers['content-type'], 'application/x-www-form-urlencoded')
    assert.ok(init.signal instanceof AbortSignal)
    assert.equal(init.body, checkoutParams({ slug: SLUG, origin: 'https://giftlet.example' }).toString())
    assert.ok(!url.includes(FAKE_KEY) && !init.body.includes(FAKE_KEY))
  })

  const failures = [
    ['an HTTP error (bad key)', async () => stripeAnswer({ error: { message: 'Invalid API Key provided' } }, 401), /HTTP 401/],
    ['a network error', async () => Promise.reject(new TypeError('fetch failed')), /TypeError/],
    ['a body that is not JSON', async () => new Response('<html>', { status: 200 }), /SyntaxError/],
    ['no URL in the session', async () => stripeAnswer({ id: SESSION_ID }), /checkout URL/],
    ['a URL that is not Stripe Checkout', async () => stripeAnswer({ ...GOOD, url: 'https://evil.example/pay' }), /checkout URL/],
    ['a plain-http Stripe URL', async () => stripeAnswer({ ...GOOD, url: 'http://checkout.stripe.com/c/pay/x' }), /checkout URL/],
    ['a lookalike host', async () => stripeAnswer({ ...GOOD, url: 'https://checkout.stripe.com.evil.example/x' }), /checkout URL/],
  ]
  for (const [label, fetch, message] of failures) {
    test(`throws on ${label}, without the key in the message`, async () => {
      const create = stripeCheckout({ secretKey: FAKE_KEY, fetch, log: silentLog })
      await assert.rejects(create({ slug: SLUG, origin: 'https://giftlet.example' }), (err) => {
        assert.match(err.message, message)
        assert.ok(!err.message.includes(FAKE_KEY))
        assert.ok(!err.message.includes(SLUG))
        return true
      })
    })
  }

  test('gives up after the timeout', async () => {
    const create = stripeCheckout({
      secretKey: FAKE_KEY,
      timeoutMs: 30,
      // A request that never answers; the timer stands in for the open socket.
      fetch: (url, init) =>
        new Promise((resolve, reject) => {
          const socket = setTimeout(() => {}, 10_000)
          init.signal.addEventListener('abort', () => {
            clearTimeout(socket)
            reject(init.signal.reason)
          })
        }),
    })
    const started = Date.now()
    await assert.rejects(create({ slug: SLUG, origin: 'https://giftlet.example' }), /TimeoutError/)
    assert.ok(Date.now() - started < 2000)
  })
})
