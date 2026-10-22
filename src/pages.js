// HTML for every page. Hono's `html` tag escapes every interpolated value, so user
// and model text can only ever render as text; `raw` is used for our own CSS only.
import { createHash } from 'node:crypto'
import { html, raw } from 'hono/html'
import { OCCASIONS, RELATIONSHIPS, TONES, THEMES, DEFAULT_THEME, LIMITS } from './answers.js'
import { PRICE } from './payments.js'

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
`
export const STYLE_HASH = `'sha256-${createHash('sha256').update(CSS).digest('base64')}'`

// `description` adds the search snippet and the og: tags that chat apps and social
// sites show when the link is shared (the landing pages are meant to be posted).
function layout({ title, description, noindex = false, script, bodyClass, body }) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${noindex ? html`<meta name="robots" content="noindex, nofollow">` : ''}
<title>${title}</title>
${description
    ? html`<meta name="description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">`
    : ''}
<style>${raw(CSS)}</style>
</head>
<body${bodyClass ? html` class="${bodyClass}"` : ''}>
${body}
${script ? html`<script src="${script}" defer></script>` : ''}
</body>
</html>`
}

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
export function formPage({ occasion, from } = {}) {
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

export function landingPage(occasion) {
  const landing = LANDING_PAGES[occasion]
  const formLink = `/?occasion=${occasion}&from=landing`
  const others = Object.entries(LANDING_PAGES).filter(([key]) => key !== occasion)
  return layout({
    title: landing.title,
    description: landing.description,
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

// Until it is paid, a page is a preview: watermarked, with the unlock button on top.
function unlockPanel({ base, name }) {
  return html`<section class="unlock panel">
  <h2>This is a preview</h2>
  <p>Unlock it for ${PRICE.label} to remove the watermark and add a printable keepsake, then send the link to ${name}.</p>
  <form method="post" action="${base}/checkout"><button type="submit">Unlock for ${PRICE.label}</button></form>
  <p class="hint">Secure checkout by Stripe. Not quite right? Make a new page before you pay.</p>
</section>`
}

export function giftPage({ slug, theme, answers, copy, photoCount, paid = false, fromCheckout = false, origin = '' }) {
  const base = `/p/${slug}`
  const photos = Array.from({ length: photoCount }, (_, i) => i + 1)
  const look = Object.hasOwn(THEMES, theme ?? '') ? theme : DEFAULT_THEME
  return layout({
    title: copy.headline,
    noindex: true,
    bodyClass: `theme-${look}`,
    body: html`${paid ? '' : html`<div class="watermark" aria-hidden="true"><span>Preview</span></div>`}
<main class="gift">
${fromCheckout ? checkoutNotice({ paid, name: answers.name, base, origin }) : ''}
${paid ? '' : unlockPanel({ base, name: answers.name })}
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
export function keepsakeLockedPage({ slug }) {
  const base = `/p/${slug}`
  return layout({
    title: 'Unlock the keepsake',
    noindex: true,
    body: html`<main><section class="unlock panel">
<h1>The keepsake comes with the unlocked page</h1>
<p>Unlock this page for ${PRICE.label} to get its printable keepsake (a two-page PDF) and remove the preview watermark.</p>
<form method="post" action="${base}/checkout"><button type="submit">Unlock for ${PRICE.label}</button></form>
<p><a href="${base}">Back to the preview</a></p>
</section></main>`,
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
