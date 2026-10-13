# Verdict: PASS — score 4/10

giftlet: demand evidence is thin and the status quo is cheap. Distribution for a one-time, deadline-driven consumer purchase is unsolved, and hosting real people's photos adds a moderation burden.

## Forcing questions
- **Q1 Demand (3/10):** Etsy "digital love letter" listings ($40 custom, $2–$5 templates) and Kudoboard ($5.99–$19.99) show people buy adjacent things. But RESEARCH.md has no volume data, Etsy pages returned 403, and the seed's TikTok trend was NOT FOUND. This is interest, not demand. Stronger evidence: strangers paying $9+ for a hand-made page.
- **Q2 Status quo (5/10):** Real workarounds: Canva/Etsy templates ($2–$5), Carrd, Kudoboard's free Mini board, or a card. Cost to the buyer is about an hour of writing. giftlet charges 3–5x the template floor, which the research itself flags.
- **Q3 Desperate specificity (3/10):** "A consumer with an occasion in 1–7 days" is a situation, not a person. The only named human is a developer who built it himself, who is not the paying buyer. No community to email.
- **Q4 Narrowest wedge (5/10):** Birthday only, one theme, five questions, three photos, $9 pay-after-preview. Buildable, but it competes on convenience against near-free options with no repeat loop.
- **Q5 (observation):** Can't be answered before a product exists. Watch M1 users: do they finish the questionnaire, edit the AI copy heavily, hesitate at the $9 price, and actually send the link to the recipient?
- **Q6 Future-fit (4/10):** General chatbots and AI site builders will make "page from answers" free. The moat is polish only.

## Premises
1. $9–$19 holds against $2–$5 templates: unsupported.
2. Last-minute gifters want a website, not a card or video: only snippets.
3. Recipients use the "make one" credit: untested, unlikely for a gift recipient.
4. Unlisted links plus takedown keep content risk manageable: plausible, but ongoing work.

## Alternatives
- **Minimal:** prompt sheet or template pack, no hosting; earns $2–$5.
- **Ideal:** full M1–M3 with themes, keepsake and Stripe; weeks for a seasonal product.
- **Lateral:** hand-fulfil pages on Etsy at $15–$25 to test price with no build.
- **Extend existing:** reuse squadwrap's generate-shareable-page pattern rather than starting from scratch.

## Narrowest wedge
Birthday-only, one theme, five questions, three photos, $9 after preview, one landing page.

## M1 feasibility
- Weekend build: yes. Zero cost: yes (Cloudflare Pages/R2, free model; Stripe only takes a cut of revenue).
- Proving test: POST /generate with a name, 4 memories (one with `<script>`) and 3 photos returns a 12+ char slug and a noindex page with the name and photos, script escaped.
- Caveat: moderation and takedown are a permanent duty.

## Risks
Price vs templates and free AI; seasonality and no repeat purchase; no distribution channel; photo and minor content risk; generic AI copy.

## Kill criteria
Fewer than 3 paid $9+ orders in 30 days of a hand-fulfilled test, or buyers who insist on manual edits.

## Assignment
Skip the build. List one hand-made page on Etsy or post in one community, and see whether anyone pays $15 for it.
