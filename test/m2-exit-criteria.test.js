// M2 exit criteria from ROADMAP.md, one describe block per criterion.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { THEMES, DEFAULT_THEME } from '../src/answers.js'
import { templateCopy } from '../src/copy.js'
import { giftPage } from '../src/pages.js'
import {
  MEMORIES,
  OTHER_SECRET,
  WEBHOOK_SECRET,
  checkoutEvent,
  generatePage,
  hasWatermark,
  keepsakeHref,
  makeTestApp,
  postGift,
  postWebhook,
  statItems,
  stripeSignature,
} from './helpers.js'

async function pageHtml(app, slug) {
  const res = await app.request(`/p/${slug}`)
  assert.equal(res.status, 200)
  return res.text()
}

// `buy: false` when payments can't unlock anything (no webhook secret): then the page
// must not offer the unlock button at all, and says payments are off instead.
function assertLocked(html, slug, { buy = true } = {}) {
  assert.ok(hasWatermark(html), 'unpaid page shows the watermark')
  if (buy) assert.ok(html.includes(`action="/p/${slug}/checkout"`), 'unpaid page offers the unlock button')
  else {
    assert.ok(!html.includes('/checkout"') && !html.includes('data-signal="checkout"'), 'no unlock button')
    assert.match(html, /Payments aren't switched on yet/)
  }
  assert.ok(!html.includes(keepsakeHref(slug)), 'unpaid page has no keepsake link')
  assert.doesNotMatch(html, /keepsake<\/a>/i)
}

function assertUnlocked(html, slug) {
  assert.ok(!hasWatermark(html), 'paid page has no watermark')
  assert.ok(!html.includes(`action="/p/${slug}/checkout"`), 'paid page has no unlock button')
  assert.ok(html.includes(keepsakeHref(slug)), 'paid page links to the keepsake')
}

describe('M2-EC1: an unpaid page shows a watermark and no keepsake link; after a signed checkout.session.completed webhook it does not', () => {
  test('a new page is an unpaid preview: watermark, unlock button, no keepsake link', async () => {
    const { app } = await makeTestApp()
    const { slug, html } = await generatePage(app)
    assertLocked(html, slug)
    assert.match(html, /Unlock for \$9/)
  })

  test('a signed checkout.session.completed webhook unlocks the page', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    const res = await postWebhook(app, checkoutEvent({ slug }))
    assert.equal(res.status, 200)
    assertUnlocked(await pageHtml(app, slug), slug)
  })

  test('the page stays unlocked when Stripe redelivers the same event', async () => {
    const { app } = await makeTestApp()
    const { slug } = await generatePage(app)
    const event = checkoutEvent({ slug })
    assert.equal((await postWebhook(app, event)).status, 200)
    assert.equal((await postWebhook(app, event)).status, 200)
    assertUnlocked(await pageHtml(app, slug), slug)
  })

  test('only the paid page is unlocked; other pages stay previews', async () => {
    const { app } = await makeTestApp()
    const paid = await generatePage(app)
    const other = await generatePage(app)
    await postWebhook(app, checkoutEvent({ slug: paid.slug }))
    assertUnlocked(await pageHtml(app, paid.slug), paid.slug)
    assertLocked(await pageHtml(app, other.slug), other.slug)
  })
})

describe('M2-EC2: a webhook with a bad signature leaves the page locked', () => {
  const now = () => Math.floor(Date.now() / 1000)
  const badDeliveries = [
    ['signed with a different secret', (raw) => ({ signature: stripeSignature(raw, { secret: OTHER_SECRET }) })],
    ['no Stripe-Signature header', () => ({ signature: null })],
    ['an empty Stripe-Signature header', () => ({ signature: '' })],
    ['a malformed header', () => ({ signature: 'garbage' })],
    ['a v1 value that is not hex', () => ({ signature: `t=${now()},v1=${'z'.repeat(64)}` })],
    [
      'only a v0 (test-scheme) signature',
      (raw) => ({ signature: stripeSignature(raw).replace('v1=', 'v0=') }),
    ],
    ['a signature from 6 minutes ago (replay)', (raw) => ({ signature: stripeSignature(raw, { timestamp: now() - 360 }) })],
    ['a timestamp 6 minutes in the future', (raw) => ({ signature: stripeSignature(raw, { timestamp: now() + 360 }) })],
    [
      'a timestamp edited after signing',
      (raw) => {
        const t = now() - 10
        return { signature: stripeSignature(raw, { timestamp: t }).replace(`t=${t}`, `t=${t + 5}`) }
      },
    ],
  ]

  for (const [label, delivery] of badDeliveries) {
    test(`${label}: 400, page still locked`, async () => {
      const { app } = await makeTestApp()
      const { slug } = await generatePage(app)
      const raw = JSON.stringify(checkoutEvent({ slug }))
      const res = await postWebhook(app, null, { body: raw, ...delivery(raw) })
      assert.equal(res.status, 400)
      assertLocked(await pageHtml(app, slug), slug)
    })
  }

  test('a body changed after signing (another page swapped in): 400, both pages still locked', async () => {
    const { app } = await makeTestApp()
    const signedFor = await generatePage(app)
    const victim = await generatePage(app)
    const signedRaw = JSON.stringify(checkoutEvent({ slug: signedFor.slug }))
    const tamperedRaw = signedRaw.replace(signedFor.slug, victim.slug)
    const res = await postWebhook(app, null, { body: tamperedRaw, signature: stripeSignature(signedRaw) })
    assert.equal(res.status, 400)
    assertLocked(await pageHtml(app, victim.slug), victim.slug)
    assertLocked(await pageHtml(app, signedFor.slug), signedFor.slug)
  })

  test('with no webhook secret configured, every webhook is refused and the page stays locked', async () => {
    const { app } = await makeTestApp({ stripeWebhookSecret: '' })
    const { slug } = await generatePage(app)
    const res = await postWebhook(app, checkoutEvent({ slug }), { secret: WEBHOOK_SECRET })
    assert.equal(res.status, 503)
    // Go-live: no Buy button either, since a payment could never unlock the page.
    assertLocked(await pageHtml(app, slug), slug, { buy: false })
  })
})

describe('M2-EC3: each theme renders the same input without error', () => {
  const answers = { name: 'Maya', occasion: 'birthday', relationship: 'friend', tone: 'funny', memories: MEMORIES }
  const content = { v: 1, answers, copy: templateCopy(answers), photoCount: 3 }
  const slug = 'AAAAAAAAAAAAAAAAAAAAAA'

  test('there are three themes, Confetti first and the default', () => {
    assert.deepEqual(Object.keys(THEMES), ['confetti', 'blush', 'postcard'])
    assert.equal(DEFAULT_THEME, 'confetti')
  })

  for (const theme of Object.keys(THEMES)) {
    for (const paid of [false, true]) {
      test(`${theme} renders the same content (${paid ? 'paid' : 'unpaid'})`, () => {
        const html = String(giftPage({ slug, ...content, theme, paid }))
        assert.match(html, new RegExp(`<body class="theme-${theme}">`))
        assert.ok(html.includes(`.theme-${theme}`), `the stylesheet has rules for ${theme}`)
        assert.ok(html.includes('Maya'))
        assert.equal([...html.matchAll(/<img[^>]*\ssrc="\/p\/[^"]+\/photo\/\d+"/g)].length, 3)
        assert.ok(statItems(html).length >= 3)
        assert.ok(html.includes(`href="/p/${slug}/takedown"`))
        assert.equal(hasWatermark(html), !paid)
        assert.equal(html.includes(keepsakeHref(slug)), paid)
      })
    }
  }

  test('an unknown stored theme falls back to the default instead of failing', () => {
    const html = String(giftPage({ slug, ...content, theme: 'toString', paid: false }))
    assert.match(html, /<body class="theme-confetti">/)
  })

  test('POST /generate with each theme makes a page that serves 200 in that theme', async () => {
    const { app } = await makeTestApp()
    for (const theme of Object.keys(THEMES)) {
      const { page, html } = await generatePage(app, { theme })
      assert.equal(page.status, 200, theme)
      assert.match(html, new RegExp(`<body class="theme-${theme}">`))
    }
  })

  test('a form without a theme gets the default theme', async () => {
    const { app } = await makeTestApp()
    const { html } = await generatePage(app)
    assert.match(html, new RegExp(`<body class="theme-${DEFAULT_THEME}">`))
  })

  test('an unknown theme is rejected with 400 and nothing is made', async () => {
    const { app, db, store } = await makeTestApp()
    await store.ensureSchema()
    for (const theme of ['neon', '', 'toString']) {
      const res = await postGift(app, { theme })
      assert.equal(res.status, 400, JSON.stringify(theme))
      assert.equal((await res.json()).field, 'theme')
    }
    assert.equal((await db.query('SELECT count(*)::int AS n FROM pages')).rows[0].n, 0)
  })

  test('the form offers every theme, with the default preselected', async () => {
    const { app } = await makeTestApp()
    const html = await (await app.request('/')).text()
    for (const theme of Object.keys(THEMES)) {
      assert.match(html, new RegExp(`<input type="radio" name="theme" value="${theme}"`))
    }
    assert.match(html, new RegExp(`name="theme" value="${DEFAULT_THEME}" checked`))
  })
})
