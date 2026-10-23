# giftlet — a personal gift website in two minutes

## Screenshots

Made by `npm run screenshots`: the real app on localhost, driven by Chromium through the buyer's path. It uses sample answers for a made-up "Maya", drawn pictures instead of photos, a placeholder `STRIPE_PAYMENT_LINK` (`https://example.com/pay`, never clicked) and a correctly signed Stripe webhook for a payment-link checkout.

![Birthday landing page on desktop](docs/screenshots/landing-desktop.png)
The start page, `/birthday` at 1280×800: the pitch, the price and "Make a birthday page", which opens the form with birthday preselected.

![Bottom of the birthday landing page on a phone, with the footer](docs/screenshots/landing-mobile.png)
The same page on an iPhone 13, scrolled to the footer: the price and refund line and the Privacy, Terms and Contact links that every public page has.

![A gift page made from the form, as a preview with the Unlock for $9 button, on desktop](docs/screenshots/gift-desktop.png)
The core action's result: the form, submitted, made this page. It's a watermarked preview whose Buy button ("Unlock for $9") points at the payment link for this page (`?client_reference_id=<page>`, checked by the script).

![The same preview with the Buy button on a phone](docs/screenshots/gift-mobile.png)
The same preview and Buy button on a phone.

![Keepsake PDF of the paid page in Chrome's viewer on desktop](docs/screenshots/keepsake-desktop.png)
After paying: the webhook unlocked the page and `/paid` sent the buyer back to it. Its printable keepsake (`/p/<page>/print`, 402 until paid) is a 2-page PDF in Chrome's viewer.

![Keepsake PDF at phone size](docs/screenshots/keepsake-mobile.png)
The same PDF at phone size, both pages. Chrome's desktop PDF viewer renders it soft under phone emulation.

For someone with a birthday, anniversary or send-off days away, it turns a few answers and their own photos into a private one-page website with funny AI copy and a printable keepsake for $9–$19.

- [Research](RESEARCH.md) — findings and sources
- [PRD](PRD.md)
- [Roadmap](ROADMAP.md)
- [Build notes](BUILD.md): what works now, how to run and deploy it
- [Launch readiness](LAUNCH-READY.md): search tags, privacy and terms, the Buy button, the usage beacon, and what's left before launch

Effort: Low · Confidence: Low

_Researched by the idea pipeline on 2026-10-13 ([original record](https://github.com/smithdavedesign/idea-factory/tree/main/ideas/giftlet)); repo created on David's go-ahead 2026-10-13._
