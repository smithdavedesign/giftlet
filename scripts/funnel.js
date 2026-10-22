// The demand-test funnel: `npm run funnel` (last 30 days) or `npm run funnel -- 7`.
// Uses DATABASE_URL if set, like the app; otherwise the local PGlite database in .data/
// (stop `npm run dev` first: PGlite doesn't share its directory between processes).
// Prints counts and rates only; it never prints connection details.
import { mkdirSync } from 'node:fs'
import pg from 'pg'
import { formatFunnel } from '../src/analytics.js'
import { createStore, poolDb } from '../src/store.js'

const days = Number(process.argv[2] ?? 30)
if (!Number.isInteger(days) || days < 1 || days > 366) {
  console.error('usage: npm run funnel -- [days, 1-366, default 30]')
  process.exit(2)
}

async function open() {
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    return { db: poolDb(pool), close: () => pool.end() }
  }
  const { PGlite } = await import('@electric-sql/pglite')
  mkdirSync('.data', { recursive: true })
  const db = new PGlite('.data/pglite')
  return { db, close: () => db.close() }
}

const { db, close } = await open()
try {
  console.log(formatFunnel(await createStore(db).funnel({ days })))
} catch (err) {
  console.error(`giftlet: could not read the funnel (${err?.name ?? 'Error'}: ${err?.code ?? 'no code'})`)
  process.exitCode = 1
} finally {
  await close()
}
