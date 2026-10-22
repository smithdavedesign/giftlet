// Questionnaire validation, photo sniffing, and the form page.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readSubmission,
  sniffImage,
  cleanText,
  OCCASIONS,
  RELATIONSHIPS,
  TONES,
  THEMES,
  DEFAULT_THEME,
  LIMITS,
} from '../src/answers.js'
import { createApp } from '../src/web.js'
import { GIF_1PX, MB, MEMORIES, PHOTOS, PNG_1PX, giftForm, jpegOfSize, makeTestApp, postGift, silentLog } from './helpers.js'

describe('sniffImage', () => {
  test('recognizes JPEG, PNG, GIF and WebP by their magic bytes', () => {
    assert.equal(sniffImage(jpegOfSize(16)), 'image/jpeg')
    assert.equal(sniffImage(PNG_1PX), 'image/png')
    assert.equal(sniffImage(GIF_1PX), 'image/gif')
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
    assert.equal(sniffImage(webp), 'image/webp')
  })

  test('rejects everything else, including truncated headers', () => {
    assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null)
    assert.equal(sniffImage(Buffer.from('<!doctype html><script>x</script>')), null)
    assert.equal(sniffImage(Buffer.from('%PDF-1.7')), null)
    assert.equal(sniffImage(Buffer.from([0xff, 0xd8])), null)
    assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WAVE')), null)
    assert.equal(sniffImage(new Uint8Array(0)), null)
    // HEIC (ftypheic) is not accepted server-side; the browser re-encodes to JPEG first.
    assert.equal(sniffImage(Buffer.from('\0\0\0\x18ftypheic\0\0\0\0')), null)
  })
})

describe('cleanText', () => {
  test('trims, strips control and bidi characters, and collapses whitespace', () => {
    const rlo = String.fromCharCode(0x202e) // right-to-left override
    assert.equal(cleanText(`  Maya\u0000${rlo}  Lee \t`), 'Maya Lee')
    assert.equal(cleanText(42), '')
    assert.equal(cleanText(null), '')
  })

  test('keeps line breaks when multiline, but no more than one blank line', () => {
    assert.equal(cleanText('one\r\ntwo\n\n\n\nthree', { multiline: true }), 'one\ntwo\n\nthree')
    assert.equal(cleanText('one\ntwo'), 'one two')
  })
})

describe('readSubmission', () => {
  async function read(options) {
    return readSubmission(giftForm(options))
  }

  test('accepts a complete questionnaire and returns clean answers and sniffed photos', async () => {
    const result = await read({ name: '  Maya  ', relationship: 'partner', tone: 'sweet', memories: [...MEMORIES, '  '] })
    assert.equal(result.ok, true)
    assert.deepEqual(result.answers, {
      name: 'Maya',
      occasion: 'birthday',
      relationship: 'partner',
      tone: 'sweet',
      memories: MEMORIES,
    })
    assert.deepEqual(
      result.photos.map((p) => p.mime),
      ['image/png', 'image/gif', 'image/jpeg'],
    )
    assert.deepEqual(Buffer.from(result.photos[0].bytes), PNG_1PX)
  })

  test('returns the theme next to the answers (it is a look, not something the copy writer needs)', async () => {
    const chosen = await read({ theme: 'blush' })
    assert.equal(chosen.theme, 'blush')
    assert.ok(!('theme' in chosen.answers))
    assert.equal((await read()).theme, DEFAULT_THEME)
    for (const theme of Object.keys(THEMES)) assert.equal((await read({ theme })).theme, theme)
  })

  test('accepts every occasion, relationship and tone the form offers', async () => {
    for (const occasion of Object.keys(OCCASIONS)) assert.equal((await read({ occasion })).ok, true, occasion)
    for (const relationship of Object.keys(RELATIONSHIPS)) assert.equal((await read({ relationship })).ok, true, relationship)
    for (const tone of Object.keys(TONES)) assert.equal((await read({ tone })).ok, true, tone)
  })

  const rejects = [
    ['missing name', { name: null }, 'name'],
    ['blank name', { name: '   ' }, 'name'],
    ['name too long', { name: 'x'.repeat(61) }, 'name'],
    ['unknown occasion', { occasion: 'divorce' }, 'occasion'],
    ['missing occasion', { occasion: null }, 'occasion'],
    ['missing relationship', { relationship: null }, 'relationship'],
    ['missing tone', { tone: null }, 'tone'],
    ['prototype key as occasion', { occasion: 'toString' }, 'occasion'],
    ['unknown relationship', { relationship: 'ex' }, 'relationship'],
    ['unknown tone', { tone: 'roast' }, 'tone'],
    ['only 2 memories', { memories: MEMORIES.slice(0, 2) }, 'memory'],
    ['3 memories but one blank', { memories: [...MEMORIES.slice(0, 2), '   '] }, 'memory'],
    ['6 memories', { memories: [...MEMORIES, 'five', 'six'] }, 'memory'],
    ['a memory over the length cap', { memories: [...MEMORIES.slice(0, 3), 'y'.repeat(501)] }, 'memory'],
    ['only 2 photos', { photos: PHOTOS.slice(0, 2) }, 'photo'],
    ['13 photos', { photos: Array.from({ length: 13 }, () => PHOTOS[0]) }, 'photo'],
    ['a photo sent as text', { photos: [PHOTOS[0], PHOTOS[1], 'not-a-file'] }, 'photo'],
    ['unknown theme', { theme: 'neon' }, 'theme'],
    ['blank theme', { theme: '' }, 'theme'],
  ]
  for (const [label, options, field] of rejects) {
    test(`rejects ${label} with 400`, async () => {
      const result = await read(options)
      assert.equal(result.ok, false)
      assert.equal(result.status, 400)
      assert.equal(result.field, field)
      assert.equal(typeof result.error, 'string')
    })
  }

  test('an empty file is rejected as not an image (415)', async () => {
    const result = await read({ photos: [PHOTOS[0], PHOTOS[1], { bytes: Buffer.alloc(0), name: 'empty.jpg' }] })
    assert.equal(result.status, 415)
  })

  test('12 photos at the cap are accepted', async () => {
    const result = await read({ photos: Array.from({ length: LIMITS.photosMax }, () => PHOTOS[0]) })
    assert.equal(result.ok, true)
    assert.equal(result.photos.length, 12)
  })

  test('the 5 MB cap is 5 × 1024 × 1024 bytes', () => {
    assert.equal(LIMITS.photoMaxBytes, 5 * MB)
  })
})

describe('POST /generate request handling', () => {
  test('a body that is not multipart is rejected with 415', async () => {
    const { app } = await makeTestApp()
    const res = await app.request('/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Maya' }),
    })
    assert.equal(res.status, 415)
  })

  test('a request body over the overall cap is rejected with 413 before parsing', async () => {
    const { app } = await makeTestApp()
    const res = await app.request('/generate', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(200 * MB) },
      body: 'x',
    })
    assert.equal(res.status, 413)
  })

  test('a database failure while saving answers a JSON 500 without leaking details', async () => {
    const lines = []
    const failingStore = {
      createPage: async () => {
        throw new Error('connection to server at db.internal failed')
      },
    }
    const app = createApp({ store: failingStore, log: { warn() {}, error: (line) => lines.push(line) } })
    const res = await app.request('/generate', { method: 'POST', body: giftForm() })
    assert.equal(res.status, 500)
    const body = await res.json()
    assert.doesNotMatch(body.error, /db\.internal/)
    assert.equal(lines.length, 1, 'the failure is logged once')
  })

  test('a database failure while reading a page answers an HTML 500', async () => {
    const failingStore = {
      getPage: async () => {
        throw new Error('timeout')
      },
      getGift: async () => {
        throw new Error('timeout')
      },
    }
    const app = createApp({ store: failingStore, log: silentLog })
    const res = await app.request('/p/AAAAAAAAAAAAAAAAAAAAAA')
    assert.equal(res.status, 500)
    assert.match(res.headers.get('content-type'), /text\/html/)
    assert.match(res.headers.get('x-robots-tag'), /noindex/)
  })

  test('the multipart content type is matched case-insensitively', async () => {
    const { app } = await makeTestApp()
    const req = new Request('http://localhost/generate', { method: 'POST', body: giftForm() })
    const type = req.headers.get('content-type').replace('multipart/form-data', 'Multipart/Form-Data')
    const res = await app.request('/generate', { method: 'POST', body: await req.arrayBuffer(), headers: { 'content-type': type } })
    assert.equal(res.status, 201)
  })

  test('validation errors come back as JSON with the field name', async () => {
    const { app } = await makeTestApp()
    const res = await postGift(app, { memories: ['only one'] })
    assert.equal(res.status, 400)
    assert.match(res.headers.get('content-type'), /application\/json/)
    const body = await res.json()
    assert.equal(body.field, 'memory')
  })

  test('if the copy writer throws, the page is still made with template copy', async () => {
    const { app } = await makeTestApp({
      writeCopy: async () => {
        throw new Error('model exploded')
      },
    })
    const res = await postGift(app)
    assert.equal(res.status, 201)
    const { url } = await res.json()
    const html = await (await app.request(url)).text()
    assert.ok(html.includes('Happy birthday, Maya!'))
  })

  test('the copy writer receives the validated answers', async () => {
    let seen
    const { app } = await makeTestApp({
      writeCopy: async (answers) => {
        seen = answers
        return null
      },
    })
    await postGift(app, { name: ' Maya ' })
    assert.equal(seen.name, 'Maya')
    assert.deepEqual(seen.memories, MEMORIES)
  })
})

describe('form page', () => {
  test('GET / renders the five questions and the photo picker', async () => {
    const { app } = await makeTestApp()
    const res = await app.request('/')
    assert.equal(res.status, 200)
    const html = await res.text()
    assert.match(html, /<form id="gift-form" method="post" action="\/generate" enctype="multipart\/form-data"/)
    assert.match(html, /<input[^>]*name="name"/)
    for (const key of Object.keys(OCCASIONS)) assert.match(html, new RegExp(`<option value="${key}"`))
    for (const key of Object.keys(RELATIONSHIPS)) assert.match(html, new RegExp(`<option value="${key}"`))
    for (const key of Object.keys(TONES)) assert.match(html, new RegExp(`name="tone" value="${key}"`))
    assert.equal((html.match(/<textarea[^>]*name="memory"/g) ?? []).length, LIMITS.memoriesMax)
    assert.match(html, /<input[^>]*type="file"[^>]*name="photo"[^>]*multiple/)
    assert.match(html, /<script src="\/form.js" defer><\/script>/)
  })

  test('GET /form.js serves JavaScript that parses', async () => {
    const { app } = await makeTestApp()
    const res = await app.request('/form.js')
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /javascript/)
    const code = await res.text()
    assert.doesNotThrow(() => new Function(code))
    assert.match(code, /\/generate/)
  })

  test('the browser script sends every form field, so new ones (like theme) are not dropped', async () => {
    const { app } = await makeTestApp()
    const code = await (await app.request('/form.js')).text()
    // It starts from the whole form and only swaps the photos for shrunk copies.
    assert.match(code, /new FormData\(form\)/)
    assert.match(code, /\.delete\(['"]photo['"]\)/)
    assert.doesNotMatch(code, /\['name', 'occasion'/)
  })

  test('responses carry a strict Content-Security-Policy', async () => {
    const { app } = await makeTestApp()
    const csp = (await app.request('/')).headers.get('content-security-policy')
    assert.match(csp, /default-src 'none'/)
    assert.match(csp, /script-src 'self'/)
    assert.match(csp, /style-src 'sha256-[A-Za-z0-9+/=]+'/)
    assert.match(csp, /frame-ancestors 'none'/)
  })

  test('unknown routes return 404', async () => {
    const { app } = await makeTestApp()
    assert.equal((await app.request('/nope')).status, 404)
  })
})
