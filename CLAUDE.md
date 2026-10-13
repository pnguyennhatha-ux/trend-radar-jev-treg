# Trend Radar

This folder is Trend Radar. It finds what to make next on YouTube, with proof, and makes the thumbnail. treg supplies the data, a Claude Code mod draws the panel. Made by Calvin Hia (https://www.youtube.com/@calvinhia_ai).

If treg is not connected yet, point them to [Sign up for treg](https://treg.to/?ref=cal-uhf7b) and Settings → Connectors → Add custom connector with URL `https://treg.to/mcp`, then Connect. Start here: README.md (5 steps) and MANUAL.md (everything else).

## What's in here
- `settings.json`: who this radar works for. It holds the channel, audience, pillars, competitors (YouTube @handles), X keywords to watch for launches, sponsor types, `notes` (standing notes Claude weighs on every run), `ideasCount` (1–10) and `daysBack` (1–90). The mod reads it on every run, and re-reads it within a few seconds after you edit it.
- `ideas/<date>-<slug>/`: one folder per idea the person touched (⭐ Save or 🖼 Thumbnail). Inside: `idea.md` (the idea, angle, proof), `brief.md` (the thumbnail prompt, written by Claude in chat, editable), `meta.json`, `inspo/` (the winning competitor thumbnails), `refs/` (extra images the person drops in), `thumbnails/` (`vN.png`, `vN-prompt.txt`, `vN.preview.jpg`). Untouched ideas stay in `reports/` only.
- `reports/`: every `/trend` run, kept as JSON. Used for history; nobody needs to read these.
- `presets/`: saved setups (same fields as settings.json, plus `name` and `"trendRadarPreset": 1`). Loading one copies it into settings.json.
- `references/`: 1 to 4 photos of the person, for thumbnails. The first by name is the main face. Empty means thumbnails show a generic person.
- `.cache/yt/`: competitor thumbnails the panel downloaded to show in tiles. Safe to delete.
- `mod/`: the mod's code: the `/trend` command, the Trend Radar panel, and the `mcp__trend-radar__run` tool.

## How to help the person
- **Changing the setup** ("add @x to competitors", "change pillar 2", "watch Sora on X"):
  - Edit `settings.json` directly, keeping it valid JSON and keeping `"trendRadar": 1`.
  - Competitors are YouTube handles that start with `@`.
  - Pillars read `"Name: what it covers"`.
  - "add a note: …" goes into `notes`.
  - Confirm in one line. The panel picks up the change by itself.
- **New person / empty radar:** `/trend setup` starts a guided setup that follows `mod/SETUP.md`.
- **Getting ideas:** tell them to type `/trend` (the 5-idea brief), or `/trend check <topic>` to check one idea. Or call the `mcp__trend-radar__run` tool, passing a `topic` to check one idea.
- **Writing from a saved idea:** read `ideas/<folder>/idea.md`, and use its angle and proof links.
- **Thumbnails:** the person presses 🖼 Thumbnail on an open idea card. The mod makes the idea folder, downloads the winners into `inspo/`, then asks you in chat to write the brief, following `mod/THUMBNAIL.md` (look at the pictures first). The brief lives in chat and in `brief.md`; they ask for changes here, and when they say "generate" you call the `mcp__trend-radar__thumbnail` tool with the folder name. The panel shows only the pictures, with 🎨 Again and ✍️ Change. Photos of them go in `references/`; if they name a photo in chat, copy it there. `thumbQuality` and `thumbStyle` in settings.json tune it.
- **If a run fails with "auto mode blocks mods"**, the fix is to switch the mode picker out of Auto.
- Keep answers short and plain; the person is busy.
