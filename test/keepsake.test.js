// The keepsake PDF (src/keepsake.js) and its route, beyond the exit criteria.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import { THEMES, OCCASIONS, TONES } from '../src/answers.js'
import { COPY_LIMITS, templateCopy } from '../src/copy.js'
import { createApp } from '../src/web.js'
import { KEEPSAKE_LIMITS, LOOKS, keepsakeFilename, keepsakePdf } from '../src/keepsake.js'
import {
  GIF_1PX,
  MEMORIES,
  PNG_1PX,
  generatePage,
  jpegOfSize,
  makeTestApp,
  paidPage,
  pdfFonts,
  pdfImageDraws,
  pdfPageObjects,
  pdfText,
  pngClaiming,
  silentLog,
  tinyJpeg,
} from './helpers.js'

const answers = (over = {}) => ({
  name: 'Maya',
  occasion: 'birthday',
  relationship: 'friend',
  tone: 'funny',
  memories: MEMORIES,
  ...over,
})
const content = (over = {}, answerOver = {}) => {
  const a = answers(answerOver)
  return { theme: 'confetti', answers: a, copy: templateCopy(a), photos: [], ...over }
}
const jpeg = (opts) => ({ mime: 'image/jpeg', bytes: tinyJpeg(opts) })
const pages = (bytes) => pdfPageObjects(bytes)

describe('keepsakePdf', () => {
  for (const theme of Object.keys(THEMES)) {
    for (const occasion of Object.keys(OCCASIONS)) {
      test(`${theme} × ${occasion}: a 2-page PDF with the name, headline, memories and joke stats`, async () => {
        const c = content({ theme, photos: [jpeg(), jpeg({ width: 3, height: 4 })] }, { occasion })
        const bytes = await keepsakePdf(c)
        assert.equal(pages(bytes), 2)
        assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2)
        const text = pdfText(bytes).join(' ')
        assert.ok(text.includes('Maya'))
        assert.ok(text.includes(c.copy.headline))
        assert.ok(text.includes(c.copy.signoff))
        for (const section of c.copy.sections) assert.ok(text.includes(section.title), section.title)
        assert.equal((text.match(/JOKE STAT/g) ?? []).length, c.copy.stats.length)
        assert.ok(text.includes('Totally made-up statistics'))
        assert.equal(pdfImageDraws(bytes), 2)
      })
    }
  }

  test('every web theme has a print look (a new theme must not silently print as the default)', () => {
    assert.deepEqual(Object.keys(LOOKS).sort(), Object.keys(THEMES).sort())
  })

  test('each theme carries its own type into print', async () => {
    const fonts = async (theme) => pdfFonts(await keepsakePdf(content({ theme })))
    assert.ok((await fonts('confetti')).includes('Helvetica-Bold'))
    assert.ok((await fonts('blush')).includes('Times-BoldItalic'))
    assert.ok((await fonts('postcard')).includes('Times-Bold'))
  })

  test('the longest allowed text in wide letters still fits on 2 pages', async () => {
    const L = COPY_LIMITS
    const words = (n) => 'WWWWWWW MMMMMMMM '.repeat(Math.ceil(n / 17)).slice(0, n)
    for (const tone of Object.keys(TONES)) {
      const copy = {
        headline: words(L.headline),
        intro: words(L.intro),
        sections: Array.from({ length: L.sectionsMax }, () => ({ title: words(L.sectionTitle), body: words(L.sectionBody) })),
        stats: Array.from({ length: L.statsMax }, () => ({ value: 'W'.repeat(L.statValue), label: words(L.statLabel) })),
        signoff: words(L.signoff),
      }
      const c = { theme: 'postcard', answers: answers({ tone, name: 'W'.repeat(60) }), copy, photos: Array.from({ length: 12 }, () => jpeg()) }
      const bytes = await keepsakePdf(c)
      assert.ok(pages(bytes) <= 2, `${tone}: ${pages(bytes)} pages`)
      assert.equal((pdfText(bytes).join(' ').match(/JOKE STAT/g) ?? []).length, L.statsMax)
    }
  })

  test('one unbroken 600-character "word" wraps instead of running off the page', async () => {
    const c = content()
    c.copy.sections[0].body = 'a'.repeat(COPY_LIMITS.sectionBody)
    const bytes = await keepsakePdf(c)
    assert.equal(pages(bytes), 2)
    const lines = pdfText(bytes).filter((s) => /^a+$/.test(s))
    assert.ok(lines.length >= 2, 'the long word is split across lines')
    assert.equal(lines.join('').length, COPY_LIMITS.sectionBody)
  })

  test('emoji and non-Latin letters are dropped instead of failing the whole PDF', async () => {
    const c = content({}, { name: 'Zoë 🎉' })
    c.copy.intro = 'Für dich 💖 — with “love”, 日本語 and Привет…'
    c.copy.stats[0] = { value: '🎂 3', label: 'cakes 🍰 eaten' }
    const bytes = await keepsakePdf(c)
    const text = pdfText(bytes).join(' ')
    assert.ok(text.includes('Zoë'), 'Latin-1 letters survive')
    assert.ok(text.includes('Für dich'), 'German survives')
    assert.ok(text.includes('\u0093love\u0094'), 'curly quotes survive (WinAnsi 0x93/0x94)')
    assert.ok(!text.includes('🎉'))
    assert.ok(text.includes('3'))
  })

  test('the template birthday stat "∞" is drawn with the Symbol font', async () => {
    const c = content()
    assert.ok(c.copy.stats.some((s) => s.value === '∞'))
    const bytes = await keepsakePdf(c)
    assert.ok(pdfFonts(bytes).includes('Symbol'))
  })

  test('a name with no printable letters becomes "you"', async () => {
    const bytes = await keepsakePdf(content({}, { name: '美咲' }))
    assert.ok(pdfText(bytes).some((s) => /For you/.test(s)))
  })

  test('a JPEG handed over as a slice of a bigger buffer (as pg returns bytea) is still embedded', async () => {
    const real = tinyJpeg({ width: 40, height: 30 })
    const pool = Buffer.alloc(real.length + 333, 0x11)
    real.copy(pool, 333)
    const slice = pool.subarray(333)
    assert.notEqual(slice.byteOffset, 0)
    const bytes = await keepsakePdf(content({ photos: [{ mime: 'image/jpeg', bytes: slice }] }))
    assert.equal(pdfImageDraws(bytes), 1)
  })

  test('PNG is embedded; GIF, WebP and broken JPEGs are skipped without failing', async () => {
    const webp = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1')
    const photos = [
      { mime: 'image/png', bytes: PNG_1PX },
      { mime: 'image/gif', bytes: GIF_1PX },
      { mime: 'image/webp', bytes: webp },
      { mime: 'image/jpeg', bytes: jpegOfSize(2048) },
    ]
    const bytes = await keepsakePdf(content({ photos }))
    assert.equal(pdfImageDraws(bytes), 1)
    assert.equal(pages(bytes), 2)
  })

  test('a PNG claiming huge dimensions is skipped without being decoded', async () => {
    const started = Date.now()
    const bytes = await keepsakePdf(content({ photos: [{ mime: 'image/png', bytes: pngClaiming(30000, 30000) }, jpeg()] }))
    assert.equal(pdfImageDraws(bytes), 1)
    assert.ok(Date.now() - started < 5000)
  })

  test(`at most ${KEEPSAKE_LIMITS.photos} photos go into the keepsake`, async () => {
    const bytes = await keepsakePdf(content({ photos: Array.from({ length: 12 }, () => jpeg()) }))
    assert.equal(pdfImageDraws(bytes), KEEPSAKE_LIMITS.photos)
  })

  test('photos are dropped until the PDF fits the size budget (Vercel caps responses at 4.5 MB)', async () => {
    assert.ok(KEEPSAKE_LIMITS.maxBytes <= 4.5 * 1024 * 1024 - 256 * 1024)
    const photos = Array.from({ length: 4 }, () => jpeg({ padding: 30_000 }))
    const full = await keepsakePdf(content({ photos }))
    assert.equal(pdfImageDraws(full), 4)
    const budget = 75_000
    const trimmed = await keepsakePdf(content({ photos }), { maxBytes: budget })
    assert.ok(trimmed.length <= budget, `${trimmed.length} bytes`)
    assert.ok(pdfImageDraws(trimmed) >= 1 && pdfImageDraws(trimmed) < 4)
    assert.equal(pages(trimmed), 2)
  })

  test('an unknown stored theme falls back to the default look', async () => {
    const bytes = await keepsakePdf(content({ theme: 'toString' }))
    assert.equal(pages(bytes), 2)
  })

  test('the PDF metadata names the recipient and not the page link', async () => {
    // updateMetadata: false, or pdf-lib stamps its own Producer while loading.
    const doc = await PDFDocument.load(await keepsakePdf(content()), { updateMetadata: false })
    assert.equal(doc.getTitle(), 'A keepsake for Maya')
    assert.equal(doc.getProducer(), 'giftlet')
  })
})

describe('keepsakeFilename', () => {
  test('is ASCII, lower-case and safe to put in a header', () => {
    assert.equal(keepsakeFilename('Maya'), 'giftlet-keepsake-maya.pdf')
    assert.equal(keepsakeFilename('José María'), 'giftlet-keepsake-jose-maria.pdf')
    assert.equal(keepsakeFilename('a"b\r\nSet-Cookie: x=1'), 'giftlet-keepsake-a-b-set-cookie-x-1.pdf')
    assert.equal(keepsakeFilename('美咲'), 'giftlet-keepsake.pdf')
    assert.match(keepsakeFilename('x'.repeat(200)), /^giftlet-keepsake-x{1,40}\.pdf$/)
  })
})

describe('GET /p/:slug/print', () => {
  test('serves the PDF inline with a filename, noindex and no-store, and without the HTML CSP', async () => {
    const { app } = await makeTestApp()
    const { slug } = await paidPage(app, { name: 'José' })
    const res = await app.request(`/p/${slug}/print`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-disposition'), 'inline; filename="giftlet-keepsake-jose.pdf"')
    assert.match(res.headers.get('x-robots-tag'), /noindex/)
    assert.match(res.headers.get('cache-control'), /no-store/)
    // Chrome's PDF viewer draws a blank page under default-src 'none'.
    assert.equal(res.headers.get('content-security-policy'), null)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  })

  test('the 402 page is HTML and keeps the strict CSP', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    const res = await app.request(`/p/${slug}/print`)
    assert.equal(res.status, 402)
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/)
    assert.match(res.headers.get('x-robots-tag'), /noindex/)
    const html = await res.text()
    assert.match(html, /keepsake/i)
    assert.match(html, /Unlock for \$9/)
  })

  test('unknown, malformed and taken-down pages are 404', async () => {
    const { app } = await makeTestApp()
    const { slug } = await paidPage(app)
    assert.equal((await app.request('/p/AAAAAAAAAAAAAAAAAAAAAA/print')).status, 404)
    assert.equal((await app.request('/p/short/print')).status, 404)
    assert.equal((await app.request(`/p/${slug}/takedown`, { method: 'POST' })).status, 200)
    assert.equal((await app.request(`/p/${slug}/print`)).status, 404)
  })

  test('the photos come from the store in one query, in order', async () => {
    const { app, store } = await makeTestApp()
    const photos = [
      { bytes: tinyJpeg({ width: 10, height: 10 }), name: 'a.jpg', type: 'image/jpeg' },
      { bytes: tinyJpeg({ width: 20, height: 10 }), name: 'b.jpg', type: 'image/jpeg' },
      { bytes: tinyJpeg({ width: 30, height: 10 }), name: 'c.jpg', type: 'image/jpeg' },
    ]
    const { slug } = await paidPage(app, { photos })
    let calls = 0
    const getPhoto = store.getPhoto
    store.getPhoto = async (...args) => (calls++, getPhoto(...args))
    const res = await app.request(`/p/${slug}/print`)
    assert.equal(res.status, 200)
    assert.equal(calls, 0, 'no per-photo queries')
    assert.equal(pdfImageDraws(new Uint8Array(await res.arrayBuffer())), 3)
  })

  test('without a database it answers 503', async () => {
    const app = createApp({ store: null, log: silentLog })
    assert.equal((await app.request('/p/AAAAAAAAAAAAAAAAAAAAAA/print')).status, 503)
  })

  test('a database failure answers an HTML 500 without details', async () => {
    const failing = {
      getGift: async () => {
        throw new Error('connection reset by 10.0.0.7')
      },
    }
    const app = createApp({ store: failing, log: silentLog })
    const res = await app.request('/p/AAAAAAAAAAAAAAAAAAAAAA/print')
    assert.equal(res.status, 500)
    assert.match(res.headers.get('content-type'), /text\/html/)
    assert.doesNotMatch(await res.text(), /10\.0\.0\.7/)
  })
})
