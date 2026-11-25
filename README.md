<img src="mod/assets/logo.svg" width="72" alt="Trend Radar">

# Trend Radar

## Added in this fork: Jev + Treg + ScrapeCreators

This fork adds skills under `mod/skills/`. Install the plugin from *this* repository (not only from upstream `mrdainami/trend-radar-mod`) so Claude Code / Cursor can see them:

```
/plugin marketplace add pnguyennhatha-ux/trend-radar-jev-treg
/plugin install trend-radar@trend-radar-mod
```

### Jev + Treg

| Skill | What it does |
|---|---|
| [`jev-treg-ecom-research`](mod/skills/jev-treg-ecom-research/SKILL.md) | Pull TikTok trending/product videos, search suggestions and Amazon search volume through treg, label every row cheaply with TypeSafe Jev (System One), rank by engagement and TikTok Shop signals. |
| [`jev-treg-ads-intel`](mod/skills/jev-treg-ads-intel/SKILL.md) | Read-only competitor ad research from the Meta and TikTok ad libraries through treg, classified by Jev (hook, format, offer, relevance), ending in a creative brief for a human. Never touches ad accounts or spend. |

Pattern: treg fetches, Jev judges, code ranks, the expensive agent only writes the brief.

### ScrapeCreators social research

Thirteen workflow skills vendored from [ScrapeCreators/social-media-research-skills](https://github.com/ScrapeCreators/social-media-research-skills) (commit `64ba7b4`, MIT License — see `mod/skills/NOTICE-SCRAPECREATORS` and `mod/skills/LICENSE-MIT-SCRAPECREATORS`). Each skill folder also has its own `LICENSE`.

In `scrapecreators-api`, the credit-balance path is the working `/v1/account/credit-balance` (the upstream docs path `/v1/credit/balance` returned 404 in testing).

| Skill | Use it when you want to... |
|---|---|
| [`outlier-post-finder`](mod/skills/outlier-post-finder/SKILL.md) | Find posts that beat a creator's baseline |
| [`transcript-intelligence`](mod/skills/transcript-intelligence/SKILL.md) | Pull hooks, claims, and quotes from video transcripts |
| [`comment-mining`](mod/skills/comment-mining/SKILL.md) | Mine comments for questions, objections, and exact audience language |
| [`competitor-social-research`](mod/skills/competitor-social-research/SKILL.md) | Compare competitors' social strategy |
| [`ad-library-teardown`](mod/skills/ad-library-teardown/SKILL.md) | Tear down active Meta / Google / LinkedIn ads |
| [`trend-discovery`](mod/skills/trend-discovery/SKILL.md) | Find trending topics, hashtags, sounds, and formats in a niche |
| [`influencer-prospecting`](mod/skills/influencer-prospecting/SKILL.md) | Build creator prospect lists |
| [`audience-research`](mod/skills/audience-research/SKILL.md) | Judge audience fit from public profile signals |
| [`social-listening-brief`](mod/skills/social-listening-brief/SKILL.md) | Brief what people are saying about a brand or niche |
| [`product-demand-research`](mod/skills/product-demand-research/SKILL.md) | Validate a product idea from posts, comments, and Reddit |
| [`creator-profile-teardown`](mod/skills/creator-profile-teardown/SKILL.md) | Explain why a creator account works |
| [`content-repurposing`](mod/skills/content-repurposing/SKILL.md) | Turn social videos into posts, threads, or scripts |
| [`scrapecreators-api`](mod/skills/scrapecreators-api/SKILL.md) | Route a fetch to the right ScrapeCreators endpoint |

### Combined POD flow

| Skill | What it does |
|---|---|
| [`pod-niche-trend-flow`](mod/skills/pod-niche-trend-flow/SKILL.md) | Four-step flow for POD printed t-shirts and hoodies on US marketplaces: (1) Treg Amazon search volume and keyword suggestions, (2) ScrapeCreators per-platform social trends, comments, and Meta ads, (3) Jev relevance / IP filter plus a per-platform heat score, (4) a design brief. Includes `scripts/sc_analyze.py`. |

Heat score: `100 × (0.35·Recency + 0.35·Engagement + 0.30·Relevance)`, with missing components (Pinterest and Meta ads often have no engagement) dropped and weights renormalized.

### Environment and connectors

- **Treg:** Settings → Connectors → add `https://treg.to/mcp`, then sign in. Same setup as the original Trend Radar.
- **ScrapeCreators:** `export SCRAPECREATORS_API_KEY=...` (key from [scrapecreators.com](https://scrapecreators.com)). Send it only as the `x-api-key` header. Never print or commit the value.
- **Jev / TypeSafe:** `export TYPESAFE_API_KEY=...`. Never print or commit the value.

Most ScrapeCreators endpoints cost 1 credit. Warn before `/v1/tiktok/user/audience` (26 credits), `use_ai_as_fallback=true` (+10), or `get_ad_details=true` (25). Smoke-test one or two calls, save raw responses, and check `/v1/account/credit-balance` first.

### Tóm tắt (Tiếng Việt)

Fork này giữ nguyên Trend Radar gốc (ý tưởng YouTube + thumbnail) và thêm:

- Hai skill **Jev + Treg** để nghiên cứu ecom và quảng cáo (Treg lấy data, Jev gán nhãn rẻ, code xếp hạng).
- Mười ba skill **ScrapeCreators** để đo trend / comment / ads trên nhiều mạng xã hội (MIT, ghi rõ nguồn trong `NOTICE-SCRAPECREATORS`).
- Skill **`pod-niche-trend-flow`**: quy trình 4 bước cho áo thun / hoodie in (POD) trên sàn Mỹ — từ keyword Amazon, social listening từng nền tảng, lọc liên quan và rủi ro IP bằng Jev, đến design brief. Kèm script tính điểm nhiệt `sc_analyze.py`.

Cần Treg MCP, biến môi trường `SCRAPECREATORS_API_KEY` và `TYPESAFE_API_KEY`. Không được in hoặc commit các khóa này.

---

What to make next on YouTube, with proof. And the thumbnail.

Trend Radar watches your competitors, finds their videos that broke out, reads what just launched on X, and ranks 5 video ideas for you. Press one button more and it drafts a thumbnail with you in it. It runs inside Claude Code. The data comes through [treg](https://treg.to/?ref=cal-uhf7b): about 1 cent a run, about 1 cent a thumbnail.

## Set up in 5 steps

1. **Put this folder anywhere** and open it in Claude Code (the desktop app, or `claude` in a terminal inside the folder). Prefer to keep working in a bigger project? Then set the mod's **Trend Radar folder** setting to this folder (in `/config`, under the plugin's options). An opened radar folder always wins over that setting.
2. **Get treg.** [Sign up for treg](https://treg.to/?ref=cal-uhf7b), then in Claude go to Settings → Connectors → **Add custom connector**, name it `treg`, paste `https://treg.to/mcp` as the URL, press Add, then Connect and sign in.
3. **Install the mod.** In Claude, type these two lines, one after the other:
   ```
   /plugin marketplace add pnguyennhatha-ux/trend-radar-jev-treg
   /plugin install trend-radar@trend-radar-mod
   ```
   You get the `/trend` command, the Trend Radar panel, and this fork's extra skills. (Upstream only, without those skills: `mrdainami/trend-radar-mod`. Installing from a downloaded folder: use the folder's path in the first line.)
4. **Switch the mode picker off Auto** (under the chat box). Mods can't reach treg in Auto mode.
5. **Type `/trend setup`** and answer a few questions. Claude suggests your audience and pillars from your videos, finds 10 to 15 competitors, and asks for 1 to 4 photos of you for thumbnails. About 2 minutes, a few cents.

Then press **↻ Refresh** in the panel. Your first 5 ideas take about a minute.

## Every day after that

- **Ideas:** type `/trend`, or press Refresh. Open an idea for why now, the angle, and the proof.
- **Thumbnail:** open an idea, press 🖼 Thumbnail. Claude writes the brief in chat, you tweak it, say "generate". The picture lands in the panel and in the idea's folder.
- **Change anything by talking:** "add @channel to competitors", "note that I have a sponsor this month", "use this photo for thumbnails".

Everything else is in [MANUAL.md](MANUAL.md).

## What's in this folder

| | |
|---|---|
| `settings.json` | who this radar is for (setup fills it) |
| `references/` | your photos, for thumbnails |
| `ideas/` | one folder per idea you saved or made a thumbnail for |
| `presets/` | saved setups; one example included |
| `mod/` | the mod itself |

Made by [Calvin Hia](https://www.youtube.com/@calvinhia_ai). Version 1.0.0. Apache 2.0 license. Updates: `/plugin marketplace update trend-radar-mod`.
