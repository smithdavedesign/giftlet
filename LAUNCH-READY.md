# giftlet: launch readiness

giftlet is ready for a public launch except for two things only David can do: the Stripe payment link and the webhook secret (see [What's left for David](#whats-left-for-david)). What the product does hasn't changed. Someone answers five questions, gets a free watermarked preview of their gift page, pays $9 once to unlock it, and gets a printable keepsake.

`npm test`: **304 tests, 304 passing, 0 failing** (15 files). All 249 tests from M1–M3 still pass, and 55 are new.

## What I did

Nobody was available to ask, so every decision is written down here (and in code comments).

### 1. Search and sharing

giftlet is a Hono app, not Next.js, so Hono routes and one shared `layout()` in `src/pages.js` replace Next's `metadata`, `robots.ts`, `sitemap.ts` and `opengraph-image`.

- **Public pages:** `/` (the form), `/birthday`, `/anniversary`, `/retirement`, `/privacy` and `/terms` (`PUBLIC_PATHS`). Each gets:
  - a unique `<title>` and meta description (50–160 characters);
  - `<link rel="canonical">`;
  - Open Graph tags (`og:type`, `og:site_name`, `og:url`, `og:title`, `og:description`, and `og:image` with type, 1200×630 size and alt text);
  - Twitter `summary_large_image` tags;
  - JSON-LD: a `SoftwareApplication` with an `Offer` of `9.00 USD`, described as "$9 once per gift page, after a free preview. No subscription."
- **Private pages** (gift pages, takedown, 404, `/paid`) stay `noindex` and get none of this.
- **The share image** `/og.png` is drawn in code (`src/share-image.js`): a confetti background, "giftlet" in a dot-matrix font and "a personal gift website / in two minutes, for $9", encoded as PNG with `node:zlib`. Nothing is copied from the web, and there's no build step or image file. It's drawn on the first request (~130 ms), kept in memory and cached by browsers for a day.
- **`/robots.txt`** allows everything and points at the sitemap. It deliberately doesn't disallow `/p/`: crawlers have to fetch a gift page to see its `noindex`.
- **`/sitemap.xml`** lists exactly the six public pages.
- **Absolute URLs** use, in order: `SITE_URL` if set, then Vercel's `VERCEL_PROJECT_PRODUCTION_URL` (set automatically, also on previews, so previews point canonically at production), then the request's own origin.

### 2. Privacy and terms

- **`/privacy`** says what's stored: the answers, photos, generated words and payment state, kept until the page's "Remove this page" link is used. It also says:
  - who else handles data: Google Gemini (text only, never photos; the free tier lets Google use it), Stripe, Vercel and Neon;
  - the first-party daily counters;
  - **the RepoHQ beacon and its three events** (`visit`, `activate`, `checkout`), what each carries and the two storage markers;
  - **cookies: none**;
  - photos of other people;
  - contact through GitHub issues, with a warning not to post the page's link there because issues are public.
- **`/terms`:**
  - free preview, then **$9 once per page, no subscription**;
  - **refund on request within 7 days** (both from REVENUE.md);
  - celebrations only, AI copy can be wrong (read the preview first), and **no warranty** ("as is", liability capped at what you paid);
  - contact through the issues.
- **Footers:**
  - every public page has the price and refund line and links to Privacy, Terms and Contact;
  - gift pages link Privacy, Terms and Contact too;
  - the Buy panel repeats the refund line with a link to the terms.

### 3. Payment: the Buy button

giftlet sells one thing: a $9 unlock for **one specific page**. So the Buy button is the preview's **"Unlock for $9"** button, also shown on the 402 keepsake page. There's no Buy button on the landing pages, because there is nothing to buy before a page exists.

- **With `STRIPE_PAYMENT_LINK` set,** the button is a link to `<payment link>?client_reference_id=<page id>`. Stripe returns `client_reference_id` in the signed `checkout.session.completed` webhook, and the existing webhook unlocks that page. Page ids are `[A-Za-z0-9_-]{22}`, which is what Stripe accepts there. Nothing is hard-coded: the link is read from the env only, and it must be an `https:` URL or it's ignored with a warning.
- **The button is hidden** unless a payment path is configured *and* `STRIPE_WEBHOOK_SECRET` is set. Without the webhook secret a payment could never unlock its page, so taking money would be worse than showing no button. A startup warning names the missing variable. Without a button the preview says "Payments aren't switched on yet".
  - This changes M2's behaviour on purpose: before, the button showed anyway and led to a 503 page.
  - The Checkout Session route now refuses to start without the webhook secret too.
- **Payment link or secret key:**
  - when `STRIPE_PAYMENT_LINK` is set, it wins;
  - the M2 path (`STRIPE_SECRET_KEY` creating Checkout Sessions) stays as the fallback when there's no payment link.
- **Webhook (`src/payments.js`):** a session made by a payment link carries `metadata.app=giftlet` only if David sets that on the link. So a paid payment-link session also counts when it charged **at least $9 in USD**. That way another product's cheaper link in the same Stripe account can't unlock a page. The signature check is unchanged and is still the security boundary.
- **Back from Stripe:** a payment link can't return to the page it paid for, so there's a new `GET /paid?session_id={CHECKOUT_SESSION_ID}`.
  - When the webhook has unlocked the page, it sends the buyer there with the existing "unlocked, send Maya this link" note.
  - Until then it reloads every 3 s for about a minute, then explains what to do.
  - A malformed id gets a plain thank-you page with no lookup.
  - The page is found by the session id the webhook stores (`store.findPaidSlug`, plus a new index on `pages.checkout_session`).

### 4. The RepoHQ beacon

`src/beacon.js` is served at `/beacon.js` and POSTs `{"slug":"giftlet","kind":…,"referrer":…}` to `https://idea-factory.1426davejobs.workers.dev/api/ideas/signal` with `keepalive: true`, `credentials: 'omit'` and `content-type: application/json`. It's fire-and-forget: errors are swallowed.

- **`visit`:** every public page (loaded with `data-page="public"`), once per browser session (sessionStorage `repohq:visit`).
- **`activate`:** giftlet's core action is **making a gift page**: the form's `POST /generate` succeeded and a preview exists. `form.js` dispatches `giftlet:activate` right before it navigates to the new page. It's sent once per browser (localStorage `repohq:activate`).
- **`checkout`:** every click on the Buy button (`data-signal="checkout"`). Unpaid gift pages and the 402 page load the beacon as `data-page="private"`, so they count only this event, never a visit.
- **Referrer:** `document.referrer` only when its origin differs from `location.origin`, else `null`. giftlet also sends `Referrer-Policy: no-referrer`, so its own pages never pass a gift link along. The payload never contains the page's address.
- **When nothing is sent:**
  - **previews and local runs:** the server only adds the script tag when `VERCEL_ENV === "production"`. A Hono function reads Vercel's `VERCEL_ENV` directly, so there's no `NEXT_PUBLIC_` copy;
  - **bots and screenshot runs:** `navigator.webdriver`;
  - **the owner's browser:** localStorage `repohq:notrack` is set;
  - **blocked storage:** without it the "once" can't be guaranteed, so nothing is sent rather than overcounting.
- **CSP:** `connect-src` now allows `https://idea-factory.1426davejobs.workers.dev` and nothing else new.

### 5. Deployment

`.provision` holds exactly the two lines asked for: `vercel project giftlet` and the payment link `request`. The MVP's `.provision` lines (Neon, Gemini, Vercel env pushes) aren't repeated.

### 6. Tests (55 new)

- **`test/launch.test.js` (31):**
  - every public page renders, with a unique title and description, canonical, OG and Twitter tags, the 1200×630 image and JSON-LD with the $9 Offer;
  - private pages have none of it;
  - footers link Privacy and Terms;
  - robots.txt and the sitemap (which lists exactly the public pages, each answering 200);
  - the share image: a valid PNG with correct CRCs, 1200×630, not blank;
  - the privacy page names the three events, and the terms carry the price and refund line;
  - **the Buy button is hidden without the env var, without the webhook secret, and with a non-https link**;
  - the payment link, its escaping and its priority over the secret key, and that a paid page has no button;
  - payment-link webhooks unlock pages, and cheaper ones don't;
  - `/paid` redirects, waits, gives up, handles bad input, taken-down pages and no database.
- **`test/beacon.test.js` (17):** the real browser script run in a fake browser (`node:vm`, fetch recorded, no network):
  - the payload and its options;
  - the referrer rule;
  - visit once per session, activate once per browser, checkout per click;
  - silence under webdriver, `repohq:notrack`, blocked storage or a failing network;
  - which pages load it (production only, public vs private);
  - the CSP;
  - that `form.js` fires `activate` only after a successful `/generate`.
- **`test/payments.test.js`** (+5), **`test/store.test.js`** (+1), **`test/entry.test.js`** (+1: the new routes work from the production entry without a database, and no beacon runs outside production).
- **Changed M2 test:** "with no webhook secret configured…" now also asserts there is **no** Buy button, and that the page says payments are off. That is the deliberate change described in section 3.
- **Changed test helper:** `makeTestApp` now configures a fake Checkout Session by default, like production with payments on. Tests that need payments off pass `createCheckout: null`, as the M2 test for that case already did.

### 7. Screenshots

`npm run screenshots` (scripts/screenshots.mjs, `playwright-core`, Chromium from `CHROMIUM_PATH`, never downloaded):
- starts `scripts/dev.js` on a free port with an in-memory database and the placeholder `STRIPE_PAYMENT_LINK=https://example.com/pay`;
- fills the form for a made-up "Maya" with drawn pictures;
- checks that the Buy link is exactly `https://example.com/pay?client_reference_id=<page>` (it never clicks it);
- pays with a correctly signed payment-link webhook, then follows `/paid` back to the unlocked page;
- checks there's no watermark, no Buy button and a keepsake link.

The six PNGs are in README.md under "Screenshots". I opened and checked every one.

- **File names:** this sandbox can't delete files, so the run reuses the six existing names (`landing-*`, `gift-*`, `keepsake-*`) instead of adding new ones next to stale ones. Each shows what its name says: the `gift-*` shots are the gift page made from the form (the preview with the Buy button), and the `keepsake-*` shots are the PDF the paid page links to.
- **The paid gift page itself** isn't among the six; the script checks it instead.

## How to check it

```bash
npm ci
npm test                                   # 304 passing; no network, no browser, no real secrets
CHROMIUM_PATH=/path/to/chromium npm run screenshots
npm run dev                                # then open:
#   http://localhost:3000/privacy, /terms, /robots.txt, /sitemap.xml, /og.png
#   view-source on / or /birthday: canonical, og:*, twitter:*, application/ld+json
```

After deploying:
- Paste a landing URL into a link-preview checker (opengraph.xyz, or a Slack/Discord message) to see the card and image.
- Run Google's Rich Results Test on `/` for the SoftwareApplication with its Offer, and submit `https://<domain>/sitemap.xml` in Google Search Console.
- **Beacon:** on the production domain, open DevTools → Network, filter "signal" and load `/birthday`. You should see one `visit` POST, then none on the next page in the same tab. Make a page to see one `activate`. Click "Unlock for $9" to see `checkout`. Then run `localStorage.setItem('repohq:notrack', '1')` in your own browser so your visits stop counting.
- **Buy:** with Stripe in test mode, make a page, click "Unlock for $9" and pay with `4242 4242 4242 4242`. You should land on `/paid` and then on your page, unlocked.

## What's left for David

1. **Create the Stripe Payment Link** (the `request` in `.provision`). Start in **test mode**.
   - Product "giftlet: personal gift page", **$9 USD, one-time**.
   - After payment: choose "Don't show confirmation page" and redirect to `https://<your domain>/paid?session_id={CHECKOUT_SESSION_ID}`, typed exactly like that.
   - Optional: add metadata `app` = `giftlet` on the link. It's copied to every session and makes the webhook's match exact.
   - Paste the link URL into the `giftlet` Vercel project's env as **`STRIPE_PAYMENT_LINK`** (Production).
2. **Add the webhook, or the button stays hidden.**
   - In Stripe, add an endpoint at `https://<your domain>/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
   - Put its signing secret into Vercel as **`STRIPE_WEBHOOK_SECRET`**, then redeploy.
   - Use the final domain with no redirect in front of it; Stripe treats a 3xx as a failed delivery.
3. **Test the whole loop** in test mode: pay, get unlocked, then refund. After that, switch the link and the webhook to live mode, and do one real $9 charge and refund (REVENUE.md, "Before charging anyone").
4. **Hosting (still open from M2):** Vercel Hobby doesn't allow commercial use, so taking live payments there breaks its terms. Choose Vercel Pro or another host before going live (BUILD.md, "What's left").
5. **A custom domain** if you want one: add it in Vercel. Canonical URLs follow `VERCEL_PROJECT_PRODUCTION_URL` automatically; set `SITE_URL` to pin a specific one. Then update the Stripe webhook URL and the payment link's redirect to the new domain.
6. **RepoHQ:** the beacon sends `content-type: application/json`, so browsers send a CORS preflight first. `https://idea-factory.1426davejobs.workers.dev/api/ideas/signal` must answer it for the production origin. I couldn't reach it from the sandbox to check. Then mark your own browser with `repohq:notrack`.
7. Check that `DATABASE_URL` and `GOOGLE_API_KEY` from the MVP's provisioning are in the Vercel env. Without them pages can't be made, though the public pages still work.

## Self-review

I reviewed `git status` and `git diff` against gstack's pre-landing checklist ("Review Categories", then the "Fix-First Heuristic").

**Pass 1, CRITICAL: none open.**

- **SQL and data safety:** the one new query, `findPaidSlug`, binds its value, reads only, and is backed by a new `CREATE INDEX IF NOT EXISTS` in the advisory-locked bootstrap. No interpolation was added.
- **Races and status changes:**
  - Unlocking is still the single atomic `UPDATE … WHERE paid_at IS NULL`.
  - `/paid` only reads, and redirects only to a page the webhook already marked paid.
  - A takedown between payment and return leads to the "not confirmed" page, not to a removed page.
- **XSS and injection:**
  - The payment link comes from the env, must be `https:`, has `client_reference_id` set through `URLSearchParams`, and is escaped by `html```. A `javascript:` URL is rejected (tested).
  - `session_id` is checked against `^cs_(test|live)_[A-Za-z0-9]{8,240}$` before it's used or echoed into the refresh URL (tested with `<script>` and quotes).
  - `?wait=` is digits only.
  - JSON-LD escapes `<`, and its values are our constants plus a parsed URL origin.
  - The sitemap escapes XML.
  - The beacon is a static script.
- **Trust boundary (Stripe events):**
  - The signature check is unchanged.
  - Accepting payment-link sessions without the app tag required a type-checked `payment_link` string, `currency === 'usd'` and an integer `amount_total >= 900`.
  - Strings, `null` and lower amounts are rejected (tested).
- **Enum completeness:**
  - The new beacon kinds (`visit`, `activate`, `checkout`) are a closed set in one file, and the privacy page names all three (tested).
  - `PUBLIC_PATHS` is built from `LANDING_PAGES`, so a new occasion page joins the sitemap, the footers and the tests automatically.
  - `data-page` values `public` and `private` are both handled.

**Fixed during review** (mechanical, per the Fix-First heuristic):
- [P3] (confidence: 9/10) `src/pages.js`, `src/share-image.js`: exports nothing imported (`PRICE_LINE`, `structuredData`, `PRIVACY`, `TERMS`, `textBox`, `encodePng`) are now module-private.
- [P2] (confidence: 9/10) `/privacy` said a removed paid page keeps "only its payment record". `store.takeDown` keeps the ID, occasion and dates of *every* removed page (for the funnel), so the sentence now says exactly that.
- [P3] (confidence: 8/10) `test/entry.test.js` had a literal fake Checkout Session id. It now uses the runtime-built `SESSION_ID`, like the other tests, so nothing credential-shaped is committed. A repo-wide scan for key, secret, session-id and connection-string shapes finds nothing.

**Pass 2, informational:**
- [P3] (confidence: 8/10) `src/web.js` `/robots.txt` and `/sitemap.xml` use the request's origin when no `SITE_URL` or `VERCEL_PROJECT_PRODUCTION_URL` exists, and they're publicly cacheable. On Vercel the latter is always set, so the Host header never shapes a cached body there. Left as is.
- [P3] (confidence: 6/10) The beacon's JSON content type depends on RepoHQ answering CORS preflights; see "What's left", item 6. A `text/plain` body would avoid the preflight, but the brief asks for JSON. Not changed.
- [INFO] `src/pages.js` keeps its single hashed stylesheet; the new rules went into it, so there's still no inline `style`.
- [INFO] 2 new modules (`share-image.js`, `beacon.js`) and 1 new route group. The complexity smell (8+ files) triggers, but each file is a requirement of this brief, so nothing was cut.
