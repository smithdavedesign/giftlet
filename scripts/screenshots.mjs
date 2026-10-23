// `npm run screenshots`: proof that giftlet works, as PNGs in docs/screenshots/.
// Starts the dev server on a free port with a throwaway in-memory database and template
// copy (no DATABASE_URL, GOOGLE_API_KEY or real Stripe value reaches it), then drives
// Chromium from CHROMIUM_PATH (never downloaded) through the buyer's path:
//   occasion landing page -> form (birthday preselected) -> preview with the Buy button
//   -> paid through the payment link -> back via /paid -> the unlocked page
// STRIPE_PAYMENT_LINK is a placeholder (example.com), so the Buy button shows; it is never
// clicked. Payment is a webhook signed with a random secret made for this run, exactly as
// Stripe would sign it for a payment-link session. Sample data only: a made-up recipient
// and drawn "photos". At most 6 PNGs, each named for what it shows.
import { spawn } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium, devices } from 'playwright-core'

const OUT = 'docs/screenshots'
const DESKTOP = { viewport: { width: 1280, height: 800 } }
const PHONE = devices['iPhone 13']
const PLACEHOLDER_PAYMENT_LINK = 'https://example.com/pay'

const MEMORIES = [
  'The road trip where we got lost outside Flagstaff and found the best taco stand in Arizona.',
  'You taught me to make pancakes at 2am the night before my chemistry final.',
  'Karaoke night: you sang every single part of Bohemian Rhapsody, including the guitar solo.',
  'You showed up with soup and terrible jokes when I had the flu, and stayed for the whole movie marathon.',
]

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function waitUntilUp(base, server) {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error('the dev server exited')
    try {
      if ((await fetch(`${base}/`)).ok) return
    } catch {
      // not listening yet
    }
    await sleep(250)
  }
  throw new Error('the dev server did not answer within 30 s')
}

// Illustrations drawn on a canvas in the browser, saved as JPEG: stand-ins for photos.
async function drawPhotos(browser) {
  const page = await browser.newPage()
  const scenes = await page.evaluate(() => {
    const W = 1200
    const H = 900
    const make = (paint) => {
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const g = canvas.getContext('2d')
      paint(g)
      return canvas.toDataURL('image/jpeg', 0.85)
    }
    const sky = (g, top, bottom) => {
      const grad = g.createLinearGradient(0, 0, 0, H)
      grad.addColorStop(0, top)
      grad.addColorStop(1, bottom)
      g.fillStyle = grad
      g.fillRect(0, 0, W, H)
    }
    const circle = (g, x, y, r, color) => {
      g.fillStyle = color
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
    }
    return [
      // A birthday cake with candles.
      make((g) => {
        sky(g, '#ffe3ec', '#ffd36e')
        for (let i = 0; i < 40; i++) circle(g, (i * 137) % W, (i * 89) % 380, 8, ['#e8457c', '#5ec8e5', '#ffffff'][i % 3])
        g.fillStyle = '#8a4b2a'
        g.fillRect(330, 470, 540, 260)
        g.fillStyle = '#ffffff'
        g.fillRect(330, 450, 540, 60)
        g.fillStyle = '#e8457c'
        g.fillRect(330, 590, 540, 30)
        for (let i = 0; i < 6; i++) {
          g.fillStyle = '#5ec8e5'
          g.fillRect(380 + i * 85, 360, 22, 95)
          circle(g, 391 + i * 85, 340, 16, '#ffb300')
        }
        g.fillStyle = '#d9cfe3'
        g.fillRect(280, 730, 640, 26)
      }),
      // Sunset on the beach.
      make((g) => {
        sky(g, '#ff9a8b', '#ffd3a5')
        circle(g, 600, 520, 150, '#fff2b2')
        g.fillStyle = '#2a6f97'
        g.fillRect(0, 540, W, 200)
        g.fillStyle = '#f2d39b'
        g.fillRect(0, 740, W, 160)
        for (let i = 0; i < 6; i++) {
          g.fillStyle = 'rgba(255,255,255,0.55)'
          g.fillRect(380 + i * 30, 570 + i * 25, 440 - i * 60, 6)
        }
      }),
      // A karaoke microphone and music notes.
      make((g) => {
        sky(g, '#2b1d3a', '#6b2d6b')
        for (let i = 0; i < 60; i++) circle(g, (i * 211) % W, (i * 97) % H, 3, 'rgba(255,255,255,0.6)')
        circle(g, 600, 330, 120, '#cfd8dc')
        g.fillStyle = '#37474f'
        g.fillRect(565, 440, 70, 330)
        g.fillStyle = '#ffc94a'
        g.font = 'bold 160px sans-serif'
        g.fillText('♪', 210, 380)
        g.fillText('♫', 860, 560)
      }),
      // The road trip: a road into the mountains.
      make((g) => {
        sky(g, '#7ec8e3', '#fef6e4')
        g.fillStyle = '#b5502d'
        g.beginPath()
        g.moveTo(0, 620)
        g.lineTo(300, 260)
        g.lineTo(560, 620)
        g.lineTo(820, 300)
        g.lineTo(W, 620)
        g.closePath()
        g.fill()
        g.fillStyle = '#e9c46a'
        g.fillRect(0, 620, W, 280)
        g.fillStyle = '#3d3d3d'
        g.beginPath()
        g.moveTo(520, 900)
        g.lineTo(590, 620)
        g.lineTo(610, 620)
        g.lineTo(680, 900)
        g.closePath()
        g.fill()
        circle(g, 980, 150, 70, '#fff2b2')
      }),
    ]
  })
  await page.close()
  return scenes.map((url, i) => ({
    name: ['cake', 'beach', 'karaoke', 'road-trip'][i] + '.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(url.split(',')[1], 'base64'),
  }))
}

// What Stripe sends after a paid payment-link checkout (the page's slug comes back as
// client_reference_id), signed the way Stripe documents. Returns the session id.
async function payFor(base, slug, secret) {
  const sessionId = `cs_test_${randomBytes(12).toString('hex')}`
  const event = {
    id: `evt_${randomBytes(8).toString('hex')}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        client_reference_id: slug,
        payment_link: `plink_${randomBytes(8).toString('hex')}`,
        metadata: {},
        amount_total: 900,
        currency: 'usd',
        payment_status: 'paid',
        status: 'complete',
      },
    },
  }
  const raw = JSON.stringify(event)
  const t = Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')
  const res = await fetch(`${base}/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${v1}` }, body: raw })
  if (res.status !== 200) throw new Error(`webhook answered ${res.status}`)
  return sessionId
}

async function shot(page, name) {
  const path = `${OUT}/${name}.png`
  await page.screenshot({ path })
  console.log(`saved ${path}`)
}

async function toBottom(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await sleep(300)
}

// The Buy button must be there and point at the payment link for this very page.
async function checkBuyButton(page, slug) {
  const href = await page.locator('a.buy[data-signal="checkout"]').getAttribute('href')
  if (href !== `${PLACEHOLDER_PAYMENT_LINK}?client_reference_id=${slug}`) throw new Error(`unexpected Buy link: ${href}`)
}

// Shows the keepsake PDF in Chromium's own viewer and screenshots it.
async function shootKeepsake(context, url, name) {
  const page = await context.newPage()
  await page.goto(url)
  await sleep(2500) // the viewer renders after load
  await shot(page, name)
  await page.close()
}

async function main() {
  const executablePath = process.env.CHROMIUM_PATH
  if (!executablePath) throw new Error('set CHROMIUM_PATH to a Chromium binary (it is never downloaded)')
  mkdirSync(OUT, { recursive: true })

  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const webhookSecret = randomBytes(24).toString('hex') // made for this run, never stored
  const env = { ...process.env, PORT: String(port), GIFTLET_PGLITE: 'memory://', STRIPE_WEBHOOK_SECRET: webhookSecret }
  for (const key of ['DATABASE_URL', 'GOOGLE_API_KEY', 'GEMINI_MODEL', 'STRIPE_SECRET_KEY', 'SITE_URL', 'VERCEL_ENV']) delete env[key]
  env.STRIPE_PAYMENT_LINK = PLACEHOLDER_PAYMENT_LINK
  const server = spawn(process.execPath, ['scripts/dev.js'], { env, stdio: ['ignore', 'ignore', 'inherit'] })

  let browser
  try {
    await waitUntilUp(base, server)
    browser = await chromium.launch({ executablePath })
    const photos = await drawPhotos(browser)

    // Desktop: the whole path, from the landing page to a paid page.
    const desktop = await browser.newContext(DESKTOP)
    const page = await desktop.newPage()
    await page.goto(`${base}/birthday`)
    await shot(page, 'landing-desktop')

    await page.click('a.cta')
    await page.waitForURL(/occasion=birthday/)
    await page.fill('#name', 'Maya')
    await page.selectOption('#relationship', 'friend')
    for (const [i, memory] of MEMORIES.entries()) await page.locator('textarea[name="memory"]').nth(i).fill(memory)
    await page.check('input[name="tone"][value="funny"]')
    await page.check('input[name="theme"][value="confetti"]')
    await page.setInputFiles('#photos', photos)
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/p\/[A-Za-z0-9_-]{22}$/, { timeout: 60_000 })
    const pageUrl = page.url()
    const slug = pageUrl.split('/p/')[1]
    // The page just made, still a preview: watermark and the Buy button.
    await page.waitForLoadState('networkidle')
    await checkBuyButton(page, slug)
    await shot(page, 'gift-desktop')

    // Phone: the landing page's footer, and the same preview.
    const phone = await browser.newContext(PHONE)
    const mobile = await phone.newPage()
    await mobile.goto(`${base}/birthday`)
    await toBottom(mobile)
    await shot(mobile, 'landing-mobile')
    await mobile.goto(pageUrl)
    await mobile.waitForLoadState('networkidle')
    await checkBuyButton(mobile, slug)
    await shot(mobile, 'gift-mobile')

    // Paid through the payment link; Stripe then sends the buyer to /paid, which finds the
    // page. Unlocked: no watermark, no Buy button, and the keepsake link.
    const sessionId = await payFor(base, slug, webhookSecret)
    await page.goto(`${base}/paid?session_id=${sessionId}`)
    await page.waitForURL(`${pageUrl}?checkout=success`)
    await page.waitForLoadState('networkidle')
    for (const [selector, expected] of [['a.buy', 0], ['.watermark', 0], [`a[href="/p/${slug}/print"]`, 1]]) {
      if ((await page.locator(selector).count()) !== expected) throw new Error(`paid page: expected ${expected} × ${selector}`)
    }
    await shootKeepsake(desktop, `${pageUrl}/print`, 'keepsake-desktop')
    await desktop.close()
    await shootKeepsake(phone, `${pageUrl}/print`, 'keepsake-mobile')
    await phone.close()
  } finally {
    await browser?.close()
    server.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error(`screenshots failed: ${err.message}`)
  process.exitCode = 1
})
