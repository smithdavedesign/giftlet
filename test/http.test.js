// End-to-end over a real socket: the same app served by Node's HTTP server, driven
// with fetch, the way a browser (and Vercel's Node runtime) would hit it.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { serve } from '@hono/node-server'
import {
  BROWSER_UA,
  PHOTOS,
  checkoutEvent,
  giftForm,
  hasWatermark,
  keepsakeHref,
  makeTestApp,
  pdfPageObjects,
  pdfText,
  statItems,
  stripeSignature,
  tinyJpeg,
} from './helpers.js'

describe('over HTTP', () => {
  let server
  let base
  before(async () => {
    const { app } = await makeTestApp()
    await new Promise((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        base = `http://127.0.0.1:${info.port}`
        resolve()
      })
    })
  })
  after(() => new Promise((resolve) => server.close(resolve)))

  test('make a page, view it and its photos, then take it down', async () => {
    const form = await fetch(`${base}/`)
    assert.equal(form.status, 200)

    const created = await fetch(`${base}/generate`, { method: 'POST', body: giftForm({ name: 'Sam' }) })
    assert.equal(created.status, 201)
    const { slug, url, takedownUrl } = await created.json()
    assert.match(slug, /^[A-Za-z0-9_-]{22}$/)

    const page = await fetch(`${base}${url}`)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('x-robots-tag'), /noindex/)
    const html = await page.text()
    assert.ok(html.includes('Sam'))
    assert.ok(statItems(html).length >= 3)

    const photo = await fetch(`${base}${url}/photo/1`)
    assert.equal(photo.status, 200)
    assert.equal(photo.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), PHOTOS[0].bytes)

    // What a browser sends when the confirm form is submitted.
    const removed = await fetch(`${base}${takedownUrl}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    })
    assert.equal(removed.status, 200)
    assert.equal((await fetch(`${base}${url}`)).status, 404)
    assert.equal((await fetch(`${base}${url}/photo/1`)).status, 404)
  })

  test('a Stripe-signed webhook over the wire unlocks the page (raw bytes, as Stripe sends them)', async () => {
    const created = await fetch(`${base}/generate`, { method: 'POST', body: giftForm({ name: 'Sam', theme: 'postcard' }) })
    const { slug, url } = await created.json()
    const before = await (await fetch(`${base}${url}`)).text()
    assert.ok(hasWatermark(before))
    assert.match(before, /<body class="theme-postcard">/)

    // Stripe pretty-prints its payloads; the signature covers those exact bytes.
    const raw = JSON.stringify(checkoutEvent({ slug }), null, 2)
    const hook = await fetch(`${base}/stripe/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', 'stripe-signature': stripeSignature(raw) },
      body: raw,
    })
    assert.equal(hook.status, 200)
    const after = await (await fetch(`${base}${url}`)).text()
    assert.ok(!hasWatermark(after))
    assert.ok(after.includes(keepsakeHref(slug)))
  })

  test('landing page → form → page → 402 keepsake → pay → PDF keepsake, the way a buyer goes', async () => {
    const headers = { 'user-agent': BROWSER_UA }
    const landing = await fetch(`${base}/retirement`, { headers })
    assert.equal(landing.status, 200)
    const landingHtml = await landing.text()
    const href = landingHtml.match(/<a class="cta" href="([^"]+)"/)[1].replaceAll('&amp;', '&')
    const [pixel] = [...landingHtml.matchAll(/<img class="px" src="([^"]+)"/g)].map((m) => m[1])
    assert.equal((await fetch(`${base}${pixel}`, { headers })).status, 200)

    const form = await (await fetch(`${base}${href}`, { headers })).text()
    assert.match(form, /<option value="farewell" selected>/)

    const created = await fetch(`${base}/generate`, {
      method: 'POST',
      body: giftForm({ name: 'Pat', occasion: 'farewell', relationship: 'coworker', tone: 'heartfelt', photos: [{ bytes: tinyJpeg(), name: 'a.jpg' }, ...PHOTOS.slice(1)] }),
    })
    const { slug, url } = await created.json()
    assert.equal((await fetch(`${base}${url}/print`)).status, 402)

    const raw = JSON.stringify(checkoutEvent({ slug }))
    await fetch(`${base}/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': stripeSignature(raw) }, body: raw })

    const print = await fetch(`${base}${url}/print`)
    assert.equal(print.status, 200)
    assert.equal(print.headers.get('content-type'), 'application/pdf')
    const pdf = new Uint8Array(await print.arrayBuffer())
    const pages = pdfPageObjects(pdf)
    assert.ok(pages >= 1 && pages <= 2)
    assert.ok(pdfText(pdf).some((s) => s.includes('Pat')))
  })
})
