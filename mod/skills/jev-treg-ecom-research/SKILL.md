---
name: jev-treg-ecom-research
description: >-
  Use when researching ecom products, trends, or keywords with live data (TikTok
  trending/product videos, search suggestions, Amazon search volume) by pulling
  data through Treg and gating/labeling it cheaply with Jev (TypeSafe System
  One) before any deep analysis.
---
# Jev + Treg for ecom research

Pattern: **Treg fetches, Jev judges, code ranks, the big agent only writes the brief.** Treg = paid live data (cents). Jev = cheap typed judgments (choice/score/noul) on every row. The expensive agent reads only the top slice.

## Best usage rules
1. **Ask for the job, not the provider.** `catalog_search` with task words ("tiktok search videos", "amazon search volume"), then `catalog_get` for params + exact price. Prefer routed `treg.*` tools; set `X-Treg-Route-Max-Cost` on bulk runs.
2. **Quote cost before loops.** Count calls × price, tell the human the expected total if it passes ~$0.05 or any single call > $0.01, keep a running sum of `cost_usd`, stop at the agreed cap.
3. **Pilot 1–2 calls, check the parse, then loop.** A parse bug throws away paid answers. Save every raw response to `raw/` before parsing.
4. **Use `idempotency_key` on calls you may repeat;** never re-send the same find. Repeat questions hit the cache at 10% price.
5. **Empty-but-billed:** some endpoints return 2xx with no data. Switch provider of the same job once, file `feedback`, don't loop.
6. **4xx = your request, fix it. 429/5xx = next provider.**
7. **Never invent metrics.** If an API returns 0/null (e.g. price, growth `hot_level`), say the field is missing; label any substitute as a proxy (e.g. "7-day views of newest 30 videos" for "rising").
8. Dedupe by stable id across queries; record which query found each row.

## Jev gate rules
- Batch ~25 items per `systemOne` call, concurrency ~4 (`mapPool`), model `jev-latest`, 1 retry then log failure.
- Per item ask at most 3 questions: a `choice` for type (product_video / decor_inspiration / other), a `choice` for category (closed list + `other`), a `score` 0–4 for purchase intent. Keep the closed lists short and described.
- Store probability/confidence with each label; treat p < 0.6 as `needs_review`.
- Jev tends to over-assign the positive class: spot-check 10 rows, and require a hard signal (Shop anchor, product in caption) before calling something a winner.
- Shadow mode by default: Jev labels, nothing irreversible happens. Escalate to the deep agent only rows that pass the gate.
- Log wall clock, calls, input/output tokens, failures in a run summary JSON. Don't print a Jev cost unless a real price constant exists.

## Recipe: TikTok trending products for a niche
1. Seeds: 5–10 niche queries (+ year, + "tiktok shop", + size/style variants).
2. Treg: search videos per seed (sort by likes/recent where supported; verify the param actually applied), plus search suggestions/autocomplete per seed, plus daily trending words.
3. Parse to `videos.csv` (id, url, author, followers, region, create_time local, plays, likes, comments, shares, saves, ER=(likes+comments+shares+saves)/plays, shop anchor ids/titles, query) and `suggestions.csv`.
4. Jev gate every video (type, category, intent).
5. Rank in code: product videos, target region, plays ≥ threshold, sort by ER; aggregate by category (count, median ER, total views, # with Shop).
6. Suggestions: rank by proxy (views of last 7 days) and by Shop-anchor share (seller saturation signal). High Shop share + low views = niche entry; high views + low Shop share = content gap.
7. Deliver: top table with links, category table, suggestion table, xlsx of all rows, 3–5 line insight, explicit caveats (proxies, missing fields, unverified params), Treg $ spent and Jev calls/time.

## Recipe: Amazon keyword volume check
- `dataforseo.x.dataforseo-labs-amazon-bulk-search-volume-live` takes up to 1000 keywords per call (~$0.012). Gate keyword relevance with Jev first (relevant / needs_review / not_relevant) so you only pay for relevant ones; join volume back onto the Jev decisions CSV.

## Anti-rules
- No SERP crawling if another bot owns it; no auto-publishing listings; no PPC/budget changes; human approves anything irreversible.
