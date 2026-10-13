# Trend Radar manual

Short, plain, one line per thing. Start with [README.md](README.md) if you haven't set up yet.

## The panel

Open it with `/trend panel`. Four tabs and a Refresh button.

**Ideas**
- Top line: how many ideas, when, how many outliers and X posts were read, how many channels answered, the days looked back, and what the run cost.
- Pillar filter: show one pillar only.
- **+ Note:** a note for the next run only ("focus on Shorts"). Standing notes live in Setup.
- Each card: rank, pillar dot, sponsor angle, title, one line of why. The ring is the score out of 10.
- **Details** opens: why now, angle, four signal bars (YouTube proof, X buzz, fit, fresh), proof links with their multiples, and the thumbnails section.
- **☆ Save** makes the idea's folder. **Check** asks treg and Claude for a fresh verdict on that topic. **Script** drops a script request into the chat box. **🖼 Thumbnail** starts a thumbnail. **Skip** hides the card for this run.

**Saved**
- One compact card per idea folder, newest first. **Details** shows the proof links and the pictures. **🗑 Delete** asks first, then moves the folder to the Trash.

**Competitors**
- Add a channel by @handle or link. ✕ removes one.
- Open a channel for its outlier grid: every video from the last 60 days at 2.5x or more of its normal views, with real thumbnails. Sort by multiple, views or newest. **All 30** shows the whole recent list.

**Setup**
- The checklist, the guided setup button, presets, and every field: channel, audience, days back, ideas per run, standing notes, pillars, X keywords, sponsor types.
- **Thumbnails:** your photos (Open references folder), quality with its price, and an optional brand style line.

## How ideas are scored

- **Outlier:** a competitor video at 2.5x or more of that channel's normal (median) views, 3 to 60 days old. Above 100x is treated as paid promotion and ignored.
- **Signals:** YouTube proof (how many outliers back the idea), X buzz (fresh launch posts), fit (your pillars and audience), fresh (not already covered by you).
- "x" always means "times the channel's normal views".

## Thumbnails

1. Press 🖼 Thumbnail on an idea. The mod downloads the winning competitor thumbnails into the idea's folder.
2. Claude, in chat, looks at the winners and your photos and writes a brief: layout, your pose, the exact words, the object, the colours.
3. Change it by talking: "text in red", "hold a phone", "use my laptop photo". Drop extra images into the idea's `refs/` folder; Claude works them in.
4. Say **generate**. GPT Image 2.5 draws it through treg. If the photo upload host is down, Nano Banana 2 draws it instead.
5. The picture shows in the panel as a small tile. **🎨 Again** makes one more from the same brief. **✍️ Change** asks Claude to change the brief. Click a tile's label to open the full picture.

Files: `ideas/<date>-<title>/` holds `idea.md`, `brief.md`, `inspo/` (the winners), `refs/` (your extras), `thumbnails/` (`v1.png` and its prompt).

Your photos: 1 to 4 in `references/`. The first by name is the main face. No photo means a generic person.

## Settings fields

| Field | What |
|---|---|
| `channel` | your @handle |
| `audience` | who you make videos for |
| `pillars` | `"Name: what it covers"`, 2 to 4 |
| `competitors` | @handles, 5 or more |
| `xKeywords` | tools and brands whose launches matter to you |
| `sponsorTypes` | kinds of sponsors that fit you |
| `notes` | standing notes Claude weighs every run |
| `ideasCount` | 1 to 10 |
| `daysBack` | 1 to 90 |
| `thumbQuality` | `low` ~0.4¢, `medium` ~1¢, `high` ~3¢ |
| `thumbStyle` | optional brand style line for thumbnails |

Edit the file by hand, in the Setup tab, or by telling Claude. The panel picks up changes within a few seconds. Presets save and load the whole set.

## Costs

- A run: about 1.5 cents with 15 competitors (each channel scan about 0.1 cent, plus one X search), plus one Claude call.
- A topic check: about 0.3 cents.
- A thumbnail: about 1 cent at medium quality.
- The panel shows the real bill from your treg balance after each run.

## When something goes wrong

| It says | Do this |
|---|---|
| "Auto mode blocks mods" | Switch the mode picker under the chat box off Auto. |
| "treg is not connected" | [Sign up for treg](https://treg.to/?ref=cal-uhf7b), then Settings → Connectors → Add custom connector, URL `https://treg.to/mcp`, then Connect. |
| "treg's database pool is saturated" or a timeout | treg's side. The mod retries 3 times by itself. Wait a few minutes. |
| "upload failed" on a thumbnail | The 1-hour photo host was down; the mod drew with Nano Banana 2 instead. |
| "no brief.md yet" | Press 🖼 Thumbnail or ✍️ Brief in chat; say "generate" once the brief is done. |
| Tiles show "loading…" | Pictures are downloading. They arrive one by one. |
| Deleted a saved idea by mistake | It's in the Mac Trash. Put it back into `ideas/`. |

## Privacy

Your photos stay in your folder. When a thumbnail is drawn, a shrunk copy of each photo goes to a throwaway link that dies in an hour, because the image model needs a web address. Competitor thumbnails are cached in `.cache/`, safe to delete.

Made by [Calvin Hia](https://www.youtube.com/@calvinhia_ai).
