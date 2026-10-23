// Postgres persistence for pages, their photos, and the analytics counters.
// `db` is anything with query(text, params) -> { rows } and exec(multiStatementText):
// a PGlite instance as-is (tests, local dev) or poolDb(new pg.Pool(...)) in production.
import { OCCASIONS } from './answers.js'
import { EVENTS } from './analytics.js'

// Runs as one simple-protocol query, i.e. one implicit transaction, so the advisory
// lock serializes concurrent cold starts racing on CREATE TABLE IF NOT EXISTS.
const SCHEMA = `
SELECT pg_advisory_xact_lock(4471120);
CREATE TABLE IF NOT EXISTS pages (
  slug text PRIMARY KEY,
  content jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  taken_down_at timestamptz
);
CREATE TABLE IF NOT EXISTS photos (
  slug text NOT NULL REFERENCES pages (slug) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position > 0),
  mime text NOT NULL,
  bytes bytea NOT NULL,
  PRIMARY KEY (slug, position)
);
-- M2: payment state. ADD COLUMN IF NOT EXISTS upgrades databases created by M1 in place.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS checkout_session text;
-- M3: the occasion outlives a takedown (it says nothing about the recipient), so the
-- funnel can still count a removed page against its occasion.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS occasion text;
-- Go-live: the payment link's return URL (/paid?session_id=…) finds its page by session.
CREATE INDEX IF NOT EXISTS pages_checkout_session ON pages (checkout_session);
-- M3: first-party analytics. One counter per UTC day, event and occasion; no visitor data.
CREATE TABLE IF NOT EXISTS daily_counts (
  day date NOT NULL,
  event text NOT NULL,
  occasion text NOT NULL DEFAULT '',
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (day, event, occasion)
);`

// Both funnel queries use this window: today and the days-1 before it, in UTC. A constant
// SQL fragment (the day count is always the bound parameter $1), so the two windows can't drift.
const SINCE_UTC_DAY = "((now() AT TIME ZONE 'UTC')::date - ($1::int - 1))"

const ZERO = { landingViews: 0, makeClicks: 0, pagesMade: 0, pagesPaid: 0, pagesRemoved: 0 }
const COUNTER_FIELDS = { landing_view: 'landingViews', make_click: 'makeClicks' }

export function poolDb(pool) {
  return {
    query: (text, params) => pool.query(text, params),
    exec: (text) => pool.query(text),
  }
}

export function createStore(db) {
  let ready
  const ensureSchema = () =>
    (ready ??= db.exec(SCHEMA).catch((err) => {
      ready = undefined // retry on the next request instead of caching the failure
      throw err
    }))

  // A live page's content and payment state, or null if it doesn't exist or was taken down.
  async function getGift(slug) {
    await ensureSchema()
    const { rows } = await db.query(
      'SELECT content, paid_at FROM pages WHERE slug = $1 AND taken_down_at IS NULL',
      [slug],
    )
    return rows[0] ? { content: rows[0].content, paidAt: rows[0].paid_at ?? null } : null
  }

  return {
    ensureSchema,
    getGift,

    // Inserts the page and all its photos in one statement, so it is all-or-nothing.
    async createPage({ slug, content, photos }) {
      if (!photos.length) throw new Error('a page needs at least one photo')
      await ensureSchema()
      const params = [slug, JSON.stringify(content)]
      // Only placeholder numbers are interpolated into the SQL; every value is a parameter.
      const rows = photos.map((photo, i) => {
        params.push(i + 1, photo.mime, photo.bytes)
        const n = params.length
        return `($${n - 2}::smallint, $${n - 1}::text, $${n}::bytea)`
      })
      await db.query(
        `WITH page AS (
           INSERT INTO pages (slug, content, occasion)
           VALUES ($1, $2::jsonb, $2::jsonb #>> '{answers,occasion}') RETURNING slug
         )
         INSERT INTO photos (slug, position, mime, bytes)
         SELECT page.slug, v.position, v.mime, v.bytes
         FROM page, (VALUES ${rows.join(', ')}) AS v (position, mime, bytes)`,
        params,
      )
    },

    async getPage(slug) {
      return (await getGift(slug))?.content ?? null
    },

    // Unlocks a live, unpaid page and records the Checkout Session (for refunds).
    // Returns true only for the call that unlocked it: Stripe delivers events at least
    // once and in any order, so a repeat must be a no-op, and a taken-down page stays down.
    async markPaid(slug, sessionId) {
      await ensureSchema()
      const { rows } = await db.query(
        `UPDATE pages SET paid_at = now(), checkout_session = $2
         WHERE slug = $1 AND taken_down_at IS NULL AND paid_at IS NULL
         RETURNING slug`,
        [slug, sessionId],
      )
      return rows.length === 1
    },

    // The live page a paid Checkout Session unlocked, or null (not paid yet, or removed).
    async findPaidSlug(sessionId) {
      await ensureSchema()
      const { rows } = await db.query(
        `SELECT slug FROM pages
         WHERE checkout_session = $1 AND paid_at IS NOT NULL AND taken_down_at IS NULL
         LIMIT 1`,
        [sessionId],
      )
      return rows[0]?.slug ?? null
    },

    async getPhoto(slug, position) {
      await ensureSchema()
      const { rows } = await db.query('SELECT mime, bytes FROM photos WHERE slug = $1 AND position = $2', [
        slug,
        position,
      ])
      return rows[0] ?? null
    },

    // The first `limit` photos of a page, in order, in one query (for the keepsake).
    // A taken-down page has none: its photos are deleted with the takedown.
    async getPhotos(slug, limit) {
      await ensureSchema()
      const { rows } = await db.query(
        'SELECT mime, bytes FROM photos WHERE slug = $1 ORDER BY position LIMIT $2',
        [slug, limit],
      )
      return rows
    },

    // +1 on today's (UTC) counter for an event, in one atomic upsert. Both values come
    // from allowlists, so the table stays at a handful of rows per day.
    async countEvent(event, occasion = '') {
      if (!EVENTS.includes(event)) throw new Error('unknown analytics event')
      if (occasion !== '' && !Object.hasOwn(OCCASIONS, occasion)) throw new Error('unknown occasion')
      await ensureSchema()
      await db.query(
        `INSERT INTO daily_counts (day, event, occasion, count)
         VALUES ((now() AT TIME ZONE 'UTC')::date, $1, $2, 1)
         ON CONFLICT (day, event, occasion) DO UPDATE SET count = daily_counts.count + 1`,
        [event, occasion],
      )
    },

    // The demand-test funnel over the last `days` UTC days, per occasion:
    // landing views -> make clicks (counters) -> pages made -> paid -> removed (pages).
    // Counters or pages without a known occasion go into an "other" row, shown only if non-zero.
    async funnel({ days = 30 } = {}) {
      await ensureSchema()
      const window = Math.max(1, Math.floor(days))
      const counters = await db.query(
        `SELECT event, occasion, sum(count)::int AS n FROM daily_counts
         WHERE day >= ${SINCE_UTC_DAY} GROUP BY event, occasion`,
        [window],
      )
      const pages = await db.query(
        `SELECT coalesce(occasion, content #>> '{answers,occasion}') AS occasion,
                count(*)::int AS made, count(paid_at)::int AS paid, count(taken_down_at)::int AS removed
         FROM pages WHERE created_at >= (${SINCE_UTC_DAY})::timestamp AT TIME ZONE 'UTC'
         GROUP BY 1`,
        [window],
      )
      const since = await db.query(`SELECT to_char(${SINCE_UTC_DAY}, 'YYYY-MM-DD') AS since`, [window])

      const byOccasion = new Map(Object.keys(OCCASIONS).map((o) => [o, { occasion: o, ...ZERO }]))
      const rowFor = (occasion) => {
        const key = Object.hasOwn(OCCASIONS, occasion ?? '') ? occasion : 'other'
        if (!byOccasion.has(key)) byOccasion.set(key, { occasion: key, ...ZERO })
        return byOccasion.get(key)
      }
      let creditClicks = 0
      for (const { event, occasion, n } of counters.rows) {
        if (event === 'credit_click') creditClicks += n
        else if (COUNTER_FIELDS[event]) rowFor(occasion)[COUNTER_FIELDS[event]] += n
      }
      for (const { occasion, made, paid, removed } of pages.rows) {
        const row = rowFor(occasion)
        row.pagesMade += made
        row.pagesPaid += paid
        row.pagesRemoved += removed
      }
      const rows = [...byOccasion.values()]
      const totals = { ...ZERO }
      for (const row of rows) for (const field of Object.keys(ZERO)) totals[field] += row[field]
      return { days: window, since: since.rows[0].since, rows, totals, creditClicks }
    },

    // Atomically tombstones the page (content cleared, row kept so takedowns can be
    // counted and a paid page's checkout session can be refunded) and deletes its
    // photos. Returns false if it was already gone.
    async takeDown(slug) {
      await ensureSchema()
      const { rows } = await db.query(
        `WITH page AS (
           UPDATE pages SET taken_down_at = now(), content = NULL
           WHERE slug = $1 AND taken_down_at IS NULL
           RETURNING slug
         ), gone AS (
           DELETE FROM photos WHERE slug IN (SELECT slug FROM page)
         )
         SELECT count(*)::int AS removed FROM page`,
        [slug],
      )
      return rows[0].removed === 1
    },
  }
}
