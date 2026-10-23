# giftlet: road to first dollar

**Evidence strength: weak.** The gstack review passed it at 4/10 and I agree. Nothing here shows anyone paying $9+ for this. The $9 price rests on adjacent products (listed below), not on anyone buying giftlet. You decided to build anyway (2026-10-13), and the MVP is built (3/3 milestones merged). So the job now is to find out cheaply and fast whether a stranger pays. This plan is the shortest honest path to that answer.

## Who pays (Q3, desperate specificity)
Not "users". The buyer is someone whose partner's birthday or anniversary is 1–7 days away, who has no gift and no design skill, and who will spend 5 minutes and $9 to avoid showing up empty-handed. The consequence is social and daily: an awkward evening, or a partner who feels forgotten. The best-placed people to find are:
- long-distance partners (they already hunt for digital gifts);
- people who say "I forgot / need something last minute" in gift threads.

The secondary buyer, a coworker organizing a send-off, has a budget but Kudoboard already owns that job. Skip them for now.

I can't name one real person. Nobody in the evidence is a paying buyer. That gap is the main problem, and the first ten users are meant to close it.

## What they pay today (Q2, status quo)
- Etsy Canva/animated templates: about $2–$9 (a search snippet showed an animated letter at $8.55). The buyer does the writing.
- Etsy custom "interactive love letter website": $40–$60 (the search snippet shows $60 for the listing the research saw at $40; it is "low in stock, only 4 left", which hints at some sales). It is slow because a seller builds it.
- Kudoboard single boards: $5.99 / $8.99 / $19.99 on the one aggregator that lists them. Capterra shows only business subscriptions ($25–$38/mo), so these list prices are unverified. It is a group card, not the same job.
- Etsy "personalized birthday gift" median is about $22 (range $9–$30), per a keyword tool. That shows people do pay $9–$30 for personalized gifts in general.
- Free: writing a card, a Canva page, a text.

So $9 sits above the template floor and well under the custom-site price. The honest pitch is "the $40 page, finished in 2 minutes, for $9".

## Narrowest version worth paying for (Q4)
Birthday and anniversary landing pages feeding the existing five-question form, a preview before paying, and a single $9 price. Hold the $19 tier, the keepsake PDF and the retirement theme back from the first test. Each extra option adds a decision on a deadline-driven purchase and tells us less about the one question, which is whether anyone pays $9. If you want to price-test, change the single price, not the tier count.

## Price
**$9 once per page.** It anchors under the $8–$9 Etsy animated and Kudoboard Premium prices, and it is far below the $40–$60 custom listings. It is an impulse price on a last-minute need. Don't go lower than $9: Stripe takes about $0.56 (2.9% + $0.30), and a lower price invites comparison with $2–$5 templates. Don't launch at $19.

## Payment
Stripe Checkout after preview (already in M2, unlock on webhook). David creates the Stripe product and maps it in RepoHQ. Agents hold no card.

## Before charging anyone
1. Deployed on a free tier at a live URL (not yet done).
2. Privacy policy and terms (not yet written). These matter more than usual because we host photos of real people.
3. Takedown and report path working, since photos of real people (including possible minors) make this a permanent duty.
4. Stripe live checkout tested end to end with a real $9 charge and refund.
5. A refund rule stated on the page: refund on request within 7 days.
6. Screenshots of the main flow against the live URL, committed under `docs/screenshots/`.

## Channels (first ten users, by place)
Not paid ads. Not Etsy at first (fees, and a storefront to set up). Hand-fulfil for the earliest buyers if the automated flow breaks.
- **r/LongDistance**: people who give digital gifts all the time. Be useful first: post one real example page with the poster's permission, and read the rules on self-promotion before posting.
- **r/GiftIdeas**: "last minute gift" threads. Reply to the specific asker with the product, once, if the rules allow.
- **r/AnniversaryGifts and r/relationship_advice** are less certain fits; check each one's self-promo rules before posting.
- **Indie Hackers / Product Hunt**: reaches builders, not gift buyers. Useful for feedback, not for the first dollar.

If strict self-promo rules block all of these, there's no free channel left, and that itself is evidence for the kill criteria.

## First ten users
1. Make three real pages yourself for friends' birthdays or anniversaries and watch them use the form. It costs nothing and is the Q5 observation the review asked for.
2. Offer free pages to 10 people in r/LongDistance in exchange for a screen recording and an honest reaction.
3. Then post the paid version with a dated hook, "birthday in 3 days? $9, done in 2 minutes", in 2–3 last-minute gift threads a week.
4. Ask each of the first buyers why they chose it over a $3 template. Rewrite the landing copy in their words.

Be careful: free users prove the product works, not that anyone pays. Count only $9 charges toward the test.

## Seasonality
Valentine's Day (14 Feb) is about 16 weeks away. It will be the real demand test, and anniversaries and birthdays occur all year, so the earlier test is not hopeless. Get the first signal in November–December and be tuned for February.

## Risks
- Price against $2–$5 templates and free chatbots that can write the same copy. Polish is the only moat.
- No repeat purchase and a one-time buyer, so every sale is a new acquisition.
- The recipient "make one" credit is untested and probably weak for a gift.
- Content risk: real people's photos, minors, harassment pages. A permanent moderation duty on a $9 product.
- AI copy may feel generic.
- No volume data anywhere; Etsy pages returned 403 and I only have snippets.
- Aggregator-reported Kudoboard prices disagree with Capterra, so treat them as soft.

## Kill criteria
Stop if, 30 days after the live launch with the policy pages and checkout working, there are fewer than 3 paid $9 orders from strangers (not friends), or if buyers insist on manual edits. The PRD's own bar is at least 5 orders to continue and fewer than 2 to pass. I'd keep the review's stricter reading: under 3 means stop. Also stop if moderation or takedown work costs more than a couple of hours a month.

## Next action
Deploy, add the policy pages, make Stripe live at $9, then post in one place. Nothing else moves the first-dollar date.
