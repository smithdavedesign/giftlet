// HTTP routes. createApp takes its dependencies so tests can run it against PGlite
// and a fake copy writer; src/index.js wires the production ones.
//
//   GET  /                     questionnaire (?occasion= preselects; ?from=landing|credit is counted)
//   GET  /birthday, /anniversary, /retirement   occasion landing pages (static, indexable)
//   GET  /form.js              browser script (photo shrinking + submit)
//   GET  /c/:event/:occasion?  1×1 counting pixel (first-party analytics, counts only)
//   POST /generate             validate -> write copy -> store -> 201 { slug, url, takedownUrl }
//   GET  /p/:slug              the gift page (noindex); a watermarked preview until paid
//   GET  /p/:slug/photo/:n     photo bytes
//   GET  /p/:slug/print        the keepsake PDF once paid; 402 before
//   POST /p/:slug/checkout     unpaid page -> Stripe Checkout Session -> 303 to Stripe
//   GET  /p/:slug/takedown     confirm removal (never deletes: link previewers fetch URLs)
//   POST /p/:slug/takedown     remove page + photos; everything under /p/:slug is 404 afterwards
//   POST /stripe/webhook       signed Stripe events; a paid giftlet checkout unlocks its page
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { LIMITS, OCCASIONS, readSubmission } from './answers.js'
import { EVENTS, PIXEL_GIF, shouldCount } from './analytics.js'
import { normalizeCopy } from './copy.js'
import { formClient } from './client.js'
import { KEEPSAKE_LIMITS, keepsakeFilename, keepsakePdf } from './keepsake.js'
import { paidCheckout, verifyStripeEvent } from './payments.js'
import {
  LANDING_PAGES,
  STYLE_HASH,
  checkoutProblemPage,
  formPage,
  giftPage,
  keepsakeLockedPage,
  landingPage,
  notFoundPage,
  removedPage,
  takedownPage,
  unavailablePage,
} from './pages.js'

const SLUG_PATTERN = /^[A-Za-z0-9_-]{12,64}$/
const PHOTO_NUMBER = /^[1-9][0-9]?$/
// Room for the maximum number of maximum-size photos plus the text fields. (On Vercel
// the platform's own 4.5 MB request cap is lower; the browser shrinks photos to fit.)
const MAX_BODY_BYTES = LIMITS.photosMax * LIMITS.photoMaxBytes + 1024 * 1024
// Stripe's checkout events are a few KB; anything near this is not from Stripe.
const WEBHOOK_MAX_BYTES = 256 * 1024
const CLIENT_JS = `(${formClient})();\n`

// 16 random bytes -> 22 URL-safe characters (128 bits): the slug is the page's only secret.
export const newSlug = () => randomBytes(16).toString('base64url')

// createCheckout: async ({ slug, origin }) => { url } (payments.stripeCheckout), or null when payments are off.
// stripeWebhookSecret: without it, every webhook is refused and nothing can be unlocked.
export function createApp({
  store,
  writeCopy = async () => null,
  createCheckout = null,
  stripeWebhookSecret = null,
  makeSlug = newSlug,
  log = console,
}) {
  const app = new Hono()

  // Registered first, so it runs after secureHeaders has set its headers: a PDF goes out
  // without the HTML CSP, because Chrome's built-in viewer draws a blank page under
  // default-src 'none' (it hosts the PDF in its own page with inline styles and an embed).
  app.use('/p/:slug/print', async (c, next) => {
    await next()
    if (c.res.headers.get('content-type') === 'application/pdf') c.res.headers.delete('Content-Security-Policy')
  })

  app.use(
    '*',
    secureHeaders({
      referrerPolicy: 'no-referrer', // keeps unlisted slugs out of Referer headers
      xFrameOptions: 'DENY',
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", 'blob:'],
        styleSrc: [STYLE_HASH],
        // Chrome and Safari also check form-action against the 303 that follows a form
        // POST, so the unlock button needs Stripe Checkout's origin (and nothing broader).
        formAction: ["'self'", 'https://checkout.stripe.com'],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
    }),
  )
  app.use('/p/*', async (c, next) => {
    await next()
    c.header('X-Robots-Tag', 'noindex, nofollow')
    c.header('Cache-Control', 'private, no-store') // a takedown must not leave cached copies behind
  })

  const notFound = (c) => c.html(notFoundPage(), 404)
  const unavailable = (c) => c.html(unavailablePage(), 503)
  const pageSlug = (c) => {
    const slug = c.req.param('slug')
    return SLUG_PATTERN.test(slug) ? slug : null
  }

  app.get('/', (c) => c.html(formPage({ occasion: c.req.query('occasion'), from: c.req.query('from') })))

  // Landing pages never touch the database (a cold Neon start would delay the first
  // impression); their view is counted by the pixel request the browser makes next.
  for (const [occasion, landing] of Object.entries(LANDING_PAGES)) {
    app.get(landing.path, (c) => {
      c.header('Cache-Control', 'public, max-age=300')
      return c.html(landingPage(occasion))
    })
  }

  // Answers the GIF whatever happens, so a counting problem never shows on a page.
  app.get('/c/:event/:occasion?', async (c) => {
    const event = c.req.param('event')
    const occasion = c.req.param('occasion') ?? ''
    if (!EVENTS.includes(event) || (occasion && !Object.hasOwn(OCCASIONS, occasion))) return notFound(c)
    if (store && shouldCount(c.req.raw)) {
      try {
        await store.countEvent(event, occasion)
      } catch (err) {
        log.warn(`giftlet: could not count ${event} (${err?.name ?? 'Error'})`)
      }
    }
    return c.body(PIXEL_GIF, 200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' })
  })

  app.get('/form.js', (c) =>
    c.body(CLIENT_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' }),
  )

  app.post(
    '/generate',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'That upload is too large. Try fewer or smaller photos.' }, 413),
    }),
    async (c) => {
      if (!store) return c.json({ error: 'giftlet is not connected to its database yet. Try again soon.' }, 503)
      if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
        return c.json({ error: 'Send the questionnaire as multipart/form-data.' }, 415)
      }
      let form
      try {
        form = await c.req.formData()
      } catch {
        return c.json({ error: 'Could not read the form. Please try again.' }, 400)
      }
      const submission = await readSubmission(form)
      if (!submission.ok) return c.json({ error: submission.error, field: submission.field }, submission.status)

      const { answers, theme, photos } = submission
      let raw = null
      try {
        raw = await writeCopy(answers)
      } catch (err) {
        log.warn(`giftlet: copy writer threw (${err?.name ?? 'Error'}); using template copy`)
      }
      const copy = normalizeCopy(raw, answers)

      const slug = makeSlug()
      await store.createPage({ slug, content: { v: 1, theme, answers, copy, photoCount: photos.length }, photos })
      const url = `/p/${slug}`
      return c.json({ slug, url, takedownUrl: `${url}/takedown` }, 201)
    },
  )

  app.get('/p/:slug', async (c) => {
    const slug = pageSlug(c)
    if (!slug) return notFound(c)
    if (!store) return unavailable(c)
    const gift = await store.getGift(slug)
    if (!gift) return notFound(c)
    const fromCheckout = c.req.query('checkout') === 'success'
    const origin = new URL(c.req.url).origin
    return c.html(giftPage({ slug, ...gift.content, paid: Boolean(gift.paidAt), fromCheckout, origin }))
  })

  // Pay after preview. Only creates a session: the page unlocks when Stripe's signed
  // webhook says the session is paid, never because the buyer came back to a URL.
  app.post('/p/:slug/checkout', async (c) => {
    const slug = pageSlug(c)
    if (!slug) return notFound(c)
    if (!store) return unavailable(c)
    const gift = await store.getGift(slug)
    if (!gift) return notFound(c)
    if (gift.paidAt) return c.redirect(`/p/${slug}`, 303)
    if (!createCheckout) return c.html(checkoutProblemPage({ slug, configured: false }), 503)
    let session
    try {
      session = await createCheckout({ slug, origin: new URL(c.req.url).origin })
    } catch (err) {
      log.error(`giftlet: could not start checkout: ${err?.message}`)
      return c.html(checkoutProblemPage({ slug, configured: true }), 502)
    }
    return c.redirect(session.url, 303)
  })

  app.get('/p/:slug/photo/:n', async (c) => {
    const slug = pageSlug(c)
    const n = c.req.param('n')
    if (!slug || !PHOTO_NUMBER.test(n)) return notFound(c)
    if (!store) return unavailable(c)
    const photo = await store.getPhoto(slug, Number(n))
    if (!photo) return notFound(c)
    // The type comes from our own magic-byte sniff at upload; nosniff (secureHeaders) does the rest.
    return c.body(photo.bytes, 200, { 'Content-Type': photo.mime })
  })

  // The printable keepsake comes with payment: 402 (with the unlock button) until then.
  app.get('/p/:slug/print', async (c) => {
    const slug = pageSlug(c)
    if (!slug) return notFound(c)
    if (!store) return unavailable(c)
    const gift = await store.getGift(slug)
    if (!gift) return notFound(c)
    if (!gift.paidAt) return c.html(keepsakeLockedPage({ slug }), 402)
    const photos = await store.getPhotos(slug, KEEPSAKE_LIMITS.photos)
    const pdf = await keepsakePdf({ ...gift.content, photos })
    return c.body(pdf, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${keepsakeFilename(gift.content.answers.name)}"`,
    })
  })

  app.get('/p/:slug/takedown', async (c) => {
    const slug = pageSlug(c)
    if (!slug) return notFound(c)
    if (!store) return unavailable(c)
    const content = await store.getPage(slug)
    if (!content) return notFound(c)
    return c.html(takedownPage({ slug, name: content.answers.name }))
  })

  // Anyone holding the link may remove the page: the recipient is the person most
  // likely to want it gone, and the unguessable slug is the credential.
  app.post('/p/:slug/takedown', async (c) => {
    const slug = pageSlug(c)
    if (!slug) return notFound(c)
    if (!store) return unavailable(c)
    if (!(await store.takeDown(slug))) return notFound(c)
    return c.html(removedPage())
  })

  // Stripe's webhook. The signature covers the raw bytes, so they are hashed before any
  // parsing. Answers: 400 bad signature or body; 200 once handled, including events
  // that don't unlock anything (so Stripe stops retrying); 500 on a store failure (so it retries).
  app.post(
    '/stripe/webhook',
    bodyLimit({ maxSize: WEBHOOK_MAX_BYTES, onError: (c) => c.json({ error: 'Payload too large.' }, 413) }),
    async (c) => {
      if (!store || !stripeWebhookSecret) return c.json({ error: 'Payments are not configured.' }, 503)
      const body = new Uint8Array(await c.req.arrayBuffer())
      const event = verifyStripeEvent(body, c.req.header('stripe-signature'), stripeWebhookSecret)
      if (!event) {
        log.warn('giftlet: rejected a Stripe webhook (missing or invalid signature, or not JSON)')
        return c.json({ error: 'Invalid signature.' }, 400)
      }
      const paid = paidCheckout(event)
      if (paid && SLUG_PATTERN.test(paid.slug) && !(await store.markPaid(paid.slug, paid.sessionId))) {
        // Not unlocked: either a redelivery (already paid, fine) or the page was taken
        // down while the buyer was paying, which needs a refund. Log the session, not the slug.
        if (!(await store.getGift(paid.slug))) {
          log.warn(`giftlet: paid checkout ${paid.sessionId ?? '(no session id)'} has no live page; refund it in Stripe`)
        }
      }
      return c.json({ received: true })
    },
  )

  app.notFound(notFound)

  app.onError((err, c) => {
    log.error(`giftlet: unhandled error on ${c.req.method} ${c.req.routePath}: ${err?.message}`)
    if (c.req.path === '/generate' || c.req.path === '/stripe/webhook') {
      return c.json({ error: 'Something went wrong on our side. Please try again.' }, 500)
    }
    return c.html(unavailablePage(), 500)
  })

  return app
}
