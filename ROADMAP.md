# giftlet — Roadmap

Suggested stack: Next.js static export (one codebase for form and generated pages), Cloudflare Pages + R2 (free tier hosting and photo storage), a free-model call for copy, Stripe Checkout (pay after preview), print-CSS for the keepsake PDF.

## M1 — Generate a page from answers (a weekend)
Deliverables: questionnaire form, photo upload with size cap, copy generation endpoint, one theme, preview at an unlisted slug, takedown link.
Exit criteria:
- POST /generate with a name, occasion "birthday", 4 memories and 3 photos returns a slug of at least 12 random characters and a page whose HTML contains the recipient name and all 3 photos.
- The generated page contains 3 or more fake-statistics items and each is labeled as a joke.
- Memory text containing `<script>` is escaped in the rendered HTML.
- An upload over 5 MB or a non-image file is rejected with a 4xx.
- GET /p/<slug> serves with `noindex` and the takedown link, and returns 404 after takedown.

## M2 — Pay and publish
Deliverables: Stripe Checkout after preview, unlock on webhook, three themes, "make one" credit.
Exit criteria:
- An unpaid page shows a watermark and no keepsake link; after a signed checkout.session.completed webhook it does not.
- A webhook with a bad signature leaves the page locked.
- Each theme renders the same input without error.

## M3 — Keepsake and demand test
Deliverables: print-styled keepsake PDF, occasion landing pages, analytics for click-to-make and paid conversion.
Exit criteria:
- GET /p/<slug>/print returns a PDF of 1–2 pages for a paid page and 402 for an unpaid one.
- Each occasion landing page has a title, description and a link into the form with the occasion preselected.
