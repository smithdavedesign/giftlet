// `npm run funnel` end to end: the real script against a fresh local PGlite database.
import { describe, test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/funnel.js', import.meta.url))
// A scratch directory inside the repo's gitignored .data/, removed afterwards.
const CWD = fileURLToPath(new URL(`../.data/funnel-test-${randomBytes(4).toString('hex')}/`, import.meta.url))

// DATABASE_URL is blanked so the script can never reach a real database from a test.
const run = (...args) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd: CWD, env: { ...process.env, DATABASE_URL: '' }, encoding: 'utf8', timeout: 60_000 })

describe('npm run funnel', () => {
  mkdirSync(CWD, { recursive: true })
  after(() => rmSync(CWD, { recursive: true, force: true }))

  test('prints the funnel table for an empty database', () => {
    const res = run('7')
    assert.equal(res.status, 0, res.stderr)
    assert.match(res.stdout, /giftlet funnel: last 7 days \(since \d{4}-\d{2}-\d{2}, UTC\)/)
    assert.match(res.stdout, /birthday\s+0\s+0\s+–\s+0\s+0\s+–\s+0/)
    assert.match(res.stdout, /"Make one" credit clicks: 0 \(– per paid page\)/)
  })

  test('refuses a bad day count with a usage line', () => {
    for (const bad of ['0', 'abc', '400']) {
      const res = run(bad)
      assert.equal(res.status, 2, bad)
      assert.match(res.stderr, /usage: npm run funnel/)
    }
  })
})
