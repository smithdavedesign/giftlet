// The Cloudflare Worker (src/worker.js, wrangler.jsonc): the same app, wired from the Worker's env, with
// a database per request (a Worker can't reuse another request's socket) and the schema run once.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import worker, { createWorker } from '../src/worker.js'
import { deployEnv } from '../src/web.js'
import { PHOTOS, giftForm, silentLog } from './helpers.js'

const ORIGIN = 'https://giftlet.1426davejobs.workers.dev'

/** A Worker ExecutionContext that keeps what was handed to waitUntil. */
function context() {
  const waiting = []
  return { waiting, waitUntil: (p) => waiting.push(p), passThroughOnException() {} }
}

describe('deployEnv', () => {
  test("NEXT_PUBLIC_DEPLOY_ENV (the Worker's) wins, else VERCEL_ENV, else nothing", () => {
    assert.equal(deployEnv({ NEXT_PUBLIC_DEPLOY_ENV: 'production', VERCEL_ENV: 'preview' }), 'production')
    assert.equal(deployEnv({ VERCEL_ENV: 'production' }), 'production')
    assert.equal(deployEnv({}), '')
  })
})

describe('the Worker', () => {
  let pglite
  before(async () => {
    pglite = new PGlite()
  })
  after(() => pglite.close())

  /** A Worker over the shared PGlite that counts connections, closes and schema runs. */
  function countingWorker(counts) {
    return createWorker({
      log: silentLog,
      connect: (url) => {
        assert.equal(url, 'placeholder-database')
        counts.connects += 1
        return {
          query: (text, params) => pglite.query(text, params),
          exec: (text) => {
            counts.schema += 1
            return pglite.exec(text)
          },
          close: async () => {
            counts.closes += 1
          },
        }
      },
    })
  }

  test('makes a page and serves it, with a database per request, each one closed, and the schema run once', async () => {
    const counts = { connects: 0, closes: 0, schema: 0 }
    const w = countingWorker(counts)
    const env = { DATABASE_URL: 'placeholder-database', SITE_URL: ORIGIN }
    const call = async (path, init) => {
      const ctx = context()
      const res = await w.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx)
      await Promise.all(ctx.waiting)
      return res
    }
    assert.equal((await call('/')).status, 200)
    const created = await call('/generate', { method: 'POST', body: giftForm({ name: 'Sam' }) })
    assert.equal(created.status, 201)
    const { url } = await created.json()
    const page = await call(url)
    assert.equal(page.status, 200)
    assert.ok((await page.text()).includes('Sam'))
    const photo = await call(`${url}/photo/1`)
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), PHOTOS[0].bytes)
    assert.equal(counts.connects, 4, 'one database per request')
    assert.equal(counts.closes, 4, 'each one closed')
    assert.equal(counts.schema, 1, 'the schema ran once')
  })

  test('canonical URLs come from SITE_URL; NEXT_PUBLIC_DEPLOY_ENV=production loads the beacon, nothing else does', async () => {
    const counts = { connects: 0, closes: 0, schema: 0 }
    const w = countingWorker(counts)
    for (const [extra, beacon] of [[{ NEXT_PUBLIC_DEPLOY_ENV: 'production' }, true], [{}, false]]) {
      const res = await w.fetch(new Request('http://localhost/privacy'), { SITE_URL: ORIGIN, ...extra }, context())
      const html = await res.text()
      assert.equal(/beacon\.js/.test(html), beacon, JSON.stringify(extra))
      assert.ok(html.includes(`<link rel="canonical" href="${ORIGIN}/privacy">`))
    }
    assert.equal(counts.connects, 0, 'no DATABASE_URL, no connection')
  })

  test('the default export is a Worker; without DATABASE_URL data routes answer 503 and the pages still work', async () => {
    assert.equal(typeof worker.fetch, 'function')
    const ctx = context()
    assert.equal((await worker.fetch(new Request(`${ORIGIN}/`), {}, ctx)).status, 200)
    const res = await worker.fetch(new Request(`${ORIGIN}/generate`, { method: 'POST', body: giftForm() }), {}, ctx)
    assert.equal(res.status, 503)
    assert.equal(ctx.waiting.length, 0)
  })
})

describe('wrangler.jsonc', () => {
  // // comments dropped outside strings, so "https://" stays.
  function readJsonc(path) {
    const text = readFileSync(path, 'utf8')
    let out = ''
    let inString = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (inString) {
        out += c
        if (c === '\\') out += text[++i]
        else if (c === '"') inString = false
      } else if (c === '"') {
        inString = true
        out += c
      } else if (c === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i++
        out += '\n'
      } else out += c
    }
    return JSON.parse(out)
  }

  test('names the Worker for the repo, runs src/worker.js with nodejs_compat, keeps toString() clean, and is production', () => {
    const config = readJsonc(new URL('../wrangler.jsonc', import.meta.url))
    assert.equal(config.name, 'giftlet')
    assert.equal(config.main, 'src/worker.js')
    assert.ok(config.compatibility_flags.includes('nodejs_compat'))
    assert.equal(config.keep_names, false, '/form.js and /beacon.js are functions\' source')
    assert.equal(config.build, undefined, 'the credential broker refuses a build command')
    assert.equal(config.vars.SITE_URL, ORIGIN)
    assert.equal(config.vars.NEXT_PUBLIC_DEPLOY_ENV, 'production')
    for (const secret of ['DATABASE_URL', 'GOOGLE_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
      assert.equal(config.vars[secret], undefined, `${secret} is a secret, never a var`)
    }
  })
})
