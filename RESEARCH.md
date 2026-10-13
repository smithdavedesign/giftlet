# giftlet — research

## Summary
giftlet turns a few answers and the buyer's own photos into a private one-page website for one person and one occasion (birthday, anniversary, retirement), with AI-written copy and a printable keepsake, for $9–$19.
The closest paid proof is Etsy "custom virtual love letter website" listings (one at $40) and Kudoboard group cards ($5.99–$19.99 per board).
Evidence of demand is real but thin: no hard data found on volume, so the first test is whether people pay for a done-for-you page rather than a $2–$5 Canva template.

## Evidence of the problem
- Etsy has an active category of "digital love letter" gifts. One listing is a "fully customizable, interactive website made just for them" with a personal letter, photo gallery and audio message (https://www.etsy.com/listing/1857223924/customizable-website-digital-love-letter); the page itself returned 403 when fetched, so details come from the search snippet only.
- Other sellers offer a "Custom Virtual Love Letter Website" with a countdown at $40.00; many cheaper listings are Canva templates or animated videos at roughly $2–$5 (https://www.etsy.com/market/love_letter_digital).
- A developer forum thread has people describing building a site that released a photo and note each day for a partner, "simple, but it made her so happy" (https://yomotherboard.com/question/creative-gift-ideas-for-my-developer-girlfriend/). That is anecdotal; it shows the DIY version exists and is liked, not that it is widespread.
- NOT FOUND: the seed's claim of a TikTok trend of hand-making gift websites. A search for it returned nothing relevant, so this idea does not rest on it.
- Last-minute gifting is a known behaviour (https://thinkwithgoogle.com/data/last-minute-shopper-statistics), but I found no figure specific to birthdays or digital gifts. Personalization stats found were vendor press releases and I do not rely on them.

## Who pays
- Buyer: someone with a birthday, anniversary or send-off close by (often days away) who wants a gift that feels personal and has little time or design skill. Mostly consumers; secondary buyers are coworkers organizing a retirement or farewell page.
- Price point: $9–$19 per page; extras (custom domain, premium theme, printable keepsake) up to about $29.
- Evidence they pay for something like it today:
  - Etsy custom love-letter website listing at $40.00 (https://www.etsy.com/market/love_letter_digital).
  - Kudoboard single-board prices reported as $5.99 (Lite), $8.99 (Premium), $19.99 (Milestone), with a free Mini board up to 10 posts; G2 shows 4.8/5 across 994 reviews (https://funeral.com/blogs/the-journal/online-memorial-walls-kudoboard-and-similar-how-they-work-costs-and-moderation-tips, https://g2.com/products/kudoboard/reviews?page=2). Prices may be outdated.
  - Template sellers at $2–$5 show the floor: a buyer who only wants a template will not pay $15.

## Competitors & alternatives
| Name | Price | Gap |
|---|---|---|
| Etsy love-letter website sellers | about $2–$5 (Canva templates), $40 (custom site) | Template sellers make the buyer do the work; custom sellers are slow and expensive, so not usable the day before |
| Kudoboard | $5.99–$19.99 per board, free Mini | Group-card format (many contributors), not a single-author designed page with AI copy and stats |
| Thankbox / Newlywords style card and book tools | free to paid, printed books extra | Aimed at group messages or books, not a personal site |
| Carrd | free, $9/$19/$49 per year | A builder, not a gift: the buyer writes everything and designs it (https://onepagelove.com/carrd-pricing) |
| Canva websites/templates | free tier | Same: blank-page work for the buyer |
| Hand-coding it | free | The developer-partner route above; not an option for most buyers |

## Technical notes
- Static pages generated from a template plus JSON; host on free static hosting (Cloudflare Pages / Vercel) with unlisted random slugs.
- Buyer's own photos only: no image generation. Client-side resize before upload; store in free object storage with a size cap.
- Copy written by a free model from a short questionnaire (name, relationship, 5 memories, tone). Playful fake statistics generated from the answers and clearly formatted as jokes.
- Payment via Stripe Checkout (David approves and holds the account); pay after previewing, so no card is held by agents.
- Printable keepsake: print-styled CSS to PDF; no inventory.
- Takedown link on every page; celebrations only, block exes/roasts of people who did not agree via prompt rules and a report path.

## Risks & open questions
- Willingness to pay $9–$19 when $2–$5 templates exist: the value must be the finished result in minutes, not the template.
- Seasonality: demand peaks around Valentine's Day, and the seed asks which occasion converts best; I found no data. The demand test should split occasions.
- Distribution: the recipient sharing and the "make one" credit is untested; Etsy needs a storefront and fees.
- Content risk: personal photos of real people, minors in photos, harassment pages. Needs unlisted links, takedown, and an adult-celebration-only rule.
- AI copy may feel generic; the fix is questions that capture specific memories.
- Etsy listing details could not be verified directly (403); price points come from search snippets.

## Sources
- https://www.etsy.com/listing/1857223924/customizable-website-digital-love-letter
- https://www.etsy.com/market/love_letter_digital
- https://funeral.com/blogs/the-journal/online-memorial-walls-kudoboard-and-similar-how-they-work-costs-and-moderation-tips
- https://g2.com/products/kudoboard/reviews?page=2
- https://onepagelove.com/carrd-pricing
- https://yomotherboard.com/question/creative-gift-ideas-for-my-developer-girlfriend/
- https://thinkwithgoogle.com/data/last-minute-shopper-statistics
