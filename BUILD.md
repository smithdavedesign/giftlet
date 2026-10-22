# giftlet — build notes

## Plan

Milestone: **M3 — Keepsake and demand test** (3 of 3 in this MVP run). M1 and M2 are built, and their 179 tests must keep passing. Nobody was available to ask, so every decision is written down here where it can be challenged.

ROADMAP's M3 exit criteria:
1. `GET /p/<slug>/print` returns a PDF of 1–2 pages for a paid page and 402 for an unpaid one.
2. Each occasion landing page has a title, a description and a link into the form with the occasion preselected.

The deliverables also list analytics for click-to-make and paid conversion. No exit criterion covers analytics, but the PRD's demand test can't be judged without them, so they are in.

### Step 0: Scope challenge (M3)

1. **Existing code that already does part of the job:**
   - `store.getGift` already returns `paidAt`, so the 402/PDF decision is one `if`.
   - The paid page already links to `/p/<slug>/print` (M2).
   - The `/p/*` middleware already adds `noindex` and `no-store` to the print route.
   - Theme names and colours already exist (`THEMES` plus the CSS variables), and the PDF reuses the same palette.
   - `pages.created_at`, `paid_at` and `taken_down_at` already *are* the paid-conversion data: created → paid → removed per occasion is one `GROUP BY`. No new event is needed for it.
   - The form's `<select>` is built from `OCCASIONS`, so preselecting means passing one value through.
   - The landing pages reuse `layout`, the hash-pinned stylesheet and the strict CSP.
2. **Smallest set of changes that meets the goal:**
   - `src/keepsake.js` (new): content + photos → a 2-page US Letter PDF;
   - a `GET /p/:slug/print` route: 402 HTML (with the unlock button) when unpaid, the PDF when paid;
   - `store.getPhotos` (one query for the photos, not one per photo);
   - three landing pages generated from one table keyed by occasion;
   - `?occasion=` preselection on the form;
   - first-party analytics: one counter table, a 1×1 pixel route and `npm run funnel`.

   **Cut:**
   - a QR code or URL on the keepsake. Printing the page's only secret on paper should be the buyer's choice, and no criterion needs it;
   - A4 paper (Letter prints fine on A4 when scaled);
   - a Unicode font for non-Latin names in the PDF (see Not in M3);
   - unique-visitor tracking, cookies, an admin dashboard, attributing pages to the landing they came from, a sitemap and `og:image`;
   - a Valentine's Day page, which would be a new occasion with its own copy, not a landing page.
3. **Complexity check:**
   - New modules: `src/keepsake.js` and `src/analytics.js`. The landing pages go into `pages.js`, which already holds every HTML page.
   - Changed: `web.js`, `store.js`, `pages.js` and `scripts/dev.js` (an in-memory DB option for the screenshot run).
   - New scripts: `scripts/funnel.js` and `scripts/screenshots.mjs`.

   That's 8 source files, right at the threshold. There's one new runtime dependency (`pdf-lib`, a library, not a service) and no new outside service, because analytics lives in the existing Postgres. The smell doesn't trigger, so no further cut.
4. **Search check** (WebSearch available):
   - **[Layer 1] pdf-lib** for the PDF. It's pure JS (no install scripts, no native code), the 14 standard PDF fonts need no font files, it embeds JPEG as-is (DCT passthrough, no decoding) and PNG, and its font metrics allow real line-wrapping. A hand-written PDF writer would need font width tables and PNG predictors. Headless Chrome is too heavy for a free-tier function.
   - **[Layer 1] Footgun:** pdf-lib's standard fonts only encode WinAnsi (Windows-1252). One emoji or a `∞` throws `WinAnsi cannot encode` and the whole PDF fails. And the template copy's birthday stat *is* `∞`. So every string is filtered through the font's own character set, and stat values fall back to the standard Symbol font, which has `∞`, `♥` and `≠`.
   - **[EUREKA] Footgun:** pdf-lib 1.17.1's `JpegEmbedder` does `new DataView(imageData.buffer)` and ignores `byteOffset`. `pg` returns small `bytea` values as Buffers sliced from Node's shared pool, so in production a perfectly good JPEG would be read at the wrong offset and rejected ("SOI not found"). Bytes are copied into a fresh `Uint8Array` before embedding, and a test feeds a JPEG at a non-zero offset.
   - **[Layer 1] Footgun:** Chrome's built-in PDF viewer renders a blank or broken page when the PDF response carries a strict CSP. It builds its own HTML wrapper with inline styles and a plugin embed, and `default-src 'none'` blocks both (Chromium issue 40328564). So the PDF response alone goes out without the CSP. The 402 HTML from the same route keeps it, and a test pins both.
   - **[Layer 1] Footgun:** Vercel caps a function *response* at 4.5 MB as well (`FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE`). The keepsake uses at most 6 photos and drops photos until the PDF is under 4 MB.
   - **[EUREKA] A pixel, not a server-side write, for analytics.** Counting in the landing page's handler would wake Neon (a cold start of up to about a second) in front of the first impression from every post. A 1×1 `<img src="/c/landing_view/birthday">` keeps the landing page static and cacheable. The counter is written by a separate request the browser makes while the page is already on screen, and chat-app link previewers, which fetch HTML but not images, aren't counted. A user-agent filter drops crawlers that do render (Googlebot) and headless browsers. A failed write still returns the GIF.
   - **[Layer 1]** Vercel Web Analytics has no custom events on Hobby, and Plausible costs money. A counter table in the Postgres we already have costs $0, stores no visitor data (no IP, no cookie, so no consent banner), and `INSERT … ON CONFLICT DO UPDATE SET count = count + 1` is atomic.
5. **TODOS.md:** none exists. The M2 open items are rate limiting, preview cleanup, an owner/restore link, the Vercel Hobby commercial-use ban and the deferred $19 tier and edit step. None blocks M3, and none is pulled in.
6. **Completeness:** every route error path costs minutes, so all of them are in: unknown, taken-down or malformed slug, no DB, DB failure, unpaid, broken or unsupported photos, oversized PNG dimensions, worst-case text lengths, non-Latin text, every theme × occasion, bot and prefetch hits, unknown events, and a failed counter write.
7. **Distribution:** no new artifact. Same Vercel project. `npm run funnel` runs locally against `DATABASE_URL`, and the same SQL works in Neon's console.

### Scope (M3)

- **Keepsake PDF** at `GET /p/<slug>/print`:
  - **Paid page:** a 2-page US Letter PDF, `inline` with a filename made from the recipient's name.
    - Page 1 is the cover: occasion, headline, "For <name>", intro, up to 6 photos as polaroid-style frames, and the sign-off.
    - Page 2 is the story: each memory with its title, then "Totally made-up statistics", each stat tagged **JOKE STAT**, as on the web page.
    - The page's theme carries over: Confetti dots, Blush circles and an italic serif, or Postcard's airmail border and serif. Text shrinks to fit, so it never runs onto a third page.
  - **Unpaid page:** **402** with an HTML page ("the keepsake comes with the unlocked page") that has the same unlock button.
  - **Errors:** unknown, malformed or taken-down slugs get 404. No DB gets 503.
- **Occasion landing pages** at `/birthday`, `/anniversary` and `/retirement`, one per `OCCASIONS` key. Each has:
  - its own `<title>`, `<meta name="description">` and `og:` title and description (for link previews in community posts);
  - a visible description, "how it works", sample joke stats and the price;
  - two "Make a … page" links to `/?occasion=<key>&from=landing`;
  - links to the other occasions.

  They are indexable: no `noindex` and a 5-minute public cache. `GET /?occasion=<key>` preselects that occasion in the form; an unknown value is ignored.
- **Analytics (first-party, counts only).** Table `daily_counts (day, event, occasion, count)`, with days in UTC. The pixel route `GET /c/:event/:occasion?` answers a no-store 1×1 GIF and records three events:
  - `landing_view`: a landing page rendered;
  - `make_click`: the form opened from a landing link, per occasion;
  - `credit_click`: the form opened from a gift page's "Make one for someone" credit, which now links to `/?from=credit`.

  Paid conversion comes from `pages` (made, paid, removed per occasion). `npm run funnel [days]` prints per occasion: landing views → clicks (click rate) → pages made → paid (paid rate) → removed, plus credit clicks per paid page.

### Deliberately NOT in M3

- **Non-Latin scripts in the PDF.** The standard fonts cover Western European text, curly quotes and dashes. Emoji and, for example, Cyrillic or CJK letters are dropped from the keepsake (the web page still shows them), and a name with no printable letters prints as "you". Fixing it means embedding a Unicode font (+fontkit, ~1 MB+). Do it if buyers ask.
- **A QR code or link on the keepsake**, A4 paper, and a keepsake for unpaid pages.
- **Unique visitors, sessions, referrers, cookies, an admin page, and landing → page attribution.** Counts are hits, so a reload counts twice. Fine for a 30-day demand test; revisit if the numbers are close to a threshold.
- **The $19 tier, the edit step, rate limiting, preview cleanup and an owner link**, carried over from M2 and still deferred (What's left).

### Architecture (M3)

```
community post ──► GET /birthday  (static HTML, public cache, no DB)
                     └─ <img src="/c/landing_view/birthday"> ──► GET /c/:event/:occasion? ─► bot/prefetch? skip
                                                                    └─► store.countEvent ─► UPSERT daily_counts (+1)  ─► 1×1 GIF (always)
               click "Make a birthday page" ──► GET /?occasion=birthday&from=landing ─► form, birthday preselected
                                                    └─ <img src="/c/make_click/birthday">
gift page credit ──► GET /?from=credit ─► form ─ <img src="/c/credit_click">
paid page ──► "Printable keepsake" ──► GET /p/<slug>/print ─► getGift ─► unpaid: 402 HTML + unlock button
                                                                  └─ paid: getPhotos(≤6) ─► keepsakePdf (pdf-lib) ─► ≤4 MB, 2 pages, no CSP header
npm run funnel ──► store.funnel(days) ─► daily_counts ⨝ pages (created/paid/removed per occasion) ─► table
```

- **`src/keepsake.js` (new)** exports `keepsakePdf({ theme, answers, copy, photos })` → `Uint8Array`, `keepsakeFilename(name)` and `KEEPSAKE_LIMITS`.
  - Layout is measured before it is drawn: one function either measures or draws, so the fit loop and the real drawing can't disagree.
  - Page 2 tries a font scale from 1.0 down to 0.6. At the smallest scale it cuts with an ellipsis instead of adding a page. A test with every text field at its maximum length in wide characters pins this.
  - Photos: JPEG and PNG are embedded, after a copy to offset 0. GIF and WebP are skipped. The form always uploads JPEG; only direct API callers can send the others. A PNG over 4 MP is skipped by reading its header, without decoding it, because decoding a crafted PNG could exhaust the function's memory. (The plan said 12 MP; the self-review lowered it, see Review.) A photo that fails to embed is skipped, and if the PDF is over 4 MB the last photo is dropped and it is rebuilt.
- **`src/analytics.js` (new)** exports `EVENTS`, `shouldCount(request)` (GET only; no bots, headless browsers or prefetch), `PIXEL_GIF` and `formatFunnel(report)`.
- **Store:**
  - `daily_counts` joins the advisory-locked bootstrap (`CREATE TABLE IF NOT EXISTS`), so M1 and M2 databases upgrade on the next request;
  - `countEvent(event, occasion)` is a single upsert, with the day set to `(now() AT TIME ZONE 'UTC')::date`;
  - `funnel({ days })` runs two `GROUP BY` queries over the same UTC window;
  - `getPhotos(slug, limit)` is one ordered query.
- **Trust boundaries:**
  - **Pixel route:** `event` and `occasion` come from the URL and are checked against allowlists (`EVENTS`, `OCCASIONS`) before they reach SQL. Anything else is a 404, so row count is bounded at 3 events × 4 occasion values per day.
  - **PDF text:** it comes from user answers and validated copy. It is only ever passed to `drawText` as text, so there is no PDF syntax injection; pdf-lib hex-encodes strings.
  - **Filename header:** reduced to `[a-z0-9-]` before it goes into `Content-Disposition`, so no header injection.
  - **Photo bytes:** untrusted. Each embed is wrapped in try/catch, and PNG dimensions are checked first.
- **Who can get the keepsake:** anyone with the link to a paid page, the same as the page itself.

**Failure scenarios, one per new codepath:**

| Codepath | Realistic failure | Handled? |
|---|---|---|
| PDF text | A name with an emoji, a Gemini stat value of `∞` or `🎂 3` → pdf-lib throws "WinAnsi cannot encode" | Yes: filtered per font charset; Symbol fallback for stat values; tested. |
| PDF photos | `pg` hands back a pooled Buffer slice → pdf-lib misreads the JPEG | Yes: copied to offset 0; tested with an offset view. |
| PDF photos | API caller uploaded a PNG claiming 30000×30000 → decode OOM | Yes: header check, skipped, never decoded; tested. |
| PDF size | 6 large photos → over Vercel's 4.5 MB response cap → 500 | Yes: drops photos until under 4 MB; tested with a lowered limit. |
| PDF length | 5 × 600-char memories + 6 long stats → page 3 | Yes: shrink-to-fit, then ellipsis; worst case tested for every theme. |
| PDF in Chrome | Strict CSP → blank viewer | Yes: no CSP header on the PDF response only; tested. |
| Unpaid keepsake | Buyer (or recipient) opens `/print` before paying | Yes: 402 page with the unlock button. |
| Landing page | Neon asleep when a post goes viral | Yes: landing pages never touch the DB; only the pixel does. |
| Pixel | DB down or slow | Yes: GIF still returned, warning logged, page unaffected. |
| Pixel | Slack/WhatsApp/Discord unfurl, Googlebot, prerender, our own headless screenshot run | Yes: previewers don't load images; UA and `Sec-Purpose` filters for the rest. |
| Pixel | Someone scripts `/c/landing_view/birthday` in a loop | Partly: rows stay bounded (allowlist), but counts inflate. Acceptable for a demand test; same for any counter without per-visitor data. |
| Funnel | Window boundaries in different time zones | Yes: both queries use the same UTC day boundary. |

### Test plan (M3)

| Exit criterion / codepath | Test file |
|---|---|
| **M3-EC1:** paid page → `/print` is 200 `application/pdf`, starts with `%PDF-`, 1–2 pages by two independent counts (raw `/Type /Page` objects and pdf-lib's parser), and contains the name, the headline and a JOKE STAT tag per stat; unpaid → 402 HTML with the unlock button and no PDF; after the webhook the same URL flips from 402 to the PDF; also over a real socket | `test/m3-exit-criteria.test.js`, `test/http.test.js` |
| **M3-EC2:** for every occasion, the landing page answers 200 with a `<title>`, a meta description (50–160 chars), a visible description and a link into the form with `occasion=<key>`. Following that link serves the form with exactly that occasion `selected`. There is a landing page per `OCCASIONS` key, with unique paths | `test/m3-exit-criteria.test.js` |
| Keepsake rendering: every theme × occasion → 1–2 pages; worst-case lengths → still ≤ 2; emoji/CJK/`∞` don't throw (Symbol font used); JPEG at a byte offset embeds; GIF/WebP/broken JPEG skipped; huge-dimension PNG skipped; at most 6 images; size budget drops photos; filename sanitised | `test/keepsake.test.js` |
| Print route: unknown/malformed/taken-down → 404; no DB → 503; DB failure → HTML 500; PDF has no CSP but has `noindex` + `no-store`; the 402 page keeps the CSP | `test/keepsake.test.js` |
| Landing extras: indexable (no noindex), strict CSP, cacheable, work without a DB (production entry), pixel present; form ignores unknown `?occasion=` | `test/analytics.test.js`, `test/entry.test.js` |
| Analytics: pixel counts for a browser UA; not for bots, headless, prefetch or HEAD; unknown event or occasion → 404 and nothing counted; DB failure or no DB → still a GIF; form/credit pixels; credit link is `/?from=credit` | `test/analytics.test.js` |
| Store: `countEvent` is atomic under 20 concurrent calls; `funnel` aggregates per occasion, excludes old days, counts created/paid/removed; empty DB → zeros; M1 schema upgrade gains `daily_counts`; `getPhotos` order and limit | `test/store.test.js` |
| `formatFunnel`: rates, divide-by-zero, credit line | `test/analytics.test.js` |
| `npm run funnel` end to end against a fresh PGlite database, with `DATABASE_URL` blanked; bad arguments → usage + exit 2 (added while writing the docs, so the documented output is real) | `test/funnel-script.test.js` |

## M2 plan (built, kept for reference)

Milestone: **M2 — Pay and publish** (2 of 3 in this MVP run; M1 is built and its 91 tests must keep passing). As in M1, nobody was available to ask, so every decision is written down here where it can be challenged.

### Step 0: Scope challenge (M2)

1. **Existing code that already does part of the job.** M1's `createApp` already takes its dependencies as arguments, and `geminiWriter` shows the pattern for an outside service: build it from an env var, call it with `fetch`, inject a fake in tests. Stripe gets the same treatment (`stripeCheckout`). The page renderer, the CSP middleware, the `/p/*` noindex/no-store middleware, the slug guard and the store's single-statement writes are all reused. Payment state goes on the existing `pages` row instead of a new table.
2. **Smallest set of changes that meets the exit criteria:**
   - a `paid_at` column, plus a store method that unlocks a page atomically;
   - `POST /stripe/webhook`, which checks the signature and unlocks a page on a paid `checkout.session.completed`;
   - an unpaid branch in `giftPage`: watermark plus an "Unlock for $9" button, and no keepsake link;
   - `POST /p/<slug>/checkout`, which creates a Checkout Session and redirects to it. That one route is what makes the product able to take money;
   - three themes;
   - the "make one" credit link.

   **Cut, with reasons** (each one is listed under "Deliberately NOT in M2"):
   - The $19 premium tier, which would mean two prices, a premium theme gate and a "custom message reveal". The exit criteria and the demand test (5 orders at **$9+**) only need one price.
   - The copy edit step. ROADMAP's M2 doesn't list it and no exit criterion needs it. M1's notes had pencilled it in for M2; I'm overriding that note so M2 stays narrow.
   - Confirming the session on the success URL. Webhooks are the source of truth, so the return page just says "confirming, refresh".
   - The print route (M3).
3. **Complexity check:** it touches 8 source files plus `.provision`, which is at the "more than 8 files" threshold but not over it. Those files are `payments.js` (new), `web.js`, `store.js`, `pages.js`, `answers.js`, `client.js`, `index.js` and `scripts/dev.js`. Three of the edits are one to five lines: `index.js` and `scripts/dev.js` wiring, and the `client.js` FormData change. There is one new module and one new outside service (Stripe). No new classes, tables or dependencies. The smell doesn't trigger, so no further cut.
4. **Search check** (WebSearch available):
   - **[Layer 1]** Stripe's SDK has `webhooks.constructEvent`. Stripe also documents the manual check: HMAC-SHA256 over `` `${t}.${rawBody}` ``, `v1` only (`v0` is a test scheme and accepting it allows a downgrade), constant-time compare, 300 s tolerance, and several `v1` values during secret rotation. **Decision: about 20 lines on `node:crypto` instead of the SDK.** Reasons: giftlet makes only two Stripe calls, `npm` install scripts are off, it keeps the same fetch-injection test pattern as Gemini, and the tests sign payloads with their own independent HMAC, so they aren't checking the code against itself. Revisit if more Stripe calls are added.
   - **[Layer 1] Footgun:** the raw body must be what gets hashed. The route hashes `c.req.arrayBuffer()` bytes before any JSON parsing. Stripe also treats a 3xx as a failed delivery, so the webhook path has no redirects.
   - **[EUREKA]** M1's CSP `form-action 'self'` would make the "Unlock" button silently do nothing in Chrome and Safari. Both browsers check `form-action` against the 303 redirect that follows a form POST, not just against the form's own action. So `form-action` becomes `'self' https://checkout.stripe.com` and nothing broader. There's a test for it, because a browser is the only thing that would catch it otherwise.
   - **[Layer 1] Footgun:** `checkout.session.completed` arrives with `payment_status: "unpaid"` for delayed payment methods (ACH, some wallets) that dynamic payment methods may switch on. Stripe's fulfillment guide says to unlock only when `payment_status === "paid"` and to also handle `checkout.session.async_payment_succeeded`. Stripe delivers events at least once and in any order, so unlocking is an idempotent `UPDATE … WHERE paid_at IS NULL`.
   - **[EUREKA]** David holds one Stripe account across ideas, and a webhook endpoint receives *every* checkout event on the account it subscribes to. So giftlet tags its sessions with `metadata[app]=giftlet` and ignores events that don't carry the tag.
   - Considered **Stripe Payment Links**: no secret key, and a plain `<a>` with no CSP issue. Rejected because the after-payment redirect is fixed per link, so the buyer couldn't land back on *their* page.
5. **TODOS.md:** none exists. M1's open items: rate limiting, cleanup of unpaid previews, the "prankster takedown of a paid page", and Vercel Hobby's commercial-use ban. None of them blocks the exit criteria. The Vercel item is a host-and-money decision, so it goes to David (Infrastructure) rather than into code.
6. **Completeness:** every error path of the two new routes is in, because each costs minutes: payments not configured, Stripe errors and timeouts, a Stripe answer that isn't a Stripe URL, a page that is already paid, taken down or unknown, every way a signature can be bad, valid signature but bad JSON, an async payment, another app's event, redelivery, a DB failure (500, so Stripe retries) and an oversized body.
7. **Distribution:** no new artifact. Same Vercel project; Stripe needs a dashboard webhook endpoint (Infrastructure).

### Scope (M2)

- **Pay after preview.** Every new page starts as an unpaid preview:
  - a big diagonal "Preview" watermark over the whole page (also when printed);
  - an "Unlock for $9" panel at the top, whose button POSTs to `/p/<slug>/checkout`;
  - no keepsake link.

  The checkout route creates a Stripe Checkout Session: one $9 line item, `client_reference_id=<slug>`, `metadata[app]=giftlet`, success URL `/p/<slug>?checkout=success`, cancel URL `/p/<slug>`. It then 303s to Stripe.
- **Unlock on webhook.** `POST /stripe/webhook` checks the `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET`. A paid giftlet session (`checkout.session.completed` with `payment_status=paid`, or `checkout.session.async_payment_succeeded`) sets `paid_at` and stores the session id for refunds. The paid page has no watermark and no unlock panel, and shows a "Printable keepsake" link to `/p/<slug>/print`. That route is M3's, next in this run.
- **Return from Stripe.** `?checkout=success` shows "Thanks, unlocked, send the link" once paid, or "confirming your payment, refresh in a few seconds" if the webhook hasn't landed yet.
- **Three themes:**
  - Confetti: bright and bubbly (the M1 look, still the default);
  - Blush: soft and romantic;
  - Postcard: warm and classic, with an airmail border.

  The buyer picks one on the form ("Pick a look"). It is stored with the page and applied as a `theme-<name>` class on `<body>`. All three live in the one hash-pinned stylesheet, so the CSP doesn't change. A missing theme defaults to Confetti; an unknown one gets a 400.
- **"Make one" credit** in the footer of every gift page, paid or not: "Made with giftlet. Make one for someone →" linking to `/`.

### Deliberately NOT in M2

- **$19 premium tier** (premium theme + custom message reveal). One $9 price is enough for the demand test. All three themes come with $9. Add the tier if people pay $9 easily.
- **Copy edit step before paying** (PRD). Not on ROADMAP's M2 and no exit criterion needs it. Until it exists, a buyer who dislikes the copy makes a new page before paying. Listed under What's left for after the MVP.
- **Confirming the session on the success URL** (`GET /v1/checkout/sessions/:id`). The webhook is the only path that unlocks a page; the return page asks for a refresh if the webhook is slow.
- **The print route** `/p/<slug>/print` (M3). The paid page links to it already, and it returns 404 until M3, which comes next in this run.
- **Refunds, receipts and emails** (Stripe sends the receipt), an owner/restore link, rate limiting, preview cleanup, analytics (M3) and landing pages (M3).
- **Moving off Vercel Hobby.** That's David's call. Until then Stripe runs in **test mode** (see Infrastructure).

### Architecture (M2)

```
buyer ──GET /p/<slug>──────────► getGift ─► unpaid: watermark + "Unlock for $9" form, no keepsake link
      ──POST /p/<slug>/checkout► getGift ─► paid? 303 back : stripeCheckout() ─► POST api.stripe.com/v1/checkout/sessions
                                                                               ◄─ { id, url } (url must be https://checkout.stripe.com/…)
      ◄─303 Location: checkout.stripe.com  (CSP form-action allows exactly this origin)
      ──pays on Stripe──► Stripe ──POST /stripe/webhook (raw body + Stripe-Signature)
                                     └► verifyStripeEvent (HMAC v1, ±300 s) ─✗─► 400, page stays locked
                                     └► paidCheckout(event): our app tag + paid status + slug ─► store.markPaid (idempotent UPDATE)
      ◄─redirect /p/<slug>?checkout=success ─► paid: no watermark, keepsake link, "send the link" note
```

- **`src/payments.js` (new):**
  - `PRICE`;
  - `checkoutParams` (the form-encoded Stripe request);
  - `stripeCheckout({ secretKey, fetch })`, which returns `null` without a key, like `geminiWriter`;
  - `verifyStripeEvent(raw, header, secret)`, which returns the event or `null`;
  - `paidCheckout(event)`, which returns `{ slug, sessionId }` or `null`.
- **Store:** `ALTER TABLE pages ADD COLUMN IF NOT EXISTS paid_at timestamptz, … checkout_session text` inside the existing advisory-locked bootstrap, so M1 databases upgrade on the first request.
  - `getGift(slug)` → `{ content, paidAt }`. `getPage` stays as a wrapper.
  - `markPaid(slug, sessionId)` is `UPDATE … WHERE taken_down_at IS NULL AND paid_at IS NULL`, so redelivery is a no-op.
  - A takedown keeps `paid_at` and `checkout_session` on the tombstone, so a refund can be found later.
- **Trust boundaries:**
  1. The webhook body is untrusted until its signature checks out. Even then, only events tagged with our app name and `payment_status=paid` unlock a page, and only if the `client_reference_id` passes the slug-shape guard.
  2. Stripe's create-session answer is checked: it must have a URL whose origin is exactly `https://checkout.stripe.com` before we redirect to it.
  3. The secret key goes only in the `Authorization` header and is never logged. Errors are re-thrown with status codes only.
  4. No recipient name or memory is sent to Stripe. The product name is generic.
- **Who can pay or check out:** anyone holding the slug, as in M1. Paying for someone else's preview only helps them. A cross-site POST to `/checkout` needs the slug and only creates a session nobody pays.

**Failure scenarios, one per new codepath:**

| Codepath | Realistic failure | Handled? |
|---|---|---|
| Unlock button | Chrome blocks the 303 to Stripe under `form-action 'self'` | Yes: CSP allows `https://checkout.stripe.com`, and a test pins it. |
| Create session | Stripe 401 (wrong/missing key), 5xx, timeout, or a body with no URL | Yes: 502 page with "try again"; 15 s timeout; logged with status only. |
| Payments not configured | `STRIPE_SECRET_KEY` not provisioned yet | Yes: the preview still renders; the button answers 503 "payments aren't switched on yet". |
| Webhook signature | Wrong secret, body re-serialized by a proxy, replay of an old event, missing header | Yes: 400, page stays locked. Raw bytes are hashed. |
| Webhook content | Delayed payment method (`unpaid`), another app on the same Stripe account, an event type we don't handle | Yes: 200 and no unlock; the async success event unlocks later. |
| Webhook delivery | Stripe retries / duplicates / reorders | Yes: idempotent `UPDATE … WHERE paid_at IS NULL`; always 200 once handled. |
| Webhook store write | Neon down | Yes: 500, so Stripe retries for up to 3 days. |
| Buyer returns before webhook | Race between redirect and webhook | Yes: "confirming, refresh in a few seconds" note; `no-store` on `/p/*` means a refresh shows the truth. |
| Page taken down before payment lands | Buyer paid for a page that is gone | Partly: no unlock (the page stays 404). The session id is in Stripe for a manual refund. |
| Old M1 rows | Pages created before `paid_at` existed | Yes: `ADD COLUMN IF NOT EXISTS` makes them unpaid previews; a test upgrades an M1-shaped schema. |

### Test plan (M2)

| Exit criterion / codepath | Test file |
|---|---|
| **M2-EC1:** a new page shows the watermark and unlock form and has no keepsake link; after a signed `checkout.session.completed` there is no watermark and no unlock form, and the keepsake link is present; it stays unlocked after redelivery; other pages stay locked; also over a real socket | `test/m2-exit-criteria.test.js`, `test/http.test.js` |
| **M2-EC2:** bad signature in each form (wrong secret, body tampered after signing, missing header, malformed header, `v0` only, timestamp > 300 s old or ahead, timestamp edited) → 400 and still locked; no webhook secret configured → refused and still locked | `test/m2-exit-criteria.test.js` |
| **M2-EC3:** `giftPage` renders every theme × {unpaid, paid} from identical content with name, photos, ≥3 joke stats and the theme class; the stylesheet has a rule for each theme; `POST /generate` with each theme → page 200 in that theme; the form offers each theme; unknown theme → 400; missing theme → Confetti | `test/m2-exit-criteria.test.js` |
| Checkout route: 303 to Stripe with the right session request; already paid → back to the page without calling Stripe; unknown/taken down → 404; not configured → 503; Stripe failure → 502 and logged; CSP `form-action` allows exactly Stripe Checkout | `test/checkout.test.js` |
| Webhook route: `unpaid` then `async_payment_succeeded`; other app's event; unrelated event type; unknown or malformed slug; taken-down page stays 404; valid signature + invalid JSON → 400; oversized body → 413; DB failure → 500 | `test/checkout.test.js` |
| Return notices: `?checkout=success` unpaid → "confirming", paid → "unlocked"; "make one" credit on paid and unpaid pages | `test/checkout.test.js` |
| `verifyStripeEvent` (rotation, boundaries, encodings), `paidCheckout`, `stripeCheckout` (request shape, key only in the header, errors without the key, non-Stripe URL rejected) | `test/payments.test.js` |
| Store: `getGift`, `markPaid` idempotent and not on taken-down pages, tombstone keeps payment, upgrade from the M1 schema | `test/store.test.js` |
| Production entry without Stripe env: webhook refused | `test/entry.test.js` |
| Browser script sends every form field (so the new `theme` field isn't dropped) | `test/validation.test.js` |

## M1 plan (built, kept for reference)

Milestone: **M1 — Generate a page from answers** (1 of 3 in this MVP run). Decisions below were made without a human in the loop; each is written down so it can be challenged later.

### Step 0: Scope challenge

1. **Existing code.** The repo held only docs. REVIEW.md suggests reusing squadwrap's generator, but that repo is outside this workspace, so M1 starts from scratch and stays small enough that reuse would not save much.
2. **Minimum change set for the exit criteria:** a questionnaire page, `POST /generate` (validate, write copy, store), `GET /p/<slug>` (render), a photo route, and a takedown confirm + `POST`. Nothing else.
3. **Complexity check:** 7 source files (`src/index.js`, `web.js`, `answers.js`, `copy.js`, `pages.js`, `store.js`, `client.js`) plus a dev script. There are two "services" (the Postgres store and the copy writer), which is right at the threshold, so no further cut. No classes.
4. **Search check** (WebSearch was available):
   - Vercel deploys a Hono app with no config when `src/index.js` default-exports it **[Layer 1]**. Avoid naming other files `src/app.*` or `src/server.*`, because Vercel also treats those as entry points.
   - Vercel caps a function's request body at **4.5 MB for the whole request**; the platform returns 413 before our code runs. **[EUREKA]** The 5 MB-per-photo rule in the exit criteria can never be the binding limit in production. So the form must shrink and re-encode photos in the browser so that all of them fit in about 3.8 MB together. Re-encoding through a canvas also drops EXIF, so phone GPS locations don't end up on a public page.
   - Hono ships `html` (escape-by-default templates), `secureHeaders` and `bodyLimit` **[Layer 1]**. Use them instead of hand-rolled versions.
   - Gemini's `gemini-flash-latest` alias, structured JSON output (`responseMimeType` + `responseSchema`) and the `x-goog-api-key` header **[Layer 1]**. The key goes in a header, never in the URL, so it can't leak through logs.
   - Concurrent `CREATE TABLE IF NOT EXISTS` on two cold starts can fail in Postgres (a known footgun). The schema bootstrap therefore takes `pg_advisory_xact_lock` inside one implicit transaction.
5. **TODOS.md:** none exists.
6. **Completeness:** full validation, every error path, LLM-output validation and the takedown path are all in, because they are cheap. Things that cost real scope are deferred (list below).
7. **Distribution:** a web service on Vercel's free tier. No new artifact type. `vercel project giftlet` from `.provision` plus Git import is the pipeline.

### Scope (M1)

- `GET /`: five-question form (name, occasion, relationship, 3–5 memories, tone) plus 3–12 photos. A small script resizes photos in the browser and posts the form.
- `POST /generate`: multipart. Validates the fields and every photo, then writes copy (Gemini if `GOOGLE_API_KEY` is set, otherwise a deterministic template; on any LLM failure it falls back to the template), then stores the page and photos in one SQL statement. Returns `201 {slug, url, takedownUrl}`.
- `GET /p/<slug>`: one theme ("confetti", used for all three occasions). Shows a headline, the name, the photos, one section per memory, 3+ statistics each labeled as a joke, a sign-off and a takedown link. Sent with `X-Robots-Tag: noindex` plus a robots meta tag, `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` and a strict CSP. There is no JavaScript on gift pages.
- `GET /p/<slug>/photo/<n>`: serves the stored bytes, with the content type taken from our own magic-byte sniff, never from the client's declared type.
- `GET /p/<slug>/takedown`: a confirm page. `POST` to the same URL removes the page: the page row becomes a tombstone (content cleared, `taken_down_at` set), and the photos are deleted in the same statement. After that, every `/p/<slug>…` URL returns 404.

### Deliberately NOT in M1

- Payments, watermark, the three themes and the "make one" credit (M2). PDF keepsake and landing pages (M3).
- The edit-before-paying step (PRD). It belongs with checkout, so it lands in M2.
- Rate limiting of `POST /generate`, cleanup of unpaid previews, and object storage for photos (they live in Postgres `bytea` for now; see Architecture).
- Server-side EXIF stripping: the browser re-encode strips it; only direct API callers bypass that.
- A takedown reason/report form. The tombstone row is enough to count takedowns for the "under 5%" success metric.

### Architecture

```
browser ──GET /──────────────► form page + /form.js (resize to ≤3.8 MB total, re-encode JPEG)
browser ──POST /generate─────► web.js ─► answers.js  validate fields, sniff photo bytes (4xx on bad input)
                                     ├─► copy.js     Gemini JSON ─► validate/trim/pad ─► fallback template
                                     └─► store.js    INSERT page + photos (one statement, CTE)
browser ──GET /p/<slug>──────► store.getPage ─► pages.js render (escape-by-default `html`) ─► noindex HTML
        ──GET /p/<slug>/photo/n► store.getPhoto ─► bytes, sniffed mime, nosniff
        ──POST /p/<slug>/takedown► store.takeDown (UPDATE tombstone + DELETE photos, one statement) ─► 404 afterwards
```

- **Stack:** Hono on Node (Vercel Functions, Hobby tier), `pg` against Neon Postgres (free tier), Gemini free tier for copy. The roadmap's "Next.js static export + Cloudflare Pages/R2" was rejected: a static export can't serve `POST /generate` or return 404 after a takedown, and the credential broker provisions Vercel + Neon, not Cloudflare.
- **Photos in Postgres `bytea`** instead of R2/Blob, because that's one fewer service and one fewer secret. A takedown deletes the photos in the same statement, so removal is real. Limit: Neon's free tier has 0.5 GB of storage and 5 GB/month of egress, which is about 250 pages of ~2 MB, plenty for a 5-order demand test. Move to object storage when that becomes tight.
- **Slug:** 16 random bytes as base64url (22 chars, 128 bits). It is the only secret protecting a page, so the routes check its shape before touching the DB. `Referrer-Policy: no-referrer` stops it leaking to other sites.
- **Takedown is open to anyone holding the link.** The person most likely to want a page gone is the recipient, and they don't have the buyer's details. A GET only shows a confirm page; the delete needs a POST. Reason: chat apps prefetch shared links, so a GET-delete would destroy gifts when they're sent.
- **Trust boundaries:** (1) user input is validated and capped, and every interpolation in the templates is escaped by Hono's `html`; (2) LLM output is treated as untrusted. It is shape-checked, stripped of control characters, length-capped, and padded to ≥3 stats, and the "joke" label comes from our template, never from the model; (3) uploads are accepted by magic bytes only (JPEG/PNG/GIF/WebP), which rules out SVG, HTML disguised as `.png`, and HEIC.

**Failure scenarios, one per new codepath:**

| Codepath | Realistic failure | Handled? |
|---|---|---|
| Browser resize | HEIC that Chrome can't decode | Yes: the form shows "couldn't read photo N, use JPEG/PNG". |
| `POST /generate` body | 12 phone photos uploaded raw exceed Vercel's 4.5 MB → platform 413 | Yes: the client stays under a 3.8 MB budget; the server's own cap returns JSON 413. |
| Gemini call | Free-tier 429, timeout, or malformed JSON | Yes: 20 s timeout, then template copy; the page still gets made. |
| Gemini output | Only 2 stats, or 3 KB headline, or HTML in text | Yes: padded to ≥3, trimmed, escaped. |
| Schema bootstrap | Two cold starts racing `CREATE TABLE` | Yes: advisory transaction lock. |
| DB down / `DATABASE_URL` missing | Neon cold or not provisioned | Partly: 503 JSON with no stack. Neon's own cold start (~0.5 s) is just latency. |
| Takedown | Link previewer hits the takedown URL | Yes: GET only confirms. |
| Takedown | Double submit | Yes: the second POST gets 404; the single atomic statement can't half-apply. |

### Test plan (node:test, PGlite in-process Postgres, no network, no real secrets)

| Exit criterion / codepath | Test file |
|---|---|
| EC1: POST /generate (name, birthday, 4 memories, 3 photos) → slug ≥12 random chars; page HTML has the name and all 3 photos; the photo bytes round-trip; two slugs differ | `test/exit-criteria.test.js` |
| EC2: ≥3 stat items, each labeled as a joke (template path, and an LLM path that returned only 2 stats) | `test/exit-criteria.test.js` |
| EC3: `<script>` in a memory (and HTML in the name) is escaped; the gift page has no `<script` at all | `test/exit-criteria.test.js` |
| EC4: photo over 5 MB → 413; text file posing as PNG → 415; SVG → 415; nothing stored | `test/exit-criteria.test.js` |
| EC5: `noindex` header and meta, takedown link; GET takedown doesn't delete; POST does; then page and photos → 404; second POST → 404 | `test/exit-criteria.test.js` |
| Field validation: missing name, bad occasion/relationship/tone, 2 or 6 memories, over-long memory, 2 or 13 photos, non-multipart | `test/validation.test.js` |
| Magic-byte sniffing for each allowed format and the rejects | `test/validation.test.js` |
| Copy: template for every occasion × tone; Gemini success; key sent in a header, not the URL; malformed JSON / HTTP error / thrown fetch → fallback; too few stats padded; long strings capped; control chars stripped | `test/copy.test.js` |
| Store: schema idempotent; create/get/photo round-trip; takedown atomic and idempotent; unknown slug | `test/store.test.js` |
| Prod entry without `DATABASE_URL`: form still renders, `/generate` → 503 | `test/entry.test.js` |
| Form page + `/form.js` served and the script parses | `test/validation.test.js` |
| The whole flow over a real socket (Node HTTP server + fetch), including a browser-style takedown POST | `test/http.test.js` |
| DB failure → JSON 500 on `/generate`, HTML 500 on pages; no internal details leak | `test/validation.test.js` |

## What it does now (after M3)

The whole buyer path works end to end:
1. A post in a community links to an occasion landing page.
2. "Make a … page" opens the form with that occasion chosen.
3. Submitting makes a watermarked preview.
4. "Unlock for $9" goes to Stripe, and Stripe's signed webhook unlocks the page.
5. The paid page links to its printable keepsake PDF.
6. Every step of the demand test is counted, without storing anything about the visitor.

New in M3:

- **Occasion landing pages: `/birthday`, `/anniversary`, `/retirement`.** Each has:
  - its own title, meta description and `og:` tags for link previews;
  - the pitch, "how it works", sample joke stats, the $9 price and the privacy promise;
  - two "Make a … page" buttons into the form with the occasion preselected (`/?occasion=<key>&from=landing`);
  - links to the other two occasions.

  They are indexable, cached for 5 minutes, and never touch the database.
- **The form takes `?occasion=`.** A valid occasion is preselected; anything else is ignored.
- **The printable keepsake, `GET /p/<slug>/print`:**
  - **Paid page:** a 2-page US Letter PDF, opened inline (`giftlet-keepsake-<name>.pdf`).
    - Page 1, the cover: occasion, headline, "For <name>", intro, up to 6 photos as polaroids, and the sign-off.
    - Page 2: every memory under its title, then the made-up statistics, each tagged **JOKE STAT** in a tinted box.
    - Theme: Confetti dots in Helvetica, Blush circles with italic serif headings, or Postcard's red-and-blue airmail border with serif headings.
    - Long text shrinks to fit, so it never needs a third page.
  - **Unpaid page:** **402** with the same "Unlock for $9" button.
- **First-party analytics:**
  - a 1×1 pixel counts landing views, clicks into the form from a landing page (per occasion), and clicks on the gift-page credit, which now links to `/?from=credit`;
  - bots, link previewers, headless browsers and prefetches aren't counted;
  - `npm run funnel` prints, per occasion: landing views → clicks (click rate) → pages made → paid (paid rate) → removed, plus credit clicks per paid page and the PRD's targets. This is its output on an empty database, which is what `test/funnel-script.test.js` runs it against:

    ```
    giftlet funnel: last 30 days (since 2026-09-23, UTC)

    occasion      landing views   make clicks   click rate   pages made   paid   paid rate   removed
    birthday                  0             0            –            0      0           –         0
    ...
    "Make one" credit clicks: 0 (– per paid page)
    ```

Still there from M1 and M2:

- **The questionnaire (`GET /`):**
  - their first name;
  - the occasion: birthday, anniversary, or retirement/send-off;
  - who they are to you, from a fixed list;
  - 3–5 memories;
  - a tone: funny, sweet or heartfelt;
  - **a look**: Confetti, Blush or Postcard;
  - 3–12 photos. The browser shrinks them to fit 3.8 MB in total and re-encodes them as JPEG, which also strips location metadata.
- **Submitting creates a private page** at `/p/<22-char random slug>`, in the chosen theme. The copy comes from Gemini when `GOOGLE_API_KEY` is set, otherwise from built-in templates, and it is validated either way. The page has:
  - the headline and the name;
  - a photo gallery;
  - one section per memory;
  - at least 3 "Totally made-up statistics", each tagged **Joke stat**;
  - a sign-off;
  - a "Made with giftlet. Make one for someone →" credit;
  - a "Remove this page" link.

  It isn't indexed, isn't cached, and leaks no referrer.
- **New pages are unpaid previews.** They have a big diagonal "Preview" watermark and an "Unlock for $9" panel at the top, and no keepsake link. The button sends the buyer to Stripe Checkout, and Stripe brings them back to the page.
- **Stripe's signed webhook unlocks the page.** The watermark and the panel disappear and a "Printable keepsake" link appears. On the way back from Stripe the buyer sees either "confirming, refresh in a few seconds" or "unlocked, send Maya this link: …", with the clean link.
- **"Remove this page"** opens a confirm page. Confirming deletes the photos and content right away, and every URL for that page then returns 404. A paid page keeps its payment record on the tombstone so it can be refunded.
- **Payments not configured yet:** the preview still works and the button explains that payments aren't switched on.

## Run it locally

```bash
npm install          # no install scripts needed (pdf-lib and playwright-core are pure JS)
npm test             # node:test; Postgres runs in-process via PGlite, no network, no Stripe, no browser
npm run dev          # http://localhost:3000, landing pages at /birthday, /anniversary, /retirement
npm run funnel       # demand-test numbers for the last 30 days (npm run funnel -- 7 for a week)
npm run screenshots  # needs CHROMIUM_PATH; writes docs/screenshots/*.png (not part of npm test)
```

- **Funnel:** `npm run funnel` reads `DATABASE_URL` when it is set, like the app; otherwise it reads `.data/pglite`. Stop `npm run dev` first, because PGlite can't share its directory between processes. It prints counts only. The same numbers come from Neon's SQL editor without any local secret:

  ```sql
  SELECT event, occasion, sum(count) FROM daily_counts WHERE day > current_date - 30 GROUP BY 1, 2;
  SELECT coalesce(occasion, content #>> '{answers,occasion}') AS occasion, count(*) AS made,
         count(paid_at) AS paid, count(taken_down_at) AS removed
  FROM pages WHERE created_at > now() - interval '30 days' GROUP BY 1;
  ```
- **Screenshots:** the script starts `scripts/dev.js` itself on a free port. It uses a throwaway in-memory database (`GIFTLET_PGLITE=memory://`) and template copy, with no database, Gemini or Stripe key passed to it. It drives Chromium from `CHROMIUM_PATH`, which is never downloaded: landing page → form → page → a webhook signed with a random per-run secret → paid page → keepsake. Then it stops the server.

`npm run dev` works with whatever you set in your shell:
- **No `DATABASE_URL`:** data goes in `.data/pglite` (gitignored), or a throwaway in-memory database with `GIFTLET_PGLITE=memory://`.
- **No `GOOGLE_API_KEY`:** pages use template copy.
- **Payments:** set `STRIPE_SECRET_KEY` (a **test-mode** key) and `STRIPE_WEBHOOK_SECRET`. To get events locally, run Stripe's free CLI with `stripe listen --forward-to localhost:3000/stripe/webhook`. It prints its own webhook signing secret; use that one as `STRIPE_WEBHOOK_SECRET` for local runs. Pay with Stripe's test card `4242 4242 4242 4242`.
- **No Stripe variables:** pages stay watermarked previews and the unlock button answers 503.

Node 20+.

## Deploy (free tier)

1. The pipeline runs `.provision` through the credential broker (see Infrastructure). That creates the Neon database, the Gemini key and the Vercel project `giftlet` with `DATABASE_URL` and `GOOGLE_API_KEY` as env vars.
2. Connect this repository to the `giftlet` Vercel project (Git import). Vercel detects Hono from `src/index.js` (default export), so no build command, output directory or `vercel.json` is needed. Every push to `main` deploys.
3. The tables are created, or upgraded from M1/M2, on the first request (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` under an advisory lock). M3 adds the `daily_counts` table and a `pages.occasion` column. There is no migration step.
4. **Payments** (David, per the `request` lines in `.provision`):
   - In Stripe (test mode first), add a webhook endpoint at `https://<production domain>/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
   - Store `STRIPE_SECRET_KEY` (a restricted key with *Checkout Sessions: write*) and the endpoint's `STRIPE_WEBHOOK_SECRET` in the `giftlet` Vercel env, then redeploy.
   - The endpoint must not sit behind a redirect: Stripe counts a 3xx as a failed delivery. So register the final domain exactly, including `www` if there is one.
5. Optional: set `GEMINI_MODEL` to override `gemini-flash-latest`.
6. M3 needs no new service, key or env var. The landing pages are what to post: `https://<domain>/birthday`, `/anniversary` and `/retirement`.

**Free-tier limits that matter:**
- Vercel caps a function request at 4.5 MB, and the form stays under 3.8 MB. It caps a *response* at 4.5 MB too, and the keepsake stays under 4 MB by dropping photos.
- Neon free gives 0.5 GB of storage and about 5 GB/month of egress. That's roughly 250 pages of photos, or a couple of thousand page views. A keepsake download reads up to 6 photos, about as much as one page view. A counter hit is a few bytes.
- Gemini free-tier rate limits apply; when they're hit, pages fall back to template copy.
- Stripe has no monthly fee; it takes a cut of each payment.
- **Vercel Hobby is non-commercial only**, so taking live payments there breaks its terms. Stay in Stripe test mode until David settles the hosting `request` (see Infrastructure).

If Vercel's zero-config detection ever fails (older reports of "module not found" with relative imports), the fallback is `api/index.js` exporting `handle(app)` from `hono/vercel`, plus a rewrite of `/(.*)` to `/api`.

## Exit criteria (M3)

`npm test`: **249 tests, 249 passing, 0 failing** (13 test files). All 179 M1 and M2 tests still pass, and 70 are new for M3.

| Exit criterion | Status | Tests |
|---|---|---|
| `GET /p/<slug>/print` returns a PDF of 1–2 pages for a paid page and 402 for an unpaid one | ✅ pass | `M3-EC1` in `test/m3-exit-criteria.test.js`, 4 tests. The paid page's PDF is `application/pdf` and starts with `%PDF-`. It is 1–2 pages by two independent counts (raw `/Type /Page` objects, and pdf-lib's parser), and its decompressed text has the name, the headline and a JOKE STAT per stat. The unpaid page gives 402 HTML with the unlock button. The same URL flips from 402 to the PDF when the signed webhook lands. Every occasion/tone/theme gives 1–2 pages. Also `test/http.test.js`: landing → form → page → 402 → webhook → PDF over a real socket. |
| Each occasion landing page has a title, description and a link into the form with the occasion preselected | ✅ pass | `M3-EC2`, 4 tests. There is one landing page per `OCCASIONS` key, each at its own path. For each page: a title that names the occasion, a 50–160-character meta description that is also shown on the page, and links whose `occasion` is that key. Following the link serves the form with exactly that occasion `selected`. |

Also covered:
- **The keepsake beyond the criteria** (`test/keepsake.test.js`, 30 tests):
  - theme × occasion;
  - each theme's fonts, and a print look for every theme;
  - the worst-case lengths in wide letters for every tone;
  - a 600-character unbroken word;
  - emoji, CJK, Cyrillic and curly quotes;
  - `∞` drawn in the Symbol font, and an unprintable name printed as "you";
  - a JPEG at a non-zero `byteOffset`;
  - GIF, WebP and broken JPEGs skipped, and a 30000×30000 PNG header skipped without decoding;
  - the 6-photo cap and the size budget;
  - metadata and the sanitised filename;
  - the route's headers (no CSP on the PDF; CSP kept on the 402), 404s, 503, a DB failure, and a single photo query.
- **Analytics, landing pages and the form query** (`test/analytics.test.js`, 22 tests).
- **The store:** `getPhotos`, `countEvent` under 20 concurrent calls, the funnel window and totals, and the M1 upgrade gaining the M3 schema (`test/store.test.js`, 6 new).
- **`npm run funnel` end to end** (`test/funnel-script.test.js`, 2).
- **The production entry without a DB** (landing pages and the pixel) and the HTTP round trip.

Changed M2 test: the "make one" credit test in `test/checkout.test.js` now expects `href="/?from=credit"` instead of `href="/"`. M2's notes planned this tag for M3. The assertion is just as strict: an exact href, on paid and unpaid pages.

Not verified here (no credentials, no deploy):
- a live Vercel deployment, including whether Vercel's bundler picks up `pdf-lib` (it is a plain dependency, imported normally);
- live Neon;
- Safari's and Firefox's PDF viewers. Chrome's viewer was checked: it renders the keepsake (see the screenshots).

## Exit criteria (M2)

Still passing: all M2 tests are in the 249 above. When M2 was built, `npm test` was **179 tests, 179 passing, 0 failing** (9 test files), and 88 of them were new or extended for M2.

| Exit criterion | Status | Tests |
|---|---|---|
| An unpaid page shows a watermark and no keepsake link; after a signed `checkout.session.completed` webhook it does not | ✅ pass | `M2-EC1` block in `test/m2-exit-criteria.test.js` (4 tests: preview state; signed webhook unlocks; redelivery keeps it unlocked; other pages stay locked) + `test/http.test.js` (raw pretty-printed Stripe bytes over a real socket) |
| A webhook with a bad signature leaves the page locked | ✅ pass | `M2-EC2` (11 tests: wrong secret, no header, empty header, malformed header, non-hex `v1`, `v0`-only, 6-minute-old replay, 6 minutes in the future, edited timestamp, body tampered to unlock another page, no webhook secret configured), each asserting the status and that the page still has its watermark and unlock button and no keepsake link |
| Each theme renders the same input without error | ✅ pass | `M2-EC3` (12 tests: every theme × unpaid/paid from identical content, each with its stylesheet rules, name, 3 photos, ≥3 joke stats, takedown link; unknown stored theme falls back; `POST /generate` per theme → 200; missing theme → default; unknown theme → 400 with nothing stored; form offers all three) |

Also covered: the checkout route, the webhook beyond the criteria, return notices and the credit (`test/checkout.test.js`, 25 tests); the Stripe helpers (`test/payments.test.js`, 24 tests); payment state in the store, including upgrading an M1-shaped database (`test/store.test.js`, 6 new tests). Theme validation (3), a test that the browser script posts every form field, the production entry without Stripe, and the HTTP round trip account for the remaining 6 new tests.

Not verified here (the sandbox has no credentials and can't deploy):
- a live Vercel deployment;
- a live Neon connection. The SQL is tested against PGlite, which is real Postgres compiled to WASM;
- a live Gemini call;
- **a live Stripe round trip.** The session request is checked field by field against Stripe's documented form encoding, and webhook signatures are generated in the tests with Stripe's documented scheme, independently of `src/payments.js`. The first real test-mode payment is still the true check;
- the CSP `form-action` behaviour in a real browser. The header value is pinned by a test, but no browser ran it.

## Exit criteria (M1)

Still passing: all 91 M1 tests are in the 249 above. Two M1 tests were strengthened, not loosened: the DB-failure test's fake store now also fails `getGift`, the read M2's page route uses; and the validation table gained two theme rows.

| Exit criterion | Status | Tests |
|---|---|---|
| POST /generate with a name, "birthday", 4 memories and 3 photos returns a slug of ≥12 random characters and a page whose HTML contains the name and all 3 photos | ✅ pass | `EC1` block in `test/exit-criteria.test.js` (3 tests) + `test/http.test.js` |
| The page contains ≥3 fake-statistics items, each labeled as a joke | ✅ pass | `EC2` (2 tests: template copy; model copy with only 2 stats) |
| Memory text containing `<script>` is escaped in the rendered HTML | ✅ pass | `EC3` (3 tests: memory, name, model output) |
| An upload over 5 MB or a non-image file is rejected with a 4xx | ✅ pass | `EC4` (5 tests: >5 MB → 413, exactly 5 MB → 201, text-as-PNG → 415, SVG → 415, nothing stored) |
| GET /p/<slug> serves with `noindex` and the takedown link, and returns 404 after takedown | ✅ pass | `EC5` (4 tests) + `test/http.test.js` |

## What's left

M1–M3 are built: the MVP can make a page, take $9 for it, give a keepsake, and measure the demand test. Before the first real dollar:

- **David's decisions** (the `request` lines in `.provision`):
  - **Hosting.** Vercel Hobby is non-commercial only, so Stripe stays in test mode until this is settled. Vercel Pro is paid; Cloudflare Workers is free and allows commercial use. pdf-lib is pure JS and would come along; the `pg` driver would change.
  - **Stripe keys and the webhook endpoint.**
  - **Legal pages before charging:** terms, refunds and privacy. There is no REVENUE.md, so this wasn't built. The privacy policy can truthfully say that analytics are counts only, with no cookies or IPs. A refund link would use the `checkout_session` kept on each page.
- **Run the demand test:** post the three landing links in targeted communities, then read `npm run funnel` weekly against the PRD's thresholds (≥3% click rate; ≥5 paid orders in 30 days; removed <5%; credit clicks ≥10% of paid pages).
- **Deliberately deferred PRD items:**
  - the $19 premium tier (premium theme + custom message reveal);
  - the copy edit step before paying;
  - confirming the payment on the success URL as a backup to the webhook.
- **Deliberately deferred in M3:**
  - a Unicode font for non-Latin names in the keepsake;
  - a QR code or link on the keepsake, and A4 paper;
  - unique visitors and landing → page attribution;
  - a Valentine's Day occasion (a PRD open question).
- **Carried over from M1/M2:**
  - rate limiting on `POST /generate`, `/checkout` and now `/print`;
  - a cleanup job for unpaid previews (protects Neon's 0.5 GB);
  - an owner/restore link, so a prankster with the link can't destroy a paid gift.

## Infrastructure

Requested in `.provision` (the pipeline runs it after the build; nothing was provisioned from here):

| Line | Gives | Used by |
|---|---|---|
| `neon db giftlet` | `DATABASE_URL` (Neon Postgres, free tier) | `src/index.js` → `pg.Pool` → `src/store.js` |
| `gcp key giftlet generativelanguage.googleapis.com` | `GOOGLE_API_KEY` restricted to the Gemini API (free tier) | `src/copy.js` `geminiWriter` |
| `vercel project giftlet` | Vercel project (Hobby) with every stored value as env | deploy target |
| `vercel env giftlet DATABASE_URL`, `vercel env giftlet GOOGLE_API_KEY` | explicit pushes of both values, in case the project was created before they existed | deploy target |
| `request "Stripe payments for giftlet: …"` (new in M2) | David stores `STRIPE_SECRET_KEY` (restricted: Checkout Sessions write) and `STRIPE_WEBHOOK_SECRET` (endpoint `/stripe/webhook`, events `checkout.session.completed` + `checkout.session.async_payment_succeeded`) and pushes both to the Vercel env | `src/index.js` → `stripeCheckout` and `/stripe/webhook` |
| `request "Hosting decision for giftlet: …"` (new in M2) | David picks Vercel Pro (paid) or a free host that allows commercial use (Cloudflare Workers is the closest fit) before Stripe goes live | deploy target |

**M3 asked for nothing new.** The keepsake is generated in the function with pdf-lib. Analytics are a table in the same Neon database. The landing pages are static. `.provision` is unchanged.

No `vercel env` lines were added for the Stripe values. They come from David, not from the broker, so they may not exist when the pipeline runs. The request asks for them to be pushed once stored.

Every variable is optional at runtime:
- without `DATABASE_URL`, the form and the landing pages still render, the pixel still answers (nothing is counted), and data routes, including `/print`, answer 503;
- without `GOOGLE_API_KEY`, copy comes from templates;
- without `STRIPE_SECRET_KEY`, previews work and the unlock button answers 503;
- without `STRIPE_WEBHOOK_SECRET`, the webhook answers 503 and nothing can be unlocked.

No secret appears in the repo. Tests build fake keys, webhook secrets and session ids at runtime from a prefix and filler.

## Review

Self-review of the M3 change against gstack's pre-landing checklist ("Review Categories", "Fix-First Heuristic"). Nothing has been committed since the idea commit, so `git diff` only shows README.md and `git status` lists the rest as untracked. I read every file M3 touched:
- new: `src/keepsake.js`, `src/analytics.js`, `scripts/funnel.js`, `scripts/screenshots.mjs` and four new test files;
- changed: `web.js`, `store.js`, `pages.js`, `scripts/dev.js`, `package.json`, `test/helpers.js` and the extended tests.

**Pass 1, CRITICAL: none found, none open.**

- **SQL & data safety:**
  - `countEvent`, `funnel` and `getPhotos` bind every value.
  - The one interpolated fragment (`SINCE_UTC_DAY`) is a constant, now commented as such.
  - `createPage` derives `occasion` in SQL from the same bound JSON, so there's no second value that could disagree.
  - The keepsake reads photos in one ordered query, not one per photo (tested).
- **Races:**
  - Counting is one atomic `INSERT … ON CONFLICT DO UPDATE SET count = count + 1` (20 concurrent calls → 20, tested). There's no read-then-write.
  - Paid status only ever moves forward, so the 402/PDF decision can't flip back.
- **XSS / injection:**
  - `?occasion=` reaches the HTML only after the `OCCASIONS` allowlist; `?from=` is only compared, never echoed (tested with `"><script>`).
  - Pixel URLs are built only from allowlisted values.
  - The landing copy is static and still escaped by `html```.
  - PDF text goes to `drawText` as data (pdf-lib hex-encodes it), so there is no PDF syntax injection.
  - `Content-Disposition` gets an `[a-z0-9-]` filename (CRLF and quotes tested).
  - Removing the CSP applies only to responses whose content type is exactly `application/pdf`, and those are only ever our own generated PDF.
- **External-input trust boundary** (LLM copy and uploaded bytes):
  - Copy was already shape-checked by `normalizeCopy`. In the PDF, every string is also filtered to what the font can encode, because one emoji would otherwise fail the whole document.
  - Photo bytes are untrusted: each embed is in its own try/catch, and PNG dimensions are read from the header before any decode.
- **Enum completeness:**
  - `OCCASIONS` is traced to landing pages (a completeness test), the form preselection, the PDF labels, the pixel allowlist, `countEvent` and the funnel rows.
  - `THEMES` is traced to the print looks. That gap was found in this review (below).
  - `EVENTS` is traced to the pixel route, `countEvent`, the funnel's counters and the form/landing pixels.

**Fixed during review:**

- [P2] (confidence: 8/10) `src/keepsake.js` `KEEPSAKE_LIMITS.pngMaxPixels`: 12 MP allowed up to 6 PNGs × 48 MB of decoded RGBA per render, and the size-budget loop can re-render. That's several hundred MB on a 2 GB function. Lowered to 4 MP. Form uploads are JPEG and at most 2.6 MP, so only API callers are affected.
- [P3] (confidence: 9/10) `src/keepsake.js` `LOOKS`: a theme added to `THEMES` without a print look would silently print as Confetti. `LOOKS` is now exported and a test pins its keys to `THEMES`.
- [P3] (confidence: 10/10) `src/store.js` `SINCE_UTC_DAY`: commented as a constant fragment, so the next reader doesn't take it for interpolated input.
- Found while building, before review (each is tested):
  - the CSP blanking Chrome's PDF viewer;
  - pdf-lib's `byteOffset` JPEG bug;
  - WinAnsi crashes on `∞` and emoji;
  - the `system-ui` font stack falling back to monospace on Linux without a UI font (the stack now puts `system-ui` after the named fonts);
  - a cover that was empty in the middle when no photo could be embedded.

**Left open** (design decisions, or not worth the code yet):

- [P2] (confidence: 8/10) `src/web.js` `GET /p/:slug/print`: no rate limit. Each request builds a PDF (~0.1–1 s CPU) and reads up to 6 photos (up to ~4 MB of Neon egress), so someone hammering a paid page's keepsake could use up Neon's 5 GB/month. Page views already have the same exposure through `/photo/n`. Same fix as the open M1/M2 item: a per-IP counter in Postgres.
- [P2] (confidence: 7/10) Analytics count hits, not people. A reload counts twice, and a script can inflate `/c/...` counts (rows stay bounded by the allowlist). Fine for a 5-order demand test; dedupe before trusting a close call.
- [P3] (confidence: 7/10) `src/keepsake.js`: names in non-Latin scripts are dropped from the PDF. "美咲" prints as "For you", and the template headline becomes "Happy birthday, !". The web page is unaffected. Fixing it means embedding a Unicode font (fontkit + a font file).
- [P3] (confidence: 6/10) `src/web.js` print route: `getGift` and `getPhotos` are two reads, so a takedown landing between them yields a PDF of text that was readable a moment earlier, without photos. Harmless; medium confidence that it's worth even a comment.
- [P3] (confidence: 5/10) `scripts/funnel.js` without `DATABASE_URL` reads `.data/pglite`, which `npm run dev` must not hold open at the same time. Documented, not enforced.
- [INFO] `docs/screenshots/keepsake-mobile.png` is soft: under phone emulation Chromium's desktop PDF viewer rasterises at low resolution. Real phones open PDFs in their own viewer. The desktop shot is the sharp proof.
- [INFO] Scratch keepsake previews (`.data/preview-*.mjs` and their PDFs and PNGs) were left in the gitignored `.data/`, because deleting files wasn't permitted in this sandbox. They can't be committed.
- [INFO] Still open from M2: Vercel Hobby's commercial-use ban, and no live Stripe, Neon or Vercel check from here.

### M2 review (kept for reference)

Self-review of the M2 change against gstack's pre-landing checklist. Nothing has been committed since the idea commit, so `git diff` only shows README.md. I reviewed `git status` plus every file M2 touched: `src/payments.js` (new), `web.js`, `store.js`, `pages.js`, `answers.js`, `client.js`, `index.js`, `scripts/dev.js`, `.provision`, and the tests.

**Pass 1, CRITICAL: none open.**

- **SQL & data safety:** the new queries (`getGift`, `markPaid`) take every value as a bound parameter. The schema upgrade is static DDL inside the existing advisory-locked bootstrap.
- **Races and status changes:** unpaid → paid is a single `UPDATE … WHERE taken_down_at IS NULL AND paid_at IS NULL`. Concurrent or duplicate Stripe deliveries can't apply it twice or move `paid_at`, and a takedown and a payment can't both "win". Tested: redelivery, takedown before payment, and an M1-shaped database.
- **XSS / injection:**
  - every new value in a template goes through `html```;
  - the `<body>` theme class comes from an allowlist (`Object.hasOwn(THEMES, …)`);
  - the `?checkout` value is compared, never echoed;
  - the only external redirect target must have the exact origin `https://checkout.stripe.com`, so there is no open redirect. Lookalike hosts and `http:` are tested.
- **External-input trust boundary** (Stripe here plays the part of "LLM output" in the checklist): an event unlocks a page only if all of these hold:
  - the raw-byte HMAC checks out (`v1` only, ±300 s, constant-time compare);
  - it carries our `metadata.app` tag;
  - `payment_status` is `paid`;
  - the `client_reference_id` passes the slug-shape guard.

  The secret key goes only in the `Authorization` header, and error messages carry a status or error name only (tested for both the key and the slug).
- **Enum completeness:**
  - `THEMES` is traced through every consumer: validation (`answers.js`), the form radios, `giftPage`'s lookup, the stylesheet (a rule per theme, tested) and the browser script.
  - The browser script was the miss. Its hard-coded `['name', 'occasion', 'relationship', 'tone']` list would have silently dropped `theme`, so every page would have come out Confetti. I caught it while building, switched to `new FormData(form)`, and added a test.
  - Stripe event types: `completed` and `async_payment_succeeded` unlock. `async_payment_failed` and `expired` deliberately leave the preview, so the buyer can try again.

**Fixed during review:**

- [P2] (confidence: 9/10) `src/web.js` `/stripe/webhook`: a paid event for a page that had been taken down during checkout was silently acknowledged, so a customer could pay and nobody would know to refund them. It now logs `paid checkout <session id> has no live page; refund it in Stripe`, with the session id and never the slug. A redelivery for an already-paid page doesn't trigger it. Two tests.
- [P2] (confidence: 9/10) `src/pages.js` `checkoutNotice`: the thank-you note said "copy this page's address", but the address bar holds `?checkout=success`, so the recipient would have seen the buyer's note too. It now shows the clean link to send. Tested.
- [P3] (confidence: 10/10) `test/store.test.js`: one literal Stripe-session-shaped string. It is now built at runtime like the other fakes.

**Left open** (each needs a human decision or belongs to M3):

- [P2] (confidence: 9/10) Vercel Hobby forbids commercial use. Live Stripe keys must wait for David's hosting decision (`request` in `.provision`). The code doesn't depend on Vercel.
- [P2] (confidence: 10/10) `src/pages.js` `giftPage`: the paid page's "Printable keepsake" link points at `/p/<slug>/print`, which is M3's route and returns 404 until then. M3 is next in this run.
- [P2] (confidence: 7/10) `src/web.js` `POST /p/:slug/takedown`: anyone with the link can still delete a page, now including a paid one. The tombstone keeps `paid_at` and `checkout_session`, so a refund can be found. An owner/restore link is a design call.
- [P2] (confidence: 7/10) Still no rate limiting on `POST /generate`, and now on `POST /p/:slug/checkout` either. Creating a Checkout Session is free and needs the slug, so the new route only costs Stripe API calls. Same fix as before: a per-IP counter in Postgres.
- [P3] (confidence: 6/10) `src/payments.js` / `src/web.js`: a buyer who opens two checkout tabs and pays both gets charged twice. The second payment is acknowledged without a refund warning, because `markPaid` can't tell it apart from a redelivery. It is visible in Stripe as two payments with the same `client_reference_id`. Medium confidence that it matters: it takes two deliberate payments.
- [P3] (confidence: 6/10) `src/web.js` `POST /p/:slug/checkout`: Stripe's return URLs use the request's origin. On Vercel a request only reaches the app through one of its own domains, so this can't be pointed elsewhere. Behind a different proxy, set the origin from config instead. Medium confidence, verify on the final host.
- [P3] (confidence: 5/10) An unpaid preview is fully readable under the watermark, so a buyer could screenshot it instead of paying. This is the accepted trade-off of a watermark (ROADMAP M2). Watch for it in the demand test.
- [INFO] Not exercised here: a real Stripe test-mode payment and the CSP `form-action` behaviour in a real browser (see Exit criteria). Do one test-mode purchase after deploying.
- [INFO] There is no Stripe SDK: the two calls use `fetch` and `node:crypto`. If refunds or a customer portal get added, switch to the official `stripe` package rather than adding more hand-written calls.

### M1 review (kept for reference)

**Pass 1, CRITICAL: none open.**

- SQL & data safety: every value is a bound parameter. The only interpolation is placeholder numbers (`$3`, `$4`…) in `src/store.js:42`. The page + photos insert and the takedown are each a single statement, so there's no check-then-set.
- Races: takedown is `UPDATE … WHERE taken_down_at IS NULL` plus `DELETE` in one CTE, so double submits are safe. The schema bootstrap is serialized with `pg_advisory_xact_lock` (`src/store.js:7`). A slug collision is a 2⁻¹²⁸ event and would fail on the primary key without a partial write (tested).
- XSS: every template value goes through Hono's escaping `html`; `raw` is used only for our own CSS. There is no JavaScript on gift pages. CSP uses `default-src 'none'` with a hash-pinned stylesheet. Photos are served with the sniffed type plus `nosniff`, and SVG is refused.
- LLM trust boundary: model output is shape-checked, stripped of control and bidi characters, length-capped and padded (`src/copy.js` `normalizeCopy`). It is rendered only as escaped text; no URLs are fetched or rendered from it.
- Enum completeness: every occasion × relationship × tone is exercised against every consumer (form options, validation, template copy, prompt, page label).

**Fixed during review:**

- [P3] (confidence: 9/10) `src/web.js:86`: the multipart content-type check was case-sensitive. Fixed and tested.
- [P3] (confidence: 9/10) the DB-failure paths (`onError`) had no tests. Added a JSON 500 for `/generate` and an HTML 500 for pages, plus a check that internal details don't leak.
- [P2] (confidence: 10/10) `scripts/dev.js`: the dev server crashed on first run because PGlite doesn't create `.data/`. Fixed.
- Test-side: two helper bugs (a default parameter swallowed the "missing field" cases; the fake fetch in the timeout test didn't keep Node alive). Fixed without weakening any assertion.

**Left open (each needs a human decision, or belongs to a later milestone):**

- [P2] (confidence: 8/10) `src/web.js:78`: `POST /generate` has no rate limit. A script could fill Neon's 0.5 GB with photos and use up the Gemini free quota (pages would still get template copy). A real fix needs a shared counter (Postgres or a KV), which is a design call. Suggested for M2: a per-IP hourly cap in Postgres, plus deleting unpaid previews after 7 days.
- [P2] (confidence: 7/10) `src/web.js:145`: anyone holding the link can take the page down. This was chosen on purpose (the recipient must be able to remove a page about them, and the slug is the credential). The cost: a prankster in a group chat can delete a paid gift. Revisit in M2 by giving the buyer a restore/owner link once payment exists.
- [P2] (confidence: 8/10) Vercel Hobby forbids commercial use; it must be resolved before M2 charges money (see What's left).
- [P3] (confidence: 7/10) `src/answers.js:115`: the server doesn't strip EXIF. The browser re-encode does, so only direct API callers (who upload their own photos) can publish GPS data.
- [P3] (confidence: 6/10) `src/client.js:38`: after 6 shrink attempts a photo may still exceed its share of the budget; Vercel would then return a non-JSON 413, which the form shows as a generic error. Medium confidence: it needs very large, detailed photos to happen.
- [P3] (confidence: 5/10) `src/copy.js:184`: if Gemini ever wrapped its JSON in Markdown fences despite JSON mode, the page silently falls back to template copy. The result is safe but blander. Medium confidence, verify this is actually an issue with a live key.
- [INFO] Photos live in Postgres `bytea`. Neon free egress (~5 GB/month) caps photo views at a few thousand; move to object storage if the demand test works.
- [INFO] Not exercised here: live Vercel deploy, live Neon, live Gemini (see Exit criteria).
