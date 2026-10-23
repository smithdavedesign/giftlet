// The production entry (src/index.js) as Vercel loads it, with no infrastructure configured.
import { describe, test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BROWSER_UA, SESSION_ID, giftForm } from './helpers.js'

describe('production entry without DATABASE_URL', () => {
  let app
  before(async () => {
    // Make sure this test never reaches a real database or model, whatever the shell has set.
    delete process.env.DATABASE_URL
    delete process.env.GOOGLE_API_KEY
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_WEBHOOK_SECRET
    delete process.env.STRIPE_PAYMENT_LINK
    delete process.env.SITE_URL
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    delete process.env.VERCEL_ENV
    app = (await import('../src/index.js')).default
  })

  test('the Stripe webhook refuses events (503) instead of unlocking anything', async () => {
    const res = await app.request('/stripe/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=00' } })
    assert.equal(res.status, 503)
  })

  test('default-exports a Hono app that serves the form', async () => {
    assert.equal(typeof app.fetch, 'function')
    const res = await app.request('/')
    assert.equal(res.status, 200)
  })

  test('POST /generate answers 503 with a JSON error instead of crashing', async () => {
    const res = await app.request('/generate', { method: 'POST', body: giftForm() })
    assert.equal(res.status, 503)
    assert.match((await res.json()).error, /not connected/i)
  })

  test('page routes answer 503 too', async () => {
    const res = await app.request('/p/AAAAAAAAAAAAAAAAAAAAAA')
    assert.equal(res.status, 503)
    assert.equal((await app.request('/p/AAAAAAAAAAAAAAAAAAAAAA/print')).status, 503)
  })

  test('the occasion landing pages and the counting pixel still work (they never need the database)', async () => {
    for (const path of ['/birthday', '/anniversary', '/retirement']) {
      assert.equal((await app.request(path)).status, 200, path)
    }
    const pixel = await app.request('/c/landing_view/birthday', { headers: { 'user-agent': BROWSER_UA } })
    assert.equal(pixel.status, 200)
    assert.equal(pixel.headers.get('content-type'), 'image/gif')
  })

  test('the go-live pages and files work without the database, and no beacon runs outside production', async () => {
    for (const path of ['/privacy', '/terms', '/robots.txt', '/sitemap.xml', '/og.png', '/beacon.js']) {
      assert.equal((await app.request(path)).status, 200, path)
    }
    assert.doesNotMatch(await (await app.request('/privacy')).text(), /beacon\.js/)
    assert.equal((await app.request(`/paid?session_id=${SESSION_ID}`)).status, 503)
  })
})
