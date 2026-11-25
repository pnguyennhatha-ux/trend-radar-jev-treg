---
name: pod-niche-trend-flow
description: >-
  Use when researching POD printed t-shirt/hoodie niches on US
  marketplaces: pull Amazon keyword demand through Treg, measure
  per-platform social trends and comments with ScrapeCreators, filter
  relevance and IP risk with Jev, then write a design brief. Also use
  for the four-step niche flow (keywords, social listening, insight,
  design).
---
# POD niche trend flow (Treg + ScrapeCreators + Jev)

Four-step research flow for print-on-demand t-shirts / hoodies sold on US marketplaces (Amazon, and Etsy/eBay when those pulls actually return data).

Pattern: **Treg fetches marketplace demand, ScrapeCreators measures social platforms, Jev filters cheaply, code scores heat, the expensive agent only writes the insight and design brief.**

Companion skills: [jev-treg-ecom-research](../jev-treg-ecom-research/SKILL.md), [jev-treg-ads-intel](../jev-treg-ads-intel/SKILL.md), [scrapecreators-api](../scrapecreators-api/SKILL.md), [trend-discovery](../trend-discovery/SKILL.md), [comment-mining](../comment-mining/SKILL.md), [ad-library-teardown](../ad-library-teardown/SKILL.md), [product-demand-research](../product-demand-research/SKILL.md).

## Required secrets and connectors

- Treg MCP connector (catalog + live pulls). Do not print Treg tokens or route headers.
- `SCRAPECREATORS_API_KEY` — send only as the `x-api-key` header to `https://api.scrapecreators.com`. Get a key at https://scrapecreators.com.
- `TYPESAFE_API_KEY` — Jev / TypeSafe System One.

**Never echo, log, or commit these values.** Do not run `echo $SCRAPECREATORS_API_KEY`, `env | grep KEY`, or paste a key into a file, URL, or chat transcript. Write `raw/` response bodies only.

```bash
curl -s "https://api.scrapecreators.com/v1/account/credit-balance" \
  -H "x-api-key: $SCRAPECREATORS_API_KEY"
```

The working balance path is `/v1/account/credit-balance`. The path `/v1/credit/balance` (still listed in some upstream docs) returned 404 in testing.

## Cost guardrails

1. **Quote before you loop.** ScrapeCreators: most calls cost **1 credit**. Warn the human and wait for a yes before `/v1/tiktok/user/audience` (26 credits), `use_ai_as_fallback=true` (+10), or `get_ad_details=true` (25). Treg: `catalog_get` for live price, count calls × price, and tell the human if the expected total is over about $0.05 or any single call is over $0.01. Amazon bulk volume has been billed higher than the catalog quote — use the actual `cost_usd` from the response as the running total.
2. **Smoke test first.** One Treg call and one or two ScrapeCreators calls on a single seed keyword. Confirm the parse, then scale.
3. **Check balance first, keep a running sum, stop at the agreed cap.**
4. **Save every raw response** under `raw/` (Treg) and `raw/sc/` (ScrapeCreators) *before* parsing. Log endpoint, status, and credits/cost charged — never the key.
5. **4xx = fix the request, do not retry blindly.** 429/5xx = back off or switch Treg provider once. Empty-but-billed: switch provider once, don't loop.
6. Prefer 1-credit ScrapeCreators search endpoints. Skip or minimize calls that historically return nothing useful (see field notes).

## Field notes from the funny-dog apparel pilot (25 Nov 2026)

These are observations, not guarantees:

- `/v1/tiktok/hashtags/popular` returned **400** ("TikTok took this page down"). Use `/v1/tiktok/search/hashtag` and `/v1/tiktok/search/keyword` instead.
- `/v1/threads/search` returned **0 posts** for apparel queries. Do not spend many credits there until a pilot shows data.
- Pinterest and Meta ad-library payloads often **lack engagement fields**. Heat is then Recency + Relevance only (weights renormalized). Pinterest is still worth pulling for POD / gift positioning.
- Search results are noisy. Run a **Jev relevance (and IP/trademark) gate** before treating a post or ad as evidence. Off-niche advertisers show up in Meta results.
- YouTube Shorts often have **no reliable publish date** (`publishedTime` missing); recency on YouTube may be a subset of rows.
- TikTok US trending feed is useful as **context only**. In the pilot, 0 of 13 trending videos were on-niche apparel. Do not mix it into the niche TikTok heat.
- Date-filtered TikTok queries (for example `date_posted=this-month`) bias recency. The scorer excludes sources whose filename contains `_month` / `_week` from the recency share unless you pass `--include-all-recency`.
- Treg `tikhub.tiktok.search.videos` returned 400 in the pilot; a routed `treg.tiktok.search.videos` worked. Etsy search timed out twice — do not loop timeouts.
- A 6-platform ScrapeCreators pass was about **16 credits / 17 calls**. Keep pilots smaller.

## Step 1 — Marketplace demand (Treg)

Goal: what US shoppers are already searching for in this apparel niche.

1. Build 5–10 seed keywords (niche + shirt/hoodie/sweatshirt + funny/custom + gift/holiday variants).
2. Treg Amazon related-keyword suggestions per strong seed (`dataforseo` Amazon related keywords — confirm the live catalog id and price).
3. Jev-gate the combined keyword list (`relevant` / `needs_review` / `not_relevant`) so you do not pay volume on junk.
4. Treg Amazon bulk search volume (up to 1000 keywords per call). Record the actual `cost_usd`.
5. Optional: Google autocomplete for phrasing, and Etsy/eBay only if a *single* pilot call returns parseable data.
6. Write `keywords.csv` (keyword, volume, suggested-from, Jev label + confidence). Do not invent volume.

Follow the money and parse rules in [jev-treg-ecom-research](../jev-treg-ecom-research/SKILL.md).

## Step 2 — Per-platform social trends (ScrapeCreators)

Goal: what is actually circulating on each network, in the customer's words.

Default 1-credit set for a US apparel niche (region/country `US` where the endpoint supports it, `trim=true` when available):

| Platform | Endpoints | Notes |
|---|---|---|
| TikTok | `/v1/tiktok/search/keyword`, `/v1/tiktok/search/hashtag` | Optional context: `/v1/tiktok/get-trending-feed?region=US`. Skip `/v1/tiktok/hashtags/popular`. |
| Instagram | `/v2/instagram/reels/search` | |
| YouTube | `/v1/youtube/search` (`type=shorts` and `type=videos`), optional `/v1/youtube/search/hashtag` | Shorts may lack dates. |
| Pinterest | `/v1/pinterest/search` | High signal for POD/gifts; no engagement metrics. |
| Reddit | `/v1/reddit/search` (`sort=relevance`, `timeframe=year`) | Good for objections and exact language. |
| Meta ads | `/v1/facebook/adLibrary/search/ads` (`country=US`, `status=ACTIVE`) | What's running, not what's profitable. |
| Threads | `/v1/threads/search` | Pilot one query; stop if empty. |

Then, only on posts that already look on-niche:

- Comments: follow [comment-mining](../comment-mining/SKILL.md) on a short list of top posts (each call is typically 1 credit).
- Transcripts: follow [transcript-intelligence](../transcript-intelligence/SKILL.md) only if you need hooks/claims, and warn before `use_ai_as_fallback=true`.

Save raw JSON as `raw/sc/<platform>_<seed>.json` and append one line per call to `raw/sc/_calls.log` (timestamp, alias, path, HTTP status, `credits_charged` if present).

## Step 3 — Filter, merge, score

1. Normalize posts with `scripts/sc_analyze.py` (next to this skill). It writes `sc_posts.csv` and `sc_platform_summary.json` and prints a heat table.
2. Heat formula:

   `heat = 100 × (0.35·Recency + 0.35·Engagement + 0.30·Relevance) / (sum of weights that have data)`

   - Recency = 0.5·share(age ≤ 30d) + 0.5·share(age ≤ 90d)
   - Engagement = log10(1 + median metric) / log10(1 + cap), default caps views=100000, Reddit likes=1000
   - Relevance = share of posts matching **both** the product regex (shirt/hoodie) and `--niche-regex`
3. Jev-gate every remaining row in batches (~25, concurrency ~4, model `jev-latest`):

   - `choice` relevance: on_niche_apparel / adjacent / off_topic
   - `score` 0–4 purchase or gift intent
   - `choice` IP risk: clear / needs_review / likely_conflict (licensed characters, sports marks, celebrity likeness, trademarked slogans)
4. Drop `off_topic` and `likely_conflict` from the evidence set. Keep `needs_review` in a side list for the human.
5. Merge with Step 1: high Amazon volume + high social heat + clear IP = priority concept space. High volume + weak social = listing/SEO play. High social + low volume = content-led test, not a big inventory bet.
6. Write `insight_brief.md`: per-platform heat table, top motifs and hashtags, verbatim customer quotes, keyword table, caveats (missing fields, empty platforms, proxies).

```bash
python scripts/sc_analyze.py \
  --input-dir raw/sc \
  --output-dir out \
  --niche-regex 'YOUR_NICHE_TERMS' \
  --now 2026-11-25T00:00:00+00:00
```

`--now` is optional (defaults to current UTC). Pass `--motifs-json` to add niche-specific motif detectors. Pass `--exclude-advertisers` for known off-niche Meta page names after a spot check.

## Step 4 — Design brief

Hand the human a brief they can actually print, not a mood board.

For each of 3–5 concepts include:

- Working title and one-line hook, preferably using **verbatim** phrases from comments or transcripts
- Why now (keyword volume + platform heat + a cited post or ad)
- Art direction: print constraints (color count, placement, short text, no photoreal pet portrait unless it is a DTG/print play)
- Suggested colors / placement (chest typography vs large back print)
- Channels to test first (for example Pinterest + Amazon for gift/holiday, TikTok for humor)
- IP status from the Jev gate (only ship `clear`; flag the rest)
- A first listing title + 5 bullets in the customer's language

Stop. Do not publish listings, start ads, or spend money. Mockups only if the human asks.

## Anti-rules

- Never print secrets. Never invent search volume, engagement, or dates the API did not return.
- Do not call a single viral post a trend.
- Do not mix the general TikTok trending feed into the niche heat score.
- Ad library longevity is a proxy for a winner, not proof of ROAS. Never estimate CTR/CPM/ROAS.
- Public data only. No logged-in or private scraping.
