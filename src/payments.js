// Pay after preview: send the buyer to Stripe, and verify Stripe's webhook.
// Plain fetch and node:crypto, no SDK: the same pattern as the Gemini call in copy.js,
// for the only two Stripe calls giftlet makes. Configuration comes from env vars:
//   STRIPE_PAYMENT_LINK    a Stripe Payment Link ($9 once); the Buy button opens it for one page
//   STRIPE_SECRET_KEY      or: creates sessions (a restricted key with Checkout Sessions: write is enough)
//   STRIPE_WEBHOOK_SECRET  checks the Stripe-Signature header on POST /stripe/webhook (needed by both)
import { createHmac, timingSafeEqual } from 'node:crypto'

export const PRICE = { cents: 900, currency: 'usd', label: '$9' }

// Every session is tagged with the app. One Stripe account can serve several
// products, and a webhook endpoint receives the checkout events of all of them.
export const APP_TAG = 'giftlet'

const SESSIONS_API = 'https://api.stripe.com/v1/checkout/sessions'
const CHECKOUT_ORIGIN = 'https://checkout.stripe.com'
const TIMEOUT_MS = 15_000
// Stripe's own libraries allow 5 minutes between signing and receipt.
export const SIGNATURE_TOLERANCE_SEC = 300

// The form-encoded body for POST /v1/checkout/sessions. Nothing about the recipient
// (name, memories) goes to Stripe: the slug is the only link back to the page.
export function checkoutParams({ slug, origin }) {
  const page = `${origin}/p/${slug}`
  return new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': PRICE.currency,
    'line_items[0][price_data][unit_amount]': String(PRICE.cents),
    'line_items[0][price_data][product_data][name]': 'giftlet: personal gift page',
    client_reference_id: slug,
    'metadata[app]': APP_TAG,
    success_url: `${page}?checkout=success`,
    cancel_url: page,
  })
}

// STRIPE_PAYMENT_LINK, checked once at startup: an https URL, or null (no Buy button).
export function paymentLinkUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

// The Buy button's target for one page. Stripe hands client_reference_id back in the
// checkout.session.completed webhook, which is how the payment finds its page (the slug
// is [A-Za-z0-9_-], which is what Stripe accepts there).
export function paymentLinkFor(link, slug) {
  const url = new URL(link)
  url.searchParams.set('client_reference_id', slug)
  return url.href
}

function isCheckoutUrl(value) {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).origin === CHECKOUT_ORIGIN
  } catch {
    return false
  }
}

// Returns async ({ slug, origin }) => { id, url }, or null when no key is configured
// (payments are off). Errors are re-thrown with a status or error name only, so
// neither the key nor the slug can reach the logs.
export function stripeCheckout({ secretKey, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (!secretKey) return null
  return async ({ slug, origin }) => {
    let session
    try {
      const res = await fetch(SESSIONS_API, {
        method: 'POST',
        headers: { authorization: `Bearer ${secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: checkoutParams({ slug, origin }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      session = await res.json()
    } catch (err) {
      const detail = err?.message?.startsWith('HTTP ') ? err.message : (err?.name ?? 'Error')
      throw new Error(`Stripe checkout failed (${detail})`)
    }
    if (!isCheckoutUrl(session?.url)) throw new Error('Stripe returned no checkout URL')
    return { id: typeof session.id === 'string' ? session.id : null, url: session.url }
  }
}

function parseSignatureHeader(header) {
  let timestamp = null
  const signatures = []
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2)
    if (key === 't' && timestamp === null && /^\d{1,12}$/.test(value ?? '')) timestamp = Number(value)
    // Only v1 counts: v0 is Stripe's test scheme, and accepting it would allow a downgrade.
    if (key === 'v1' && /^[0-9a-f]{64}$/.test(value ?? '')) signatures.push(Buffer.from(value, 'hex'))
  }
  return { timestamp, signatures }
}

// Checks a Stripe-Signature header against the exact request bytes, as Stripe documents:
// v1 = hex(HMAC-SHA256(secret, `${t}.${rawBody}`)), timestamp within the tolerance.
// Returns the parsed event object, or null if anything is off.
export function verifyStripeEvent(
  rawBody,
  header,
  secret,
  { now = Date.now(), toleranceSec = SIGNATURE_TOLERANCE_SEC } = {},
) {
  if (!secret || typeof header !== 'string') return null
  const { timestamp, signatures } = parseSignatureHeader(header)
  if (timestamp === null || signatures.length === 0) return null
  if (Math.abs(now / 1000 - timestamp) > toleranceSec) return null
  const body = Buffer.from(rawBody)
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest()
  if (!signatures.some((signature) => timingSafeEqual(signature, expected))) return null
  try {
    const event = JSON.parse(body.toString('utf8'))
    return event && typeof event === 'object' && !Array.isArray(event) ? event : null
  } catch {
    return null
  }
}

// Events that mean "this session is paid". A completed session can still be unpaid
// (delayed methods such as bank debits); those settle with async_payment_succeeded.
const PAID_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])

// Our own sessions carry metadata.app. A session made by the Stripe Payment Link carries
// it only if it was set on the link, so a payment-link session also counts when it took
// at least the price: another product's cheaper link can't unlock a page.
function isGiftletSession(session) {
  if (session.metadata?.app === APP_TAG) return true
  return (
    typeof session.payment_link === 'string' &&
    session.currency === PRICE.currency &&
    Number.isInteger(session.amount_total) &&
    session.amount_total >= PRICE.cents
  )
}

// Returns { slug, sessionId } when a verified event is a paid giftlet checkout, else null.
// The caller still checks the slug's shape before using it.
export function paidCheckout(event) {
  if (!event || typeof event !== 'object' || !PAID_EVENTS.has(event.type)) return null
  const session = event.data?.object
  if (session?.object !== 'checkout.session' || !isGiftletSession(session)) return null
  if (session.payment_status !== 'paid') return null
  if (typeof session.client_reference_id !== 'string') return null
  return { slug: session.client_reference_id, sessionId: typeof session.id === 'string' ? session.id : null }
}
