// Local development server: `npm run dev`, then open http://localhost:3000
// Uses DATABASE_URL if set; otherwise an on-disk PGlite database in .data/ (no setup),
// or a throwaway in-memory one with GIFTLET_PGLITE=memory:// (the screenshot run uses that).
// Uses GOOGLE_API_KEY if set; otherwise template copy.
// Uses STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET (test mode) if set; forward events with
// `stripe listen --forward-to localhost:3000/stripe/webhook`. Without them pages stay previews.
import { mkdirSync } from 'node:fs'
import { serve } from '@hono/node-server'
import pg from 'pg'
import { createApp } from '../src/web.js'
import { createStore, poolDb } from '../src/store.js'
import { geminiWriter } from '../src/copy.js'
import { stripeCheckout } from '../src/payments.js'

async function localDb() {
  if (process.env.DATABASE_URL) {
    console.log('giftlet: using the Postgres database from DATABASE_URL')
    return poolDb(new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 }))
  }
  const { PGlite } = await import('@electric-sql/pglite')
  if (process.env.GIFTLET_PGLITE === 'memory://') {
    console.log('giftlet: using a throwaway in-memory PGlite database')
    return new PGlite()
  }
  mkdirSync('.data', { recursive: true })
  console.log('giftlet: using a local PGlite database in .data/pglite')
  return new PGlite('.data/pglite')
}

const app = createApp({
  store: createStore(await localDb()),
  writeCopy: geminiWriter({ apiKey: process.env.GOOGLE_API_KEY, model: process.env.GEMINI_MODEL }),
  createCheckout: stripeCheckout({ secretKey: process.env.STRIPE_SECRET_KEY }),
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
})

const port = Number(process.env.PORT) || 3000
serve({ fetch: app.fetch, port }, () => console.log(`giftlet: http://localhost:${port}`))
