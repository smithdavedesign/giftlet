// M1 exit criteria from ROADMAP.md, one describe block per criterion.
import { describe, test, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  MB,
  MEMORIES,
  PHOTOS,
  jpegOfSize,
  makeTestApp,
  postGift,
  generatePage,
  statItems,
} from './helpers.js'

describe('EC1: POST /generate (name, "birthday", 4 memories, 3 photos) returns a random slug and a page with the name and all 3 photos', () => {
  let ctx
  before(async () => {
    ctx = await makeTestApp()
  })

  test('responds 201 with a slug of at least 12 URL-safe random characters', async () => {
    const res = await postGift(ctx.app, { name: 'Maya', occasion: 'birthday', memories: MEMORIES, photos: PHOTOS })
    assert.equal(res.status, 201)
    const body = await res.json()
    assert.match(body.slug, /^[A-Za-z0-9_-]{12,}$/)
    assert.equal(body.url, `/p/${body.slug}`)
    assert.equal(body.takedownUrl, `/p/${body.slug}/takedown`)
  })

  test('the page HTML contains the recipient name and all 3 photos, and each photo serves the uploaded bytes', async () => {
    const { slug, page, html } = await generatePage(ctx.app, { name: 'Maya' })
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-type'), /^text\/html/)
    assert.ok(html.includes('Maya'), 'page shows the recipient name')

    const imgSrcs = [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(imgSrcs, [1, 2, 3].map((n) => `/p/${slug}/photo/${n}`))

    for (const [i, photo] of PHOTOS.entries()) {
      const res = await ctx.app.request(imgSrcs[i])
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-type'), photo.type)
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), photo.bytes)
    }
  })

  test('slugs are random: two pages from the same answers get different slugs', async () => {
    const a = await (await postGift(ctx.app)).json()
    const b = await (await postGift(ctx.app)).json()
    assert.notEqual(a.slug, b.slug)
  })
})

describe('EC2: the generated page has 3 or more fake statistics, each labeled as a joke', () => {
  function assertJokeStats(html) {
    const items = statItems(html)
    assert.ok(items.length >= 3, `expected ≥3 stats, got ${items.length}`)
    for (const item of items) {
      assert.match(item, /<span class="joke-tag">Joke stat<\/span>/, `stat not labeled as a joke: ${item}`)
    }
    assert.match(html, /made-up statistics/i)
  }

  test('with template copy (no model configured)', async () => {
    const { app } = await makeTestApp()
    const { html } = await generatePage(app)
    assertJokeStats(html)
  })

  test('with model copy that returned only 2 stats, the page still shows ≥3, all labeled', async () => {
    const writeCopy = async () => ({
      headline: 'Maya, the legend',
      intro: 'A short tribute.',
      sections: [{ title: 'Tacos', body: 'Arizona, enough said.' }],
      stats: [
        { value: '4,812', label: 'terrible puns forgiven' },
        { value: '3', label: 'karaoke encores demanded' },
      ],
      signoff: 'Love, me',
    })
    const { app } = await makeTestApp({ writeCopy })
    const { html } = await generatePage(app)
    assertJokeStats(html)
    assert.ok(html.includes('terrible puns forgiven'), 'model stats are used')
  })
})

describe('EC3: memory text containing <script> is escaped in the rendered HTML', () => {
  test('a <script> tag in a memory renders as text, and the gift page contains no <script at all', async () => {
    const { app } = await makeTestApp()
    const memories = [...MEMORIES]
    memories[1] = 'We laughed so hard <script>alert("gotcha")</script> at the wedding.'
    const { html } = await generatePage(app, { memories })
    assert.ok(!html.includes('<script>alert'), 'raw script tag must not appear')
    assert.ok(html.includes('&lt;script&gt;alert(&quot;gotcha&quot;)&lt;/script&gt;'), 'script text is shown escaped')
    assert.doesNotMatch(html, /<script/i)
  })

  test('HTML in the recipient name is escaped everywhere it appears', async () => {
    const { app } = await makeTestApp()
    const { html } = await generatePage(app, { name: 'Ana <img src=x onerror=alert(1)>' })
    assert.ok(!html.includes('<img src=x'), 'raw tag must not appear')
    assert.ok(html.includes('Ana &lt;img src=x onerror=alert(1)&gt;'))
  })

  test('HTML returned by the model is escaped too', async () => {
    const writeCopy = async () => ({
      headline: '<b>Hi</b><script>steal()</script>',
      intro: '<a href="javascript:alert(1)">click</a>',
      sections: [{ title: '<i>x</i>', body: '<iframe src="//evil.example"></iframe>' }],
      stats: [
        { value: '<b>1</b>', label: '<script>a()</script>' },
        { value: '2', label: 'fine' },
        { value: '3', label: 'also fine' },
      ],
      signoff: '"><svg onload=alert(1)>',
    })
    const { app } = await makeTestApp({ writeCopy })
    const { html } = await generatePage(app)
    assert.doesNotMatch(html, /<script|<iframe|<svg|<a href="javascript|<b>|<i>/i)
    assert.ok(html.includes('&lt;b&gt;Hi&lt;/b&gt;'))
  })
})

describe('EC4: an upload over 5 MB or a non-image file is rejected with a 4xx', () => {
  test('a photo over 5 MB is rejected with 413', async () => {
    const { app } = await makeTestApp()
    const photos = [PHOTOS[0], { bytes: jpegOfSize(5 * MB + 1), name: 'huge.jpg', type: 'image/jpeg' }, PHOTOS[2]]
    const res = await postGift(app, { photos })
    assert.equal(res.status, 413)
    const body = await res.json()
    assert.equal(body.field, 'photo')
    assert.match(body.error, /5 MB/)
  })

  test('a photo of exactly 5 MB is accepted (the cap is inclusive)', async () => {
    const { app } = await makeTestApp()
    const photos = [PHOTOS[0], { bytes: jpegOfSize(5 * MB), name: 'big.jpg', type: 'image/jpeg' }, PHOTOS[2]]
    const res = await postGift(app, { photos })
    assert.equal(res.status, 201)
  })

  test('a non-image file is rejected with 415, even when it claims to be a PNG', async () => {
    const { app } = await makeTestApp()
    const photos = [PHOTOS[0], PHOTOS[1], { bytes: Buffer.from('just some notes'), name: 'notes.png', type: 'image/png' }]
    const res = await postGift(app, { photos })
    assert.equal(res.status, 415)
    assert.equal((await res.json()).field, 'photo')
  })

  test('an SVG (which can carry script) is rejected with 415', async () => {
    const { app } = await makeTestApp()
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const photos = [PHOTOS[0], PHOTOS[1], { bytes: svg, name: 'x.svg', type: 'image/svg+xml' }]
    const res = await postGift(app, { photos })
    assert.equal(res.status, 415)
  })

  test('a rejected upload stores nothing', async () => {
    const { app, db, store } = await makeTestApp()
    await store.ensureSchema()
    await postGift(app, { photos: [PHOTOS[0], PHOTOS[1], { bytes: Buffer.from('nope'), name: 'a.png' }] })
    await postGift(app, { photos: [PHOTOS[0], PHOTOS[1], { bytes: jpegOfSize(5 * MB + 1), name: 'b.jpg' }] })
    const pages = await db.query('SELECT count(*)::int AS n FROM pages')
    const photos = await db.query('SELECT count(*)::int AS n FROM photos')
    assert.equal(pages.rows[0].n, 0)
    assert.equal(photos.rows[0].n, 0)
  })
})

describe('EC5: GET /p/<slug> serves noindex with the takedown link, and returns 404 after takedown', () => {
  test('the page is noindex (header and meta) and links to its takedown page', async () => {
    const { app } = await makeTestApp()
    const { slug, page, html } = await generatePage(app)
    assert.match(page.headers.get('x-robots-tag'), /noindex/)
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/)
    assert.ok(html.includes(`href="/p/${slug}/takedown"`), 'takedown link present')
    assert.match(page.headers.get('cache-control'), /no-store/)
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer')
  })

  test('following the takedown link only asks for confirmation; it does not delete', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    const confirm = await app.request(`/p/${slug}/takedown`)
    assert.equal(confirm.status, 200)
    assert.match(confirm.headers.get('x-robots-tag'), /noindex/)
    const html = await confirm.text()
    assert.match(html, new RegExp(`<form method="post" action="/p/${slug}/takedown">`))
    assert.equal((await app.request(`/p/${slug}`)).status, 200, 'page still up after GET')
  })

  test('after POST takedown, the page and its photos return 404', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    const removed = await app.request(`/p/${slug}/takedown`, { method: 'POST' })
    assert.equal(removed.status, 200)
    assert.match(await removed.text(), /removed/i)

    const page = await app.request(`/p/${slug}`)
    assert.equal(page.status, 404)
    assert.match(page.headers.get('x-robots-tag'), /noindex/)
    for (const n of [1, 2, 3]) {
      assert.equal((await app.request(`/p/${slug}/photo/${n}`)).status, 404)
    }
    assert.equal((await app.request(`/p/${slug}/takedown`)).status, 404)
  })

  test('a second takedown returns 404, and unknown or malformed slugs return 404', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    for (const bad of ['0', '4', 'abc', '1.0']) {
      assert.equal((await app.request(`/p/${slug}/photo/${bad}`)).status, 404, `photo/${bad} on a live page`)
    }
    assert.equal((await app.request(`/p/${slug}/takedown`, { method: 'POST' })).status, 200)
    assert.equal((await app.request(`/p/${slug}/takedown`, { method: 'POST' })).status, 404)
    assert.equal((await app.request('/p/AAAAAAAAAAAAAAAAAAAAAA')).status, 404)
    assert.equal((await app.request('/p/AAAAAAAAAAAAAAAAAAAAAA/takedown', { method: 'POST' })).status, 404)
    assert.equal((await app.request('/p/short')).status, 404)
    assert.equal((await app.request('/p/has.dots.in.it.here')).status, 404)
  })
})
