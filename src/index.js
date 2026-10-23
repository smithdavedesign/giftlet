// Production entry. Vercel deploys the default-exported Hono app with zero config.
// Configuration comes only from environment variables (set by the credential broker):
//   DATABASE_URL    Neon Postgres connection string (pooled). Without it, data routes answer 503.
//   GOOGLE_API_KEY  Gemini API key. Without it, pages use template copy.
//   GEMINI_MODEL    optional model override (default: gemini-flash-latest).
//   STRIPE_PAYMENT_LINK    the Stripe Payment Link ($9 once) behind the Buy button ("Unlock for $9").
//   STRIPE_SECRET_KEY      or: creates Checkout Sessions instead (used when there is no payment link).
//   STRIPE_WEBHOOK_SECRET  verifies Stripe's webhook. Without it, no page can be unlocked, so no Buy button shows.
//   SITE_URL               optional canonical origin; else Vercel's VERCEL_PROJECT_PRODUCTION_URL, else the request's.
//   VERCEL_ENV             set by Vercel; the RepoHQ usage beacon runs only when it is "production".
import pg from 'pg'
import { createApp } from './web.js'
import { createStore, poolDb } from './store.js'
import { geminiWriter } from './copy.js'
import { stripeCheckout } from './payments.js'

function databaseStore(connectionString) {
  if (!connectionString) return null
  // Small pool: on Vercel each function instance is reused across requests (Fluid compute),
  // and Neon's pooled endpoint does the real connection pooling.
  const pool = new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000 })
  // Neon closes idle connections; without a listener that error would crash the process.
  pool.on('error', (err) => console.error(`giftlet: idle database connection error: ${err.message}`))
  return createStore(poolDb(pool))
}

const app = createApp({
  store: databaseStore(process.env.DATABASE_URL),
  writeCopy: geminiWriter({ apiKey: process.env.GOOGLE_API_KEY, model: process.env.GEMINI_MODEL }),
  createCheckout: stripeCheckout({ secretKey: process.env.STRIPE_SECRET_KEY }),
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  paymentLink: process.env.STRIPE_PAYMENT_LINK,
  siteUrl: process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL,
  beacon: process.env.VERCEL_ENV === 'production',
})

export default app
