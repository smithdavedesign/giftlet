// The Postgres store, run against PGlite (real Postgres compiled to WASM, in-process).
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { createStore, poolDb } from '../src/store.js'
import { GIF_1PX, PNG_1PX } from './helpers.js'

const SLUG = 'abcdefghijklmnopqrstuv'
const CONTENT = { v: 1, theme: 'confetti', answers: { name: 'Maya' }, copy: { headline: 'Hi' }, photoCount: 2 }
const PHOTOS = [
  { mime: 'image/png', bytes: PNG_1PX },
  { mime: 'image/gif', bytes: GIF_1PX },
]

async function freshStore() {
  const db = new PGlite()
  return { db, store: createStore(db) }
}

async function count(db, table) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table}`)
  return rows[0].n
}

describe('store', () => {
  test('ensureSchema is idempotent and runs once per store', async () => {
    const { db, store } = await freshStore()
    await store.ensureSchema()
    await store.ensureSchema()
    await createStore(db).ensureSchema() // a second cold start against the same database
    assert.equal(await count(db, 'pages'), 0)
  })

  test('createPage stores content and photos; getPage and getPhoto read them back', async () => {
    const { store } = await freshStore()
    await store.createPage({ slug: SLUG, content: CONTENT, photos: PHOTOS })
    assert.deepEqual(await store.getPage(SLUG), CONTENT)
    const first = await store.getPhoto(SLUG, 1)
    assert.equal(first.mime, 'image/png')
    assert.deepEqual(Buffer.from(first.bytes), PNG_1PX)
    const second = await store.getPhoto(SLUG, 2)
    assert.equal(second.mime, 'image/gif')
    assert.deepEqual(Buffer.from(second.bytes), GIF_1PX)
    assert.equal(await store.getPhoto(SLUG, 3), null)
  })

  test('unknown slugs read as null', async () => {
    const { store } = await freshStore()
    assert.equal(await store.getPage('nope-nope-nope'), null)
    assert.equal(await store.getPhoto('nope-nope-nope', 1), null)
  })

  test('createPage with a duplicate slug fails without adding photos', async () => {
    const { db, store } = await freshStore()
    await store.createPage({ slug: SLUG, content: CONTENT, photos: PHOTOS })
    await assert.rejects(store.createPage({ slug: SLUG, content: CONTENT, photos: PHOTOS }))
    assert.equal(await count(db, 'pages'), 1)
    assert.equal(await count(db, 'photos'), 2)
  })

  test('createPage refuses a page with no photos', async () => {
    const { store } = await freshStore()
    await assert.rejects(store.createPage({ slug: SLUG, content: CONTENT, photos: [] }), /photo/)
  })

  test('takeDown deletes the photos, clears the content, keeps a tombstone, and is idempotent', async () => {
    const { db, store } = await freshStore()
    await store.createPage({ slug: SLUG, content: CONTENT, photos: PHOTOS })
    await store.createPage({ slug: 'another-slug-0000000', content: CONTENT, photos: PHOTOS })

    assert.equal(await store.takeDown(SLUG), true)
    assert.equal(await store.getPage(SLUG), null)
    assert.equal(await store.getPhoto(SLUG, 1), null)

    const { rows } = await db.query('SELECT content, taken_down_at FROM pages WHERE slug = $1', [SLUG])
    assert.equal(rows[0].content, null)
    assert.ok(rows[0].taken_down_at instanceof Date)
    assert.equal(await count(db, 'photos'), 2, 'only the other page’s photos remain')

    assert.equal(await store.takeDown(SLUG), false)
    assert.deepEqual(await store.getPage('another-slug-0000000'), CONTENT)
  })

  test('takeDown of an unknown slug returns false', async () => {
    const { store } = await freshStore()
    assert.equal(await store.takeDown('nope-nope-nope'), false)
  })
})

describe('store: payment state (M2)', () => {
  const SESSION = ['cs', 'test', 'a1B2c3D4'.repeat(4)].join('_')

  test('getGift returns the content and paidAt (null until paid); unknown slugs are null', async () => {
    const { store } = await freshStore()
    await store.createPage({ slug: SLUG, content: CONTENT, photos: PHOTOS })
    assert.deepEqual(await store.getGift(SLUG), { content: CONTENT, paidAt: null })
    assert.equal(await store.getGift('nope-nope-nope'), null)
  })

  test('markPaid unlocks once and records the Checkout Session; a repeat is a no-op', async () => {
    const { db, store } = await freshStore()
    await store.createPage({ slug: SLUG, content: CONTENT, photos: PHOTOS })
    assert.equal(await store.markPaid(SLUG, SESSION), true)
    const first = await store.getGift(SLUG)
    assert.ok(first.paidAt instanceof Date)
    assert.deepEqual(first.content, CONTENT)

    assert.equal(await store.markPaid(SLUG, SESSION.replace('a1B2', 'z9Y8')), false)
    const { rows } = await db.query('SELECT paid_at, checkout_session FROM pages WHERE slug = $1', [SLUG])
    assert.equal(rows[0].checkout_session, SESSION, 'the first session is kept')
    assert.equal(rows[0].paid_at.getTime(), first.paidAt.getTime(), 'paid_at is not moved by a redelivery')
  })

  test('markPaid accepts a missing session id', async () => {
    const { store } = await freshStore()
    await store.createPage({ slug: SLUG, content: CONTENT, photos: PHOTOS })
    assert.equal(await store.markPaid(SLUG, null), true)
    assert.ok((await store.getGift(SLUG)).paidAt instanceof Date)
  })

  test('markPaid does not touch unknown or taken-down pages', async () => {
    const { store } = await freshStore()
    assert.equal(await store.markPaid('nope-nope-nope', SESSION), false)
    await store.createPage({ slug: SLUG, content: CONTENT, photos: PHOTOS })
    await store.takeDown(SLUG)
    assert.equal(await store.markPaid(SLUG, SESSION), false)
    assert.equal(await store.getGift(SLUG), null)
  })

  test('findPaidSlug finds the live page a session paid for, and nothing else', async () => {
    const { store } = await freshStore()
    assert.equal(await store.findPaidSlug(SESSION), null, 'empty database')
    await store.createPage({ slug: SLUG, content: CONTENT, photos: PHOTOS })
    assert.equal(await store.findPaidSlug(SESSION), null, 'not paid yet')
    await store.markPaid(SLUG, SESSION)
    assert.equal(await store.findPaidSlug(SESSION), SLUG)
    assert.equal(await store.findPaidSlug(SESSION.replace('a1B2', 'z9Y8')), null, 'another session')
    await store.takeDown(SLUG)
    assert.equal(await store.findPaidSlug(SESSION), null, 'taken down')
  })

  test('a takedown of a paid page keeps the payment on the tombstone (for refunds)', async () => {
    const { db, store } = await freshStore()
    await store.createPage({ slug: SLUG, content: CONTENT, photos: PHOTOS })
    await store.markPaid(SLUG, SESSION)
    await store.takeDown(SLUG)
    const { rows } = await db.query('SELECT content, paid_at, checkout_session FROM pages WHERE slug = $1', [SLUG])
    assert.equal(rows[0].content, null)
    assert.ok(rows[0].paid_at instanceof Date)
    assert.equal(rows[0].checkout_session, SESSION)
  })

  test('a database created by M1 (no payment columns) is upgraded in place; its pages become unpaid previews', async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE TABLE pages (slug text PRIMARY KEY, content jsonb, created_at timestamptz NOT NULL DEFAULT now(), taken_down_at timestamptz);
      CREATE TABLE photos (slug text NOT NULL REFERENCES pages (slug) ON DELETE CASCADE, position smallint NOT NULL CHECK (position > 0),
        mime text NOT NULL, bytes bytea NOT NULL, PRIMARY KEY (slug, position));`)
    await db.query('INSERT INTO pages (slug, content) VALUES ($1, $2::jsonb)', [SLUG, JSON.stringify(CONTENT)])
    const store = createStore(db)
    assert.deepEqual(await store.getGift(SLUG), { content: CONTENT, paidAt: null })
    assert.equal(await store.markPaid(SLUG, SESSION), true)
    // M3's analytics table and occasion column arrive with the same upgrade.
    await store.countEvent('landing_view', 'birthday')
    assert.equal(await count(db, 'daily_counts'), 1)
    const report = await store.funnel({ days: 30 })
    assert.equal(report.totals.pagesMade, 1)
    assert.equal(report.totals.pagesPaid, 1)
  })
})

describe('store: photos for the keepsake (M3)', () => {
  test('getPhotos returns the first N photos in order, in one query', async () => {
    const { store } = await freshStore()
    const photos = [PHOTOS[0], PHOTOS[1], PHOTOS[0]]
    await store.createPage({ slug: SLUG, content: CONTENT, photos })
    const all = await store.getPhotos(SLUG, 6)
    assert.deepEqual(
      all.map((p) => p.mime),
      ['image/png', 'image/gif', 'image/png'],
    )
    assert.deepEqual(Buffer.from(all[1].bytes), GIF_1PX)
    assert.equal((await store.getPhotos(SLUG, 2)).length, 2)
    assert.deepEqual(await store.getPhotos('nope-nope-nope', 6), [])
  })

  test('getPhotos returns nothing for a taken-down page', async () => {
    const { store } = await freshStore()
    await store.createPage({ slug: SLUG, content: CONTENT, photos: PHOTOS })
    await store.takeDown(SLUG)
    assert.deepEqual(await store.getPhotos(SLUG, 6), [])
  })
})

describe('store: analytics (M3)', () => {
  const page = (slug, occasion) => ({
    slug,
    content: { ...CONTENT, answers: { name: 'Maya', occasion } },
    photos: PHOTOS,
  })

  test('countEvent keeps one row per UTC day, event and occasion, and is atomic under concurrency', async () => {
    const { db, store } = await freshStore()
    await Promise.all(Array.from({ length: 20 }, () => store.countEvent('landing_view', 'birthday')))
    await store.countEvent('credit_click')
    const { rows } = await db.query('SELECT day, event, occasion, count FROM daily_counts ORDER BY event')
    assert.deepEqual(
      rows.map((r) => [r.event, r.occasion, r.count]),
      [
        ['credit_click', '', 1],
        ['landing_view', 'birthday', 20],
      ],
    )
    const today = (await db.query("SELECT (now() AT TIME ZONE 'UTC')::date AS d")).rows[0].d
    assert.equal(rows[0].day.getTime(), today.getTime())
  })

  test('countEvent refuses events and occasions outside the allowlists', async () => {
    const { store } = await freshStore()
    await assert.rejects(store.countEvent('drop table', 'birthday'))
    await assert.rejects(store.countEvent('landing_view', 'valentines'))
  })

  test('funnel: landing views → clicks → pages made → paid → removed, per occasion, plus credit clicks', async () => {
    const { db, store } = await freshStore()
    for (let i = 0; i < 4; i++) await store.countEvent('landing_view', 'birthday')
    await store.countEvent('make_click', 'birthday')
    await store.countEvent('make_click')
    await store.countEvent('credit_click')
    await store.countEvent('credit_click')
    await store.createPage(page('birthday-page-0000001', 'birthday'))
    await store.createPage(page('birthday-page-0000002', 'birthday'))
    await store.createPage(page('farewell-page-0000001', 'farewell'))
    await store.markPaid('birthday-page-0000001', null)
    await store.markPaid('farewell-page-0000001', null)
    await store.takeDown('farewell-page-0000001') // a removed page keeps its occasion

    // Outside the window: an old counter row and an old page.
    await db.query("INSERT INTO daily_counts (day, event, occasion, count) VALUES ((now() AT TIME ZONE 'UTC')::date - 40, 'landing_view', 'birthday', 99)")
    await store.createPage(page('old-birthday-page-00001', 'birthday'))
    await db.query("UPDATE pages SET created_at = now() - interval '40 days' WHERE slug = 'old-birthday-page-00001'")

    const report = await store.funnel({ days: 30 })
    assert.equal(report.days, 30)
    assert.match(report.since, /^\d{4}-\d{2}-\d{2}$/)
    const row = (occasion) => report.rows.find((r) => r.occasion === occasion)
    assert.deepEqual(row('birthday'), { occasion: 'birthday', landingViews: 4, makeClicks: 1, pagesMade: 2, pagesPaid: 1, pagesRemoved: 0 })
    assert.deepEqual(row('anniversary'), { occasion: 'anniversary', landingViews: 0, makeClicks: 0, pagesMade: 0, pagesPaid: 0, pagesRemoved: 0 })
    assert.deepEqual(row('farewell'), { occasion: 'farewell', landingViews: 0, makeClicks: 0, pagesMade: 1, pagesPaid: 1, pagesRemoved: 1 })
    assert.deepEqual(row('other'), { occasion: 'other', landingViews: 0, makeClicks: 1, pagesMade: 0, pagesPaid: 0, pagesRemoved: 0 })
    assert.deepEqual(report.totals, { landingViews: 4, makeClicks: 2, pagesMade: 3, pagesPaid: 2, pagesRemoved: 1 })
    assert.equal(report.creditClicks, 2)
  })

  test('funnel on an empty database is all zeros, one row per occasion', async () => {
    const { store } = await freshStore()
    const report = await store.funnel({ days: 7 })
    assert.deepEqual(
      report.rows.map((r) => r.occasion),
      ['birthday', 'anniversary', 'farewell'],
    )
    assert.deepEqual(report.totals, { landingViews: 0, makeClicks: 0, pagesMade: 0, pagesPaid: 0, pagesRemoved: 0 })
    assert.equal(report.creditClicks, 0)
  })
})

describe('poolDb adapter (node-postgres)', () => {
  test('maps query to parameterized pool.query and exec to a simple multi-statement query', async () => {
    const calls = []
    const pool = { query: async (...args) => (calls.push(args), { rows: [] }) }
    const db = poolDb(pool)
    await db.query('SELECT $1', [1])
    await db.exec('SELECT 1; SELECT 2')
    assert.deepEqual(calls, [['SELECT $1', [1]], ['SELECT 1; SELECT 2']])
  })
})
