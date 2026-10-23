// HTML for every page. Hono's `html` tag escapes every interpolated value, so user
// and model text can only ever render as text; `raw` is used for our own CSS only.
import { createHash } from 'node:crypto'
import { html, raw } from 'hono/html'
import { OCCASIONS, RELATIONSHIPS, TONES, THEMES, DEFAULT_THEME, LIMITS } from './answers.js'
import { PRICE } from './payments.js'
import { SHARE_IMAGE } from './share-image.js'

// Contact is through the repository's issues (public: the pages say not to post links there).
export const ISSUES_URL = 'https://github.com/smithdavedesign/giftlet/issues'
// The one-line pitch, used for the JSON-LD description.
const PITCH = 'A personal gift website in two minutes: five answers and a few photos become a private one-page site with funny copy and made-up stats.'
// The price and refund line, as REVENUE.md sets them (shown in footers and the terms).
const PRICE_LINE = `${PRICE.label} once per page · refund on request within 7 days`
// `site` is per request: the canonical origin for absolute URLs, and whether the RepoHQ
// beacon is on (production only). Direct callers (tests) get relative URLs and no beacon.
const NO_SITE = { origin: '', beacon: false }

// One stylesheet for every page, inlined so a gift page is self-contained. The CSP
// allows exactly this stylesheet by hash, so injected <style> or style="" can't run.
const CSS = `
:root { --ink: #2b1d3a; --muted: #6b5b7b; --paper: #fffaf3; --accent: #e8457c; --sun: #ffc94a; --sky: #5ec8e5; --card: #ffffff; }
* { box-sizing: border-box; }
body { margin: 0; font: 17px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, system-ui, sans-serif; color: var(--ink); background: var(--paper); }
main { max-width: 760px; margin: 0 auto; padding: 24px 18px 64px; }
h1, h2 { line-height: 1.2; }
a { color: var(--accent); }
.confetti, .theme-confetti .hero { background-image: radial-gradient(var(--sun) 2px, transparent 3px), radial-gradient(var(--sky) 2px, transparent 3px), radial-gradient(var(--accent) 1.5px, transparent 2.5px); background-size: 90px 90px, 130px 130px, 70px 70px; background-position: 0 0, 40px 60px, 20px 30px; }
.theme-blush { --ink: #3b2330; --muted: #80606e; --paper: #fff5f6; --accent: #c0396b; --sun: #ffd9e2; --sky: #f6b3c6; }
.theme-blush .hero { background: radial-gradient(circle at 12% 30%, var(--sun) 0 64px, transparent 65px), radial-gradient(circle at 88% 70%, var(--sky) 0 46px, transparent 47px), radial-gradient(circle at 62% 12%, var(--sun) 0 26px, transparent 27px); border-radius: 28px; }
.theme-blush h1, .theme-blush h2, .theme-blush .signoff { font-family: Georgia, "Times New Roman", serif; font-style: italic; }
.theme-blush .photos figure { transform: none; border-radius: 18px; }
.theme-blush .photos img { border-radius: 12px; }
.theme-postcard { --ink: #2f2a24; --muted: #6f6253; --paper: #f5eedf; --accent: #b5502d; --sun: #e9c46a; --sky: #2a6f97; --card: #fffdf7; }
.theme-postcard .hero { background: var(--card); border: 8px solid transparent; border-image: repeating-linear-gradient(135deg, var(--accent) 0 14px, var(--card) 14px 28px, var(--sky) 28px 42px, var(--card) 42px 56px) 8; }
.theme-postcard h1, .theme-postcard h2, .theme-postcard .signoff { font-family: ui-serif, Georgia, "Times New Roman", serif; }
.theme-postcard .memory, .theme-postcard .stats { border-radius: 4px; border-left: 4px solid var(--sky); }
.hero { text-align: center; padding: 40px 12px 24px; }
.hero .occasion { text-transform: uppercase; letter-spacing: .14em; font-size: 13px; color: var(--muted); margin: 0; }
.hero h1 { font-size: clamp(32px, 7vw, 54px); margin: 8px 0; }
.hero .for { font-size: 20px; margin: 0 0 12px; }
.hero .intro { color: var(--muted); max-width: 560px; margin: 0 auto; }
.photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin: 24px 0; }
.photos figure { margin: 0; background: var(--card); padding: 8px 8px 10px; border-radius: 6px; box-shadow: 0 6px 18px rgba(43, 29, 58, .12); }
.photos figure:nth-child(odd) { transform: rotate(-1.2deg); }
.photos figure:nth-child(even) { transform: rotate(1deg); }
.photos img { display: block; width: 100%; height: 220px; object-fit: cover; border-radius: 3px; }
.memory, .stats, .panel { background: var(--card); border-radius: 14px; padding: 18px 20px; margin: 16px 0; box-shadow: 0 2px 10px rgba(43, 29, 58, .08); }
.memory h2 { font-size: 20px; margin: 0 0 6px; color: var(--accent); }
.memory p { margin: 0; white-space: pre-line; }
.stats h2 { font-size: 22px; margin: 0; }
.stats-note { color: var(--muted); font-size: 14px; margin: 4px 0 12px; }
.stats ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
.stat { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; align-items: baseline; }
.stat-value { font-size: 28px; font-weight: 800; color: var(--accent); grid-row: span 2; min-width: 3ch; }
.joke-tag { justify-self: start; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; background: var(--sun); border-radius: 999px; padding: 1px 8px; }
.signoff { text-align: center; font-size: 22px; font-weight: 700; margin: 32px 0; }
.page-footer { text-align: center; font-size: 13px; color: var(--muted); margin-top: 48px; }
label, legend { display: block; font-weight: 650; margin: 0 0 6px; }
.field { margin: 0 0 22px; }
.hint { font-weight: 400; color: var(--muted); font-size: 14px; }
input[type=text], select, textarea { width: 100%; font: inherit; padding: 10px 12px; border: 1.5px solid #d9cfe3; border-radius: 10px; background: #fff; }
textarea { min-height: 72px; margin-bottom: 8px; }
fieldset { border: 0; padding: 0; margin: 0 0 22px; }
.choices label { display: inline-block; font-weight: 400; margin-right: 16px; }
button { font: inherit; font-weight: 700; color: #fff; background: var(--accent); border: 0; border-radius: 999px; padding: 14px 28px; cursor: pointer; }
button[disabled] { opacity: .6; cursor: progress; }
.rules { font-size: 14px; color: var(--muted); }
.error { color: #b3122f; font-weight: 600; }
.watermark { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; pointer-events: none; z-index: 10; }
.watermark span { font-size: clamp(72px, 20vw, 200px); font-weight: 900; letter-spacing: .12em; text-transform: uppercase; color: rgba(43, 29, 58, .12); transform: rotate(-28deg); white-space: nowrap; }
.unlock { text-align: center; border: 2px dashed var(--accent); }
.unlock h2 { margin: 0 0 6px; }
.unlock p { margin: 0 0 12px; }
.notice { background: var(--sun); border-radius: 12px; padding: 10px 14px; font-weight: 600; }
.keepsake { text-align: center; }
.credit { margin: 0 0 8px; }
.cta { display: inline-block; font-weight: 700; color: #fff; background: var(--accent); border-radius: 999px; padding: 14px 28px; text-decoration: none; }
.center { text-align: center; }
.steps ol { margin: 0; padding-left: 22px; display: grid; gap: 8px; }
.px { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.page-footer p { margin: 4px 0; }
.legal-links { margin-top: 10px; }
.buy { font-size: 18px; }
.legal h1 { margin: 8px 0 4px; }
.legal h2 { font-size: 20px; margin: 28px 0 6px; }
.legal ul { padding-left: 22px; }
.legal li { margin: 6px 0; }
`
export const STYLE_HASH = `'sha256-${createHash('sha256').update(CSS).digest('base64')}'`

// schema.org data for search engines: the product and its one price.
function structuredData(origin) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'giftlet',
    description: PITCH,
    url: `${origin}/`,
    image: `${origin}${SHARE_IMAGE.path}`,
    applicationCategory: 'LifestyleApplication',
    operatingSystem: 'Any (web browser)',
    offers: {
      '@type': 'Offer',
      price: (PRICE.cents / 100).toFixed(2),
      priceCurrency: PRICE.currency.toUpperCase(),
      description: `${PRICE.label} once per gift page, after a free preview. No subscription.`,
      url: `${origin}/`,
    },
  }
}

// A public page's search and sharing tags: canonical URL, Open Graph and Twitter cards
// (with the drawn 1200×630 image) and JSON-LD. `<` is escaped so the JSON can't end the script.
function seoHead({ title, description, path, origin }) {
  const url = `${origin}${path}`
  const image = `${origin}${SHARE_IMAGE.path}`
  const jsonLd = JSON.stringify(structuredData(origin)).replace(/</g, '\\u003c')
  return html`<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="giftlet">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${image}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${SHARE_IMAGE.width}">
<meta property="og:image:height" content="${SHARE_IMAGE.height}">
<meta property="og:image:alt" content="${SHARE_IMAGE.alt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${image}">
<meta name="twitter:image:alt" content="${SHARE_IMAGE.alt}">
<script type="application/ld+json">${raw(jsonLd)}</script>`
}

// `path` marks a public, indexable page: it gets the full search and sharing block.
// `signal` loads the RepoHQ beacon when the site has it on: 'public' also counts a
// visit; 'private' (unpaid gift pages) only counts clicks on the Buy button.
// `refresh` is a meta refresh ("seconds; url=…"), used while a payment is confirmed.
function layout({ title, description, path, site = NO_SITE, signal = null, noindex = false, refresh = null, script, bodyClass, body }) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${noindex ? html`<meta name="robots" content="noindex, nofollow">` : ''}
${refresh ? html`<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${title}</title>
${description ? html`<meta name="description" content="${description}">` : ''}
${path ? seoHead({ title, description, path, origin: site.origin }) : ''}
<style>${raw(CSS)}</style>
</head>
<body${bodyClass ? html` class="${bodyClass}"` : ''}>
${body}
${script ? html`<script src="${script}" defer></script>` : ''}
${site.beacon && signal ? html`<script src="/beacon.js" data-page="${signal}" defer></script>` : ''}
</body>
</html>`
}

const legalLinks = () =>
  html`<p class="legal-links"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="${ISSUES_URL}">Contact</a></p>`

const options = (map, selected) =>
  Object.entries(map).map(([value, label]) =>
    value === selected ? html`<option value="${value}" selected>${label}</option>` : html`<option value="${value}">${label}</option>`,
  )

// The 1×1 image that counts a view (see analytics.js). Only allowlisted values reach it.
const pixel = (event, occasion) => html`<img class="px" src="/c/${event}${occasion ? `/${occasion}` : ''}" alt="" width="1" height="1">`

// What a visit to the form counts as, from its ?from= (and ?occasion=) query.
function formPixel(from, occasion) {
  if (from === 'landing') return pixel('make_click', occasion)
  if (from === 'credit') return pixel('credit_click')
  return ''
}

// `occasion` and `from` come from the query string: unknown values are ignored.
export function formPage({ occasion, from, site } = {}) {
  const preselected = Object.hasOwn(OCCASIONS, occasion ?? '') ? occasion : null
  const memoryFields = Array.from(
    { length: LIMITS.memoriesMax },
    (_, i) => html`<textarea name="memory" maxlength="${LIMITS.memoryMax}" aria-label="Memory ${i + 1}"
      ${i < LIMITS.memoriesMin ? 'required' : ''}
      placeholder="${i === 0 ? 'The road trip where we got lost and found the best taco stand…' : i < LIMITS.memoriesMin ? '' : 'Optional'}"></textarea>`,
  )
  const tones = Object.entries(TONES).map(
    ([value, label], i) =>
      html`<label><input type="radio" name="tone" value="${value}" ${i === 0 ? 'checked' : ''}> ${label}</label>`,
  )
  const themes = Object.entries(THEMES).map(
    ([value, label]) =>
      html`<label><input type="radio" name="theme" value="${value}" ${value === DEFAULT_THEME ? 'checked' : ''}> ${label}</label>`,
  )
  return layout({
    title: 'giftlet: make a gift page in two minutes',
    description: `Answer five questions, add ${LIMITS.photosMin}–${LIMITS.photosMax} photos and get a private one-page gift website with funny copy and made-up stats. Free preview, ${PRICE.label} once.`,
    path: '/',
    site,
    signal: 'public',
    script: '/form.js',
    body: html`<main class="maker">
<header class="hero confetti">
  <h1>Make a gift page</h1>
  <p class="intro">Answer five questions, add ${LIMITS.photosMin}–${LIMITS.photosMax} photos, and get a private one-page website with funny copy and made-up statistics.</p>
</header>
<form id="gift-form" method="post" action="/generate" enctype="multipart/form-data" class="panel">
  <div class="field">
    <label for="name">1. Their first name</label>
    <input type="text" id="name" name="name" required maxlength="${LIMITS.nameMax}" autocomplete="off">
  </div>
  <div class="field">
    <label for="occasion">2. The occasion</label>
    <select id="occasion" name="occasion" required>${options(OCCASIONS, preselected)}</select>
  </div>
  <div class="field">
    <label for="relationship">3. Who are they to you?</label>
    <select id="relationship" name="relationship" required>${options(RELATIONSHIPS)}</select>
  </div>
  <fieldset>
    <legend>4. ${LIMITS.memoriesMin} to ${LIMITS.memoriesMax} specific memories <span class="hint">(the more specific, the better the page)</span></legend>
    ${memoryFields}
  </fieldset>
  <fieldset class="choices">
    <legend>5. Tone</legend>
    ${tones}
  </fieldset>
  <fieldset class="choices">
    <legend>Pick a look</legend>
    ${themes}
  </fieldset>
  <div class="field">
    <label for="photos">Photos <span class="hint">(${LIMITS.photosMin} to ${LIMITS.photosMax}; we shrink them before upload)</span></label>
    <input type="file" id="photos" name="photo" accept="image/*" multiple required data-min="${LIMITS.photosMin}" data-max="${LIMITS.photosMax}">
  </div>
  <p class="rules">Celebrations only: no pages about exes and no roasts of people who didn't sign up for one. Your page gets a private link that search engines don't index, and anyone with the link can remove it. You see a free preview first and pay ${PRICE.label} only to unlock it.</p>
  <button type="submit">Make my page</button>
  <p id="status" role="status" aria-live="polite"></p>
  <noscript><p class="error">giftlet needs JavaScript to shrink your photos before uploading them.</p></noscript>
</form>
<footer class="page-footer">
  <p>Ideas: ${Object.entries(LANDING_PAGES).map(([key, landing], i) => html`${i ? ' · ' : ''}<a href="${landing.path}">${OCCASIONS[key]}</a>`)}</p>
  <p>${PRICE_LINE}</p>
  ${legalLinks()}
</footer>
${formPixel(from, preselected)}
</main>`,
  })
}

// One landing page per occasion, for posts in communities and search. Each links into
// the form with its occasion preselected; `keyword` is the word its title must carry.
export const LANDING_PAGES = {
  birthday: {
    path: '/birthday',
    keyword: 'birthday',
    title: 'A birthday website for someone you love, made in two minutes | giftlet',
    description: `Five answers and a few photos become a private birthday page with funny copy and made-up stats. Free preview, ${PRICE.label} to unlock.`,
    headline: 'Give them a birthday website, not another card',
    cta: 'Make a birthday page',
    stats: [
      { value: '100%', label: 'of birthday people prefer a page about themselves (sample size: one)' },
      { value: '2', label: 'minutes to make one, give or take a photo hunt' },
      { value: '0', label: 'design skills required' },
    ],
  },
  anniversary: {
    path: '/anniversary',
    keyword: 'anniversary',
    title: 'An anniversary website for your person, made in two minutes | giftlet',
    description: `Your memories and photos become a private anniversary page, sweet or funny, with made-up stats about the two of you. Free preview, ${PRICE.label} to unlock.`,
    headline: 'Your story so far, as a little anniversary website',
    cta: 'Make an anniversary page',
    stats: [
      { value: '1', label: 'remote control, shared with remarkable grace' },
      { value: '∞', label: 'inside jokes nobody else understands' },
      { value: '3', label: 'minutes of reading, years of "remember when"' },
    ],
  },
  farewell: {
    path: '/retirement',
    keyword: 'retirement',
    title: 'A retirement or farewell page for a coworker, made in two minutes | giftlet',
    description: `Send off a coworker, boss or friend with a private page of memories, photos and made-up stats. Free preview, ${PRICE.label} to unlock, printable keepsake.`,
    headline: 'A send-off page they will actually keep',
    cta: 'Make a send-off page',
    stats: [
      { value: '847', label: 'meetings that are about to get noticeably less fun' },
      { value: '12', label: 'years of "quick questions", answered with a smile' },
      { value: '0', label: 'replacements as good (we checked)' },
    ],
  },
}

export function landingPage(occasion, site) {
  const landing = LANDING_PAGES[occasion]
  const formLink = `/?occasion=${occasion}&from=landing`
  const others = Object.entries(LANDING_PAGES).filter(([key]) => key !== occasion)
  return layout({
    title: landing.title,
    description: landing.description,
    path: landing.path,
    site,
    signal: 'public',
    body: html`<main class="landing">
<header class="hero confetti">
  <p class="occasion">${OCCASIONS[occasion]} gift idea</p>
  <h1>${landing.headline}</h1>
  <p class="intro">${landing.description}</p>
  <p><a class="cta" href="${formLink}">${landing.cta}</a></p>
  <p class="hint">Free preview · ${PRICE.label} to unlock · about two minutes</p>
</header>
<section class="panel steps">
  <h2>How it works</h2>
  <ol>
    <li><strong>Answer five questions:</strong> their name, who they are to you, ${LIMITS.memoriesMin} to ${LIMITS.memoriesMax} specific memories and a tone.</li>
    <li><strong>Add ${LIMITS.photosMin} to ${LIMITS.photosMax} photos.</strong> They are shrunk on your phone before upload.</li>
    <li><strong>Preview it free, then unlock it for ${PRICE.label}:</strong> no watermark, a private link to send, and a printable keepsake PDF.</li>
  </ol>
</section>
<section class="stats">
  <h2>Totally made-up statistics</h2>
  <p class="stats-note">Every page gets a few. Every number is a joke, not real data.</p>
  <ul>
    ${landing.stats.map((s) => html`<li class="stat"><span class="stat-value">${s.value}</span> <span class="stat-label">${s.label}</span> <span class="joke-tag">Joke stat</span></li>`)}
  </ul>
</section>
<section class="panel">
  <h2>Private by default</h2>
  <p>The page lives at an unguessable link that search engines don't index, and anyone with the link can remove it. Celebrations only: no exes, no roasts.</p>
</section>
<p class="center"><a class="cta" href="${formLink}">${landing.cta}</a></p>
<footer class="page-footer">
  <p>Other occasions: ${others.map(([key, other], i) => html`${i ? ' · ' : ''}<a href="${other.path}">${OCCASIONS[key]}</a>`)}</p>
  <p>Made with giftlet. <a href="/">Start a page from scratch</a></p>
  <p>${PRICE_LINE}</p>
  ${legalLinks()}
</footer>
${pixel('landing_view', occasion)}
</main>`,
  })
}

// The note shown when the buyer comes back from Stripe (?checkout=success). The
// webhook may land a moment after the redirect, so an unpaid page says "confirming".
// It spells out the clean link: the address bar still has ?checkout=success, which
// would show this note to the recipient too.
function checkoutNotice({ paid, name, base, origin }) {
  return paid
    ? html`<p class="notice" role="status">Thank you! The page is unlocked. Send ${name} this link: <a href="${base}">${origin}${base}</a></p>`
    : html`<p class="notice" role="status">Thanks! We're confirming your payment with Stripe. Refresh this page in a few seconds to see it unlocked.</p>`
}

// The Buy button ("Unlock for $9"). `checkout` is how this deployment takes payment for
// the page: { href } opens the Stripe Payment Link, { action } posts to our Checkout
// Session route, and null (payments off) shows no button at all.
function buyButton(checkout) {
  if (checkout?.href) {
    return html`<p><a class="cta buy" href="${checkout.href}" data-signal="checkout">Unlock for ${PRICE.label}</a></p>`
  }
  if (checkout?.action) {
    return html`<form method="post" action="${checkout.action}"><button type="submit" data-signal="checkout">Unlock for ${PRICE.label}</button></form>`
  }
  return null
}

const PAYMENTS_OFF = html`<p class="notice">Payments aren't switched on yet. Your preview is saved at this link: come back to unlock it.</p>`

// Until it is paid, a page is a preview: watermarked, with the unlock button on top.
function unlockPanel({ name, checkout }) {
  const button = buyButton(checkout)
  return html`<section class="unlock panel">
  <h2>This is a preview</h2>
  <p>Unlock it for ${PRICE.label} to remove the watermark and add a printable keepsake, then send the link to ${name}.</p>
  ${button ?? PAYMENTS_OFF}
  <p class="hint">${button ? html`Secure checkout by Stripe. ${PRICE_LINE} (<a href="/terms">terms</a>). ` : ''}Not quite right? Make a new page before you pay.</p>
</section>`
}

export function giftPage({ slug, theme, answers, copy, photoCount, paid = false, fromCheckout = false, origin = '', checkout = null, site }) {
  const base = `/p/${slug}`
  const photos = Array.from({ length: photoCount }, (_, i) => i + 1)
  const look = Object.hasOwn(THEMES, theme ?? '') ? theme : DEFAULT_THEME
  return layout({
    title: copy.headline,
    noindex: true,
    site,
    signal: paid || !checkout ? null : 'private', // only to count clicks on the Buy button
    bodyClass: `theme-${look}`,
    body: html`${paid ? '' : html`<div class="watermark" aria-hidden="true"><span>Preview</span></div>`}
<main class="gift">
${fromCheckout ? checkoutNotice({ paid, name: answers.name, base, origin }) : ''}
${paid ? '' : unlockPanel({ name: answers.name, checkout })}
<header class="hero">
  <p class="occasion">${OCCASIONS[answers.occasion]}</p>
  <h1>${copy.headline}</h1>
  <p class="for">For <strong class="recipient">${answers.name}</strong></p>
  <p class="intro">${copy.intro}</p>
</header>
<section class="photos" aria-label="Photos">
  ${photos.map((n) => html`<figure><img src="${base}/photo/${n}" alt="Photo ${n} of ${answers.name}" loading="lazy"></figure>`)}
</section>
${copy.sections.map((s) => html`<article class="memory"><h2>${s.title}</h2><p>${s.body}</p></article>`)}
<section class="stats">
  <h2>Totally made-up statistics</h2>
  <p class="stats-note">Every number here is a joke, not real data.</p>
  <ul>
    ${copy.stats.map((s) => html`<li class="stat"><span class="stat-value">${s.value}</span> <span class="stat-label">${s.label}</span> <span class="joke-tag">Joke stat</span></li>`)}
  </ul>
</section>
<p class="signoff">${copy.signoff}</p>
${paid ? html`<p class="keepsake"><a href="${base}/print" rel="nofollow">Printable keepsake</a></p>` : ''}
<footer class="page-footer">
  <p class="credit">Made with giftlet. <a href="/?from=credit">Make one for someone →</a></p>
  <a href="${base}/takedown" rel="nofollow">Remove this page</a>
  ${legalLinks()}
</footer>
</main>`,
  })
}

// Shown by POST /p/<slug>/checkout when Stripe isn't configured (503) or fails (502).
export function checkoutProblemPage({ slug, configured }) {
  return layout({
    title: 'Checkout unavailable',
    noindex: true,
    body: html`<main><section class="panel">
<h1>${configured ? "We couldn't start checkout." : "Payments aren't switched on yet."}</h1>
<p>${configured ? 'Stripe did not answer as expected. Nothing was charged. Please try again in a minute.' : 'Your preview is saved. Please come back and unlock it a little later.'}</p>
<p><a href="/p/${slug}">Back to the page</a></p>
</section></main>`,
  })
}

// GET /p/<slug>/print on an unpaid page (402): the keepsake comes with unlocking.
export function keepsakeLockedPage({ slug, checkout = null, site }) {
  const base = `/p/${slug}`
  return layout({
    title: 'Unlock the keepsake',
    noindex: true,
    site,
    signal: checkout ? 'private' : null,
    body: html`<main><section class="unlock panel">
<h1>The keepsake comes with the unlocked page</h1>
<p>Unlock this page for ${PRICE.label} to get its printable keepsake (a two-page PDF) and remove the preview watermark.</p>
${buyButton(checkout) ?? PAYMENTS_OFF}
<p><a href="${base}">Back to the preview</a></p>
</section></main>`,
  })
}

// GET /paid: where the Stripe Payment Link sends the buyer back, since a payment link
// can't return to the page it paid for. `refreshUrl` reloads until the webhook has
// unlocked the page (then /paid redirects to it); null means stop waiting.
export function paidReturnPage({ refreshUrl = null } = {}) {
  return layout({
    title: 'Thank you',
    noindex: true,
    refresh: refreshUrl ? `3; url=${refreshUrl}` : null,
    body: html`<main><section class="panel">
<h1>Thank you!</h1>
${refreshUrl
    ? html`<p>We're waiting for Stripe to confirm your payment. This page takes you back to your gift page as soon as it's unlocked, usually within a few seconds.</p>`
    : html`<p>Stripe hasn't confirmed a payment to us yet. Your page unlocks as soon as it does: open your gift page's link again in a minute.</p>
<p>Still a preview after an hour? Open an issue at <a href="${ISSUES_URL}">GitHub</a> with the date and amount of your payment (not your page's link), and we'll unlock it or refund you.</p>`}
</section>
<footer class="page-footer">${legalLinks()}</footer>
</main>`,
  })
}

export function takedownPage({ slug, name }) {
  return layout({
    title: 'Remove this page?',
    noindex: true,
    body: html`<main>
<section class="panel">
  <h1>Remove the page for ${name}?</h1>
  <p>This deletes the page and its photos for everyone who has the link. It can't be undone.</p>
  <form method="post" action="/p/${slug}/takedown">
    <button type="submit">Remove this page permanently</button>
  </form>
  <p><a href="/p/${slug}">Keep the page</a></p>
</section>
</main>`,
  })
}

export function removedPage() {
  return layout({
    title: 'Page removed',
    noindex: true,
    body: html`<main><section class="panel"><h1>This page has been removed.</h1><p>The page and its photos are deleted. The link no longer works.</p></section></main>`,
  })
}

export function notFoundPage() {
  return layout({
    title: 'Page not found',
    noindex: true,
    body: html`<main><section class="panel"><h1>There's nothing here.</h1><p>This page doesn't exist or has been removed.</p><p><a href="/">Make a gift page</a></p></section></main>`,
  })
}

export function unavailablePage() {
  return layout({
    title: 'Back soon',
    noindex: true,
    body: html`<main><section class="panel"><h1>giftlet is taking a breather.</h1><p>Please try again in a few minutes.</p></section></main>`,
  })
}

// --- Privacy and terms: plain words, and only what the code actually does ---

const POLICY_DATE = '23 October 2026'
const issuesLink = html`<a href="${ISSUES_URL}">github.com/smithdavedesign/giftlet/issues</a>`

function legalPage({ title, description, path, heading, site, body }) {
  return layout({
    title,
    description,
    path,
    site,
    signal: 'public',
    body: html`<main class="legal">
<p><a href="/">giftlet</a></p>
<h1>${heading}</h1>
<p class="hint">Last updated ${POLICY_DATE}</p>
${body}
<footer class="page-footer">
  <p><a href="/">Make a gift page</a></p>
  <p>${PRICE_LINE}</p>
  ${legalLinks()}
</footer>
</main>`,
  })
}

const PRIVACY = {
  path: '/privacy',
  title: 'Privacy: what giftlet stores and sends | giftlet',
  description: 'What giftlet stores, what it sends to Google, Stripe and RepoHQ, the three usage events it counts, and how to remove a page. No cookies, no ads.',
}

export function privacyPage(site) {
  return legalPage({
    ...PRIVACY,
    heading: 'Privacy',
    site,
    body: html`<p>giftlet turns your answers and photos into a private one-page gift website. This page says what that involves.</p>

<h2>What giftlet stores</h2>
<ul>
  <li><strong>What you put in a page:</strong> the recipient's first name, the occasion, who they are to you, your memories, the tone and look you picked, and your photos. Your browser shrinks the photos and saves them again as JPEG before upload, which also strips hidden details such as where a photo was taken.</li>
  <li><strong>The words written for the page</strong>, and when it was made.</li>
  <li><strong>Payment state:</strong> whether the page is unlocked, when, and Stripe's ID for that checkout, so a refund can be found.</li>
</ul>
<p>It is kept in giftlet's database until someone uses the page's "Remove this page" link, which deletes the words and photos at once. What remains of a removed page is its random ID, its occasion and its dates (for the counts) and, if it was paid, its payment record (for refunds). Unpaid previews aren't deleted automatically yet: remove one with its link.</p>
<p>giftlet has no accounts and never asks for your name, email address or phone number.</p>

<h2>Who can see a page</h2>
<p>Anyone with its link. The link is long and random, it isn't listed anywhere, and search engines are told not to index it. Anyone with the link can also remove the page.</p>

<h2>Who else handles data</h2>
<ul>
  <li><strong>Google (Gemini)</strong> writes the page's words. It receives the name, occasion, relationship, tone and memories, never the photos. giftlet uses Gemini's free tier, whose terms let Google use that text to improve its products, which can include people at Google reading it. So don't write anything in a memory you wouldn't want a stranger to read.</li>
  <li><strong>Stripe</strong> takes the payment on its own checkout page. giftlet never sees your card. Stripe receives the page's random ID, so the payment unlocks the right page, and nothing about the recipient.</li>
  <li><strong>Vercel</strong> hosts the site and <strong>Neon</strong> hosts the database. Like any web host, Vercel handles your IP address and browser details to serve each page and may keep them in short-lived logs.</li>
</ul>

<h2>Usage counts</h2>
<p>To find out whether giftlet is worth keeping, it counts a few things. None of them records who you are.</p>
<ul>
  <li><strong>Daily counters in giftlet's database:</strong> landing-page views, clicks from a landing page into the form, and clicks on "Make one for someone" on a gift page. Only numbers per day: no IP address, no cookie, no browser details.</li>
  <li><strong>A usage beacon to RepoHQ</strong> (repohq.vercel.app), the tool giftlet's maker uses to see which of their products get used. It sends three events:
    <ul>
      <li><code>visit</code>: you opened one of the public pages (once per browser session);</li>
      <li><code>activate</code>: you made your first gift page in this browser (once per browser);</li>
      <li><code>checkout</code>: you clicked the button to pay.</li>
    </ul>
    Each event carries only the product name ("giftlet"), the event's name and, if another website sent you here, that website's address. Never your gift page, its link or anything in it, and no cookie. To avoid counting you twice, your browser keeps a small marker in its session storage (<code>repohq:visit</code>) and local storage (<code>repohq:activate</code>). Nothing is sent by automated browsers or from test copies of the site.</li>
</ul>

<h2>Cookies</h2>
<p>None. giftlet sets no cookies and shows no ads. Stripe's checkout page is Stripe's own site and has its own cookies.</p>

<h2>Photos of other people</h2>
<p>Only upload photos you have the right to share, and think twice about photos of children. If a page shows you and you want it gone, anyone with its link can remove it. If you don't have the link, open an issue (below) without any personal details, and we'll find and remove the page.</p>

<h2>Contact</h2>
<p>Questions, refunds and removal requests: open an issue at ${issuesLink}. Issues are public, so don't post your page's link or anyone's personal details there.</p>`,
  })
}

const TERMS = {
  path: '/terms',
  title: 'Terms: $9 once, refunds within 7 days | giftlet',
  description: 'giftlet terms in plain words: free preview, $9 once per page, refund on request within 7 days, celebrations only, and no warranty.',
}

export function termsPage(site) {
  return legalPage({
    ...TERMS,
    heading: 'Terms',
    site,
    body: html`<p>By making a page with giftlet you agree to these terms. They are short on purpose.</p>

<h2>What you pay for</h2>
<p>Making and previewing a page is free. Unlocking a page costs <strong>${PRICE.label}, once</strong>, per page: no subscription, nothing recurring. Unlocking removes the "Preview" watermark and adds a printable keepsake (a PDF). Stripe handles the payment.</p>

<h2>Refunds</h2>
<p><strong>Refund on request within 7 days</strong> of paying, no reason needed. Open an issue (see Contact) with the date and amount of your payment, not your page's link. The money goes back to the card you paid with, through Stripe.</p>

<h2>Your page</h2>
<ul>
  <li>Your page lives at a private link. Anyone you give the link to can see it, and anyone with the link can remove it for good.</li>
  <li>The words are written by an AI model, or from a template, using your answers. They can be wrong, odd or not what you meant, so read the free preview before you pay.</li>
  <li>The statistics on every page are jokes, and the page says so.</li>
</ul>

<h2>Celebrations only</h2>
<p>Make pages that celebrate someone. No pages about exes, no roasts of people who didn't sign up for one, nothing hateful, sexual or harassing, and only photos you have the right to use. We may remove pages that break these rules.</p>

<h2>No warranty</h2>
<p>giftlet is provided "as is", without warranty of any kind. We try to keep it working and your page online, but we can't promise that it always will be. As far as the law allows, our liability for anything to do with giftlet is limited to what you paid for the page concerned.</p>

<h2>Changes</h2>
<p>If these terms change, this page changes, with a new date at the top. The terms that applied when you paid still apply to that page.</p>

<h2>Contact</h2>
<p>Open an issue at ${issuesLink}. Issues are public, so don't post your page's link or anyone's personal details there.</p>`,
  })
}

// --- Search engines ---

// Every public, indexable page; the sitemap lists exactly these.
export const PUBLIC_PATHS = ['/', ...Object.values(LANDING_PAGES).map((landing) => landing.path), PRIVACY.path, TERMS.path]

// Gift pages (/p/…) stay crawlable on purpose: crawlers must fetch them to see their noindex.
export function robotsTxt(origin) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`
}

const xmlText = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function sitemapXml(origin) {
  const urls = PUBLIC_PATHS.map((path) => `  <url><loc>${xmlText(`${origin}${path}`)}</loc></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}
