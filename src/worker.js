// The Cloudflare Worker (wrangler.jsonc; production since 2026-11-08, when the Vercel account was
// blocked): the same Hono app as src/index.js, with its settings from the Worker's vars and secrets
// (env) instead of process.env. wrangler.jsonc sets SITE_URL and NEXT_PUBLIC_DEPLOY_ENV; DATABASE_URL
// and GOOGLE_API_KEY are secrets (`provision cloudflare secret giftlet <KEY>`), as are the Stripe
// values once there are any.
//
// A Worker can't use a socket that another request opened, so the pg pool can't outlive a request as
// it does on Vercel: each request gets its own small pool (it connects only when a route queries),
// ended once the response is ready. The schema (CREATE TABLE IF NOT EXISTS …) still runs once per
// isolate, not once per request.
import pg from 'pg'
import { createApp, deployEnv } from './web.js'
import { createStore, poolDb } from './store.js'
import { geminiWriter } from './copy.js'
import { stripeCheckout } from './payments.js'

// One request's database: poolDb over a small pg pool, plus close() to end it. Only an error's code
// or name is logged: a driver's message can carry connection details.
export function pgConnect(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000 })
  pool.on('error', (err) => console.error(`giftlet: idle database connection error: ${err.code ?? err.name}`))
  return { ...poolDb(pool), close: () => pool.end() }
}

// The Worker's fetch handler; `connect(DATABASE_URL)` gives each request its database (tests pass
// one over PGlite).
export function createWorker({ connect = pgConnect, log = console } = {}) {
  const ran = new Set() // exec() texts (the schema) that already succeeded in this isolate
  const schemaOnce = (db) => ({
    query: (text, params) => db.query(text, params),
    async exec(text) {
      if (ran.has(text)) return
      await db.exec(text)
      ran.add(text)
    },
  })
  return {
    async fetch(request, env, ctx) {
      const db = env.DATABASE_URL ? connect(env.DATABASE_URL) : null
      try {
        const app = createApp({
          store: db && createStore(schemaOnce(db)),
          writeCopy: geminiWriter({ apiKey: env.GOOGLE_API_KEY, model: env.GEMINI_MODEL }),
          createCheckout: stripeCheckout({ secretKey: env.STRIPE_SECRET_KEY }),
          stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
          paymentLink: env.STRIPE_PAYMENT_LINK,
          siteUrl: env.SITE_URL,
          beacon: deployEnv(env) === 'production',
          log,
        })
        return await app.fetch(request, env, ctx)
      } finally {
        if (db) {
          ctx.waitUntil(
            Promise.resolve()
              .then(() => db.close())
              .catch((err) => log.error(`giftlet: closing the database failed: ${err.code ?? err.name}`)),
          )
        }
      }
    },
  }
}

export default createWorker()
