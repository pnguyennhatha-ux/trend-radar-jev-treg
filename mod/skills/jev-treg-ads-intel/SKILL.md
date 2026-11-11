---
name: jev-treg-ads-intel
description: >-
  Use when spying on competitor ads or planning ad creative for ecom: pull
  Meta/TikTok ad library data through Treg, classify and score the ads cheaply
  with Jev, and hand only winning angles to a human for a creative/ads brief
  (read-only; never changes spend).
---
# Jev + Treg for ads intel

Read-only competitor and creative research. Output is a brief for the human; **never create, edit, pause, or fund campaigns**, never change budgets or bids.

## Treg endpoints to start from (check `catalog_get` for live price/params first)
- Meta ad library by keyword: `crawl4ai.meta-ads.library.search` (~$0.0017) or routed `treg.meta-ads.library.search`.
- Meta ads a Page runs: `scrapecreators.x.v1-facebook-adlibrary-company-ads` (~$0.0019) or routed `treg.meta-ads.library.advertiser`.
- TikTok ad library by keyword: `apify.tiktok-ads.library.search` (~$0.003); by company: `adyntel.tiktok-ads.library.search.company` (~$0.011, quote before looping).
- Organic proof for an angle: TikTok video search (see jev-treg-ecom-research).
Prices drift; the catalog is the truth, not this list.

## Best usage rules
- Same money rules as research: pilot, quote totals, running sum, cap, raw saved, idempotency keys, no blind retries of 4xx.
- Ad library results are what's *running*, not what's *profitable*. Longevity (days active, still active, number of variants of the same creative) is the best free proxy for a winner; say it is a proxy.
- No spend, ROAS, CTR or CPM numbers exist in ad libraries unless the provider returns them; never estimate them.

## Jev gate per ad (batch ~25, concurrency ~4)
- `choice` hook type: problem_solution / demo / unboxing / ugc_testimonial / offer_discount / comparison / lifestyle / other.
- `choice` format: video_ugc / video_studio / static / carousel.
- `choice` offer: discount / bundle / free_shipping / none.
- `score` 0–4 relevance to our product/niche (drop < 2 before any deep read).
Keep probabilities; low-confidence rows go to `needs_review`.

## Recipe
1. Inputs: our product + 3–5 niche keywords + known competitor Pages/brands.
2. Treg: keyword search on Meta + TikTok ad libraries, then advertiser pulls for the top recurring advertisers.
3. Normalize to `ads.csv` (platform, advertiser, ad id, url/snapshot, start date, still active, days active, copy text, CTA, landing domain, variants count).
4. Jev gate (hook, format, offer, relevance).
5. Rank in code: relevance ≥ 3, then days active, then variants. Aggregate hooks × format: count and median days active.
6. Cross-check top hooks with organic TikTok engagement (ER) for the same niche.
7. Deliver: top 10 ads table with links, hook/format table, 3 angle recommendations with example copy for the human to test, caveats, Treg $ and Jev calls/time.
8. Stop. Anything that touches an ad account is the human's call.
