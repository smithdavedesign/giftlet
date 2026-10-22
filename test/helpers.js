// Shared fixtures: an app wired to an in-process Postgres (PGlite), tiny real
// image files, and a builder for the questionnaire's multipart body.
import { createHmac } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { PGlite } from '@electric-sql/pglite'
import { createApp } from '../src/web.js'
import { createStore } from '../src/store.js'

export const MB = 1024 * 1024

// A real 1×1 PNG.
export const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c70000000049454e44ae426082',
  'hex',
)

// A real 1×1 GIF.
export const GIF_1PX = Buffer.from('47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b', 'hex')

// JPEG magic bytes followed by filler, at an exact size (the server only sniffs the header).
export function jpegOfSize(bytes) {
  const buf = Buffer.alloc(bytes, 0x41)
  buf.set([0xff, 0xd8, 0xff, 0xe0], 0)
  return buf
}

export const MEMORIES = [
  'The road trip where we got lost and found the best taco stand in Arizona.',
  'You taught me to make pancakes at 2am the night before my chemistry exam.',
  'Karaoke night: you sang every single part of Bohemian Rhapsody.',
  'The time you showed up with soup and terrible jokes when I had the flu.',
]

export const silentLog = { warn() {}, error() {}, info() {} }

export const PHOTOS = [
  { bytes: PNG_1PX, name: 'beach.png', type: 'image/png' },
  { bytes: GIF_1PX, name: 'cake.gif', type: 'image/gif' },
  { bytes: jpegOfSize(2048), name: 'karaoke.jpg', type: 'image/jpeg' },
]

export function giftForm({
  name = 'Maya',
  occasion = 'birthday',
  relationship = 'friend',
  tone = 'funny',
  theme = null,
  memories = MEMORIES,
  photos = PHOTOS,
} = {}) {
  // Pass null for a field to leave it out of the form (theme is left out by default,
  // as an M1-era API caller would).
  const form = new FormData()
  if (name !== null) form.set('name', name)
  if (occasion !== null) form.set('occasion', occasion)
  if (relationship !== null) form.set('relationship', relationship)
  if (tone !== null) form.set('tone', tone)
  if (theme !== null) form.set('theme', theme)
  for (const memory of memories) form.append('memory', memory)
  photos.forEach((photo, i) => {
    if (typeof photo === 'string') form.append('photo', photo)
    else form.append('photo', new File([photo.bytes], photo.name ?? `photo-${i + 1}`, { type: photo.type ?? '' }))
  })
  return form
}

export async function makeTestApp({ writeCopy, createCheckout, stripeWebhookSecret = WEBHOOK_SECRET, log = silentLog } = {}) {
  const db = new PGlite()
  const store = createStore(db)
  const app = createApp({ store, writeCopy, createCheckout, stripeWebhookSecret, log })
  return { app, db, store }
}

// Stripe test doubles. Secrets and ids are built at runtime so nothing
// credential-shaped is committed; they are fakes and never reach Stripe.
export const WEBHOOK_SECRET = ['whsec', 'A1b2C3d4'.repeat(4)].join('_')
export const OTHER_SECRET = ['whsec', 'Z9y8X7w6'.repeat(4)].join('_')
export const SESSION_ID = ['cs', 'test', 'a1B2c3D4'.repeat(4)].join('_')

// Signs a payload the way Stripe documents it, independently of src/payments.js:
// v1 = hex(HMAC-SHA256(secret, `${t}.${rawBody}`)).
export function stripeSignature(rawBody, { secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  return `t=${timestamp},v1=${v1}`
}

// A Stripe event wrapping a Checkout Session, shaped like the real payload.
export function checkoutEvent({
  slug,
  type = 'checkout.session.completed',
  paymentStatus = 'paid',
  app = 'giftlet',
  sessionId = SESSION_ID,
} = {}) {
  return {
    id: `evt_${'0a1b2c3d'.repeat(3)}`,
    object: 'event',
    type,
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        mode: 'payment',
        client_reference_id: slug,
        metadata: app === null ? {} : { app },
        payment_status: paymentStatus,
        status: 'complete',
        amount_total: 900,
        currency: 'usd',
      },
    },
  }
}

// POSTs an event to the webhook. By default it is signed correctly; pass
// `signature` to send any header (or null for none) and `body` to send other bytes.
export function postWebhook(app, event, { signature, body, secret, timestamp } = {}) {
  const raw = body ?? JSON.stringify(event)
  const header = signature === undefined ? stripeSignature(raw, { secret, timestamp }) : signature
  const headers = { 'content-type': 'application/json; charset=utf-8' }
  if (header !== null) headers['stripe-signature'] = header
  return app.request('/stripe/webhook', { method: 'POST', headers, body: raw })
}

// A fake createCheckout that records its calls and answers like Stripe.
export function fakeCheckout() {
  const calls = []
  const createCheckout = async (args) => {
    calls.push(args)
    return { id: SESSION_ID, url: `https://checkout.stripe.com/c/pay/${SESSION_ID}` }
  }
  return { calls, createCheckout }
}

export const hasWatermark = (html) => /<div class="watermark"/.test(html)
export const keepsakeHref = (slug) => `href="/p/${slug}/print"`

export function postGift(app, options) {
  return app.request('/generate', {
    method: 'POST',
    body: giftForm(options),
    headers: { accept: 'application/json' },
  })
}

// Generates a page and returns { slug, url, html } for the happy path.
export async function generatePage(app, options) {
  const res = await postGift(app, options)
  if (res.status !== 201) throw new Error(`expected 201, got ${res.status}: ${await res.text()}`)
  const body = await res.json()
  const page = await app.request(body.url)
  return { ...body, page, html: await page.text() }
}

export function statItems(html) {
  return html.match(/<li class="stat">[\s\S]*?<\/li>/g) ?? []
}

// Generates a page and unlocks it with a signed webhook, as Stripe would after payment.
export async function paidPage(app, options) {
  const made = await generatePage(app, options)
  const res = await postWebhook(app, checkoutEvent({ slug: made.slug }))
  if (res.status !== 200) throw new Error(`webhook answered ${res.status}`)
  return made
}

// A structurally valid baseline JPEG header (SOI, JFIF, SOF0 with real dimensions, EOI)
// with optional padding. pdf-lib only reads the header; the browser form always sends JPEG.
export function tinyJpeg({ width = 4, height = 3, padding = 0 } = {}) {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]
  return Buffer.concat([Buffer.from(head), Buffer.from(sof), Buffer.alloc(padding), Buffer.from([0xff, 0xd9])])
}

// A PNG whose header claims the given dimensions (no real pixel data): a decompression bomb stand-in.
export function pngClaiming(width, height) {
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write('IHDR', 4, 'latin1')
  ihdr.writeUInt32BE(width, 8)
  ihdr.writeUInt32BE(height, 12)
  ihdr.set([8, 2, 0, 0, 0], 16) // 8-bit RGB, no interlace; CRC left as zeros
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
  return Buffer.concat([PNG_1PX.subarray(0, 8), ihdr, iend])
}

// A browser's User-Agent, so analytics counts the request (bots and headless browsers are skipped).
export const BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

// --- Reading PDFs without the library that wrote them ---

const latin1 = (buf) => Buffer.from(buf).toString('latin1')

// Page objects in the file (/Type /Page, not /Pages). Needs uncompressed object storage,
// which the keepsake uses for compatibility with old readers.
export function pdfPageObjects(bytes) {
  return (latin1(bytes).match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length
}

// The decompressed bodies of every FlateDecode stream (page content and images).
function inflatedStreams(bytes) {
  const text = latin1(bytes)
  const out = []
  const re = /<<((?:(?!>>\s*stream)[\s\S])*?)>>\s*stream\r?\n/g
  let m
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length
    const end = text.indexOf('endstream', start)
    if (end === -1) break
    if (/\/FlateDecode/.test(m[1])) {
      try {
        out.push(latin1(inflateSync(Buffer.from(bytes).subarray(start, end))))
      } catch {
        // an image stream or a trailing newline variant; ignore
      }
    }
    re.lastIndex = end
  }
  return out
}

// Every string the page content draws with Tj, decoded as WinAnsi (Latin-1 for these tests).
export function pdfText(bytes) {
  const strings = []
  for (const stream of inflatedStreams(bytes)) {
    for (const m of stream.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) strings.push(latin1(Buffer.from(m[1], 'hex')))
    for (const m of stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) strings.push(m[1])
  }
  return strings
}

// How many images the page content actually draws.
export function pdfImageDraws(bytes) {
  return inflatedStreams(bytes).reduce((n, s) => n + (s.match(/\/Image-\d+ Do\b/g) ?? []).length, 0)
}

export const pdfFonts = (bytes) => [...latin1(bytes).matchAll(/\/BaseFont\s*\/([A-Za-z-]+)/g)].map((m) => m[1])
