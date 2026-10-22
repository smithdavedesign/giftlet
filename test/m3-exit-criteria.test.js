// M3 exit criteria from ROADMAP.md, one describe block per criterion.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import { OCCASIONS } from '../src/answers.js'
import { LANDING_PAGES } from '../src/pages.js'
import {
  BROWSER_UA,
  PNG_1PX,
  checkoutEvent,
  generatePage,
  makeTestApp,
  paidPage,
  pdfPageObjects,
  pdfText,
  postWebhook,
  tinyJpeg,
} from './helpers.js'

const PHOTOS = [
  { bytes: tinyJpeg({ width: 800, height: 600 }), name: 'cake.jpg', type: 'image/jpeg' },
  { bytes: tinyJpeg({ width: 600, height: 800 }), name: 'beach.jpg', type: 'image/jpeg' },
  { bytes: PNG_1PX, name: 'karaoke.png', type: 'image/png' },
]

async function assertKeepsakePdf(res, { name, headline }) {
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /^application\/pdf/)
  const bytes = new Uint8Array(await res.arrayBuffer())
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString('latin1'), '%PDF-')

  // Two independent page counts: the raw page objects, and a full parse.
  const objects = pdfPageObjects(bytes)
  assert.ok(objects >= 1 && objects <= 2, `page objects: ${objects}`)
  const parsed = (await PDFDocument.load(bytes)).getPageCount()
  assert.equal(parsed, objects)

  const text = pdfText(bytes).join(' ') // lines joined, so wrapped text still matches
  assert.ok(text.includes(name), 'the keepsake names the recipient')
  assert.ok(text.includes(headline), 'the keepsake carries the headline')
  return { bytes, text }
}

describe('M3-EC1: GET /p/<slug>/print returns a PDF of 1–2 pages for a paid page and 402 for an unpaid one', () => {
  test('a paid page gets its keepsake as a 1–2 page PDF', async () => {
    const { app } = await makeTestApp()
    const { slug } = await paidPage(app, { name: 'Maya', photos: PHOTOS })
    const res = await app.request(`/p/${slug}/print`)
    const { text } = await assertKeepsakePdf(res, { name: 'Maya', headline: 'Happy birthday, Maya!' })
    // The keepsake keeps the page's honesty rule: every statistic is marked as a joke.
    assert.ok((text.match(/JOKE STAT/g) ?? []).length >= 3)
  })

  test('an unpaid page answers 402 with the unlock button, and no PDF', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app, { photos: PHOTOS })
    const res = await app.request(`/p/${slug}/print`)
    assert.equal(res.status, 402)
    assert.match(res.headers.get('content-type'), /^text\/html/)
    const html = await res.text()
    assert.ok(!html.startsWith('%PDF'))
    assert.ok(html.includes(`action="/p/${slug}/checkout"`), 'the 402 page offers the unlock button')
  })

  test('the same URL flips from 402 to the PDF when the signed webhook lands', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app, { name: 'Ana', occasion: 'anniversary', photos: PHOTOS })
    assert.equal((await app.request(`/p/${slug}/print`)).status, 402)
    assert.equal((await postWebhook(app, checkoutEvent({ slug }))).status, 200)
    await assertKeepsakePdf(await app.request(`/p/${slug}/print`), { name: 'Ana', headline: 'Happy anniversary, Ana!' })
  })

  test('a 1–2 page PDF for every occasion, tone and theme', async () => {
    const { app } = await makeTestApp()
    const cases = [
      { occasion: 'birthday', tone: 'funny', theme: 'confetti' },
      { occasion: 'anniversary', tone: 'sweet', theme: 'blush' },
      { occasion: 'farewell', tone: 'heartfelt', theme: 'postcard' },
    ]
    for (const options of cases) {
      const { slug } = await paidPage(app, { ...options, name: 'Jo', photos: PHOTOS })
      const res = await app.request(`/p/${slug}/print`)
      assert.equal(res.status, 200, JSON.stringify(options))
      const pages = pdfPageObjects(new Uint8Array(await res.arrayBuffer()))
      assert.ok(pages >= 1 && pages <= 2, `${JSON.stringify(options)}: ${pages} pages`)
    }
  })
})

describe('M3-EC2: each occasion landing page has a title, description and a link into the form with the occasion preselected', () => {
  const formLinks = (html) =>
    [...html.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)]
      .map((m) => new URL(m[1].replaceAll('&amp;', '&'), 'http://giftlet.test'))
      .filter((url) => url.pathname === '/' && url.searchParams.has('occasion'))

  test('there is a landing page for every occasion, each at its own path', () => {
    assert.deepEqual(Object.keys(LANDING_PAGES).sort(), Object.keys(OCCASIONS).sort())
    const paths = Object.values(LANDING_PAGES).map((p) => p.path)
    assert.equal(new Set(paths).size, paths.length)
    for (const path of paths) assert.match(path, /^\/[a-z-]+$/)
  })

  for (const [occasion, landing] of Object.entries(LANDING_PAGES)) {
    test(`${landing.path}: title, description, and a link into the form with "${occasion}" preselected`, async () => {
      const { app } = await makeTestApp()
      const res = await app.request(landing.path, { headers: { 'user-agent': BROWSER_UA } })
      assert.equal(res.status, 200)
      const html = await res.text()

      const title = html.match(/<title>([^<]+)<\/title>/)?.[1]
      assert.ok(title && title.trim().length > 10, 'has a real title')
      assert.ok(title.toLowerCase().includes(landing.keyword), `title mentions ${landing.keyword}: ${title}`)

      const description = html.match(/<meta name="description" content="([^"]+)">/)?.[1]
      assert.ok(description, 'has a meta description')
      assert.ok(description.length >= 50 && description.length <= 160, `description length ${description.length}`)
      assert.ok(html.includes(`<p class="intro">${description}</p>`), 'the description is visible on the page too')

      const links = formLinks(html)
      assert.ok(links.length >= 1, 'links into the form')
      for (const link of links) assert.equal(link.searchParams.get('occasion'), occasion)

      // Follow the link: the form comes back with that occasion selected, and only that one.
      const form = await (await app.request(`${links[0].pathname}${links[0].search}`)).text()
      assert.match(form, /<form id="gift-form"/)
      const select = form.match(/<select id="occasion"[\s\S]*?<\/select>/)[0]
      assert.deepEqual([...select.matchAll(/<option value="([a-z]+)" selected>/g)].map((m) => m[1]), [occasion])
    })
  }
})
