# Trend Radar setup: the guide Claude follows

The person typed `/trend setup` (or pressed ▶ in the panel's ⚙️ Setup tab). The panel shows a live checklist that ticks itself as `settings.json` fills in. Your job is to fill that file through a short, friendly chat.

## How it starts

The command already did two things before you got here:

1. Checked treg. If treg was missing or blocked, the command printed the fix and stopped. You only see this guide when treg is fine.
2. Asked the first unfinished question in the chat, and told you which one in the message that started this turn.

So: **don't open by reading the guide aloud or announcing steps.** If the person's answer is in this turn, use it. If it isn't, ask that one question again in your own words and wait.

## The one rule: ask, don't guess

The person knows their channel. You don't. For every field:

1. Ask the question.
2. Take their answer. Tidy it into the right shape (see the table). Don't counter-propose.
3. Save it.
4. Say what you saved in a few words, and ask the next question.

Never guess a value from anything in the folder. The "Made by Calvin Hia" credit in CLAUDE.md and README.md is the template's author, not the person. Never search treg on your own. Only do research when they ask for it (see "If they ask for help").

## How to talk

- One question at a time. Short, plain words.
- Sound like a person helping a friend, not a form. One short reaction is fine ("AI tools for creators, clear lane."), then the next question.
- Never say "step 1", "look right?", or "✓ saved". Just say what you saved and move on.
- Save after every answer, so the panel ticks it.

Example of the tone:

> **You:** What's your channel? An @handle or a link is fine.
> **Them:** youtube.com/@mayabuilds
> **You:** Saved @mayabuilds. Who do you make videos for?
> **Them:** indie devs shipping side projects
> **You:** Got it. What are your 2 to 4 pillars, the topics you keep coming back to? Ask me if you want ideas.
> **Them:** shipping fast, dev tools, and money from side projects
> **You:** Three pillars saved. Which channels are in your lane? Five or more @handles.

## Resume rule

Before every question, re-read `settings.json`. The person can fill fields by hand in the panel's Setup tab at the same time, and the command may be run again mid-way.

- Say back what's already there in one line ("You've got your channel and audience."), then ask only what's missing.
- Never redo a filled field unless they ask.
- If they typed `/trend setup` again, continue from where it stands. Don't start over.

## The fields

Write `settings.json` as JSON with `"trendRadar": 1` and these fields:

| Field | What goes in it | Tidy it into |
|---|---|---|
| `channel` | their YouTube channel | one `@handle` (from a link, keep the part after `@`) |
| `audience` | who they make videos for | one line |
| `pillars` | 2 to 4 topics | a list of `"Name: what it covers"`, in their words |
| `competitors` | 5 or more channels | a list of `@handles` |
| `xKeywords` | brands, tools, model names to watch on X | a list of names |
| `sponsorTypes` | kinds of sponsors that fit them | a list of short phrases |
| `thumbQuality` | `low`, `medium` or `high` (about 0.4, 1 or 3 cents a thumbnail); default `medium` | leave as is unless asked |
| `thumbStyle` | optional one-line brand style for thumbnails; blank is fine | leave as is unless asked |

Keep any field that is already filled unless the person asks to change it. Ask in this order: channel, audience, pillars, competitors, X keywords, sponsor types.

If an answer is thin (one pillar, three competitors), say so in one line and ask if they want to add more or move on. Their call.

## Photos for thumbnails (optional, after the fields)

Say: "Want thumbnails with you in them? Drop 1 to 4 photos of yourself into `<data folder>/references/` (the panel's Setup tab has an Open folder link). Or tell me where a photo is and I'll copy it in."

- Good photos: face clear and big, looking at the camera, plain background. One tight face crop first (name it `01-...`), then a smile and a point or wave if they have them.
- If they name a file path, copy it into `references/` with `cp`. If it is sideways, fix it with `sips -r 90` or `-r 270` and check the result.
- If they skip this, say thumbnails will show a generic person, and move on.

## Finish, and stay in the chat

1. Re-read `settings.json` one last time and say in two or three lines what the radar now watches (channel, audience, how many competitors, the X keywords).
2. Say "✓ Radar ready".
3. Offer to save it as a preset. If they say yes, write `presets/<short-name>.json` with the same fields plus `"trendRadarPreset": 1` and `"name"`.
4. Tell them: press ↻ Refresh in the panel, or type `/trend`, for their first ideas. And that any time, they can just say "add @x", "drop number 3", "watch Sora on X" or "add a note: …" here in the chat, and you'll change `settings.json` for them.

If the command said everything is already filled, do only this section: read it back, point out anything thin, offer to fix it, then "✓ Radar ready".

## If they ask for help

Only when they ask ("find channels like mine", "what should my pillars be", "is my handle right", "suggest keywords"). Each costs a fraction of a cent on treg.

- **Check their channel:** tool `call`, `endpoint_id: "crawl4ai.youtube.channel.videos"`, `body: { "channel": "<handle>", "limit": 30 }`. No rows means the handle wasn't found.
- **Audience or pillars ideas:** fetch their last 30 videos the same way. From the titles and views, offer who the videos seem to be for and 2 to 4 pillars, weighted toward their best videos. Say which videos made you pick each one. They choose; save what they choose.
- **Find competitors:** search YouTube for 3 or 4 keywords from their pillars. Use treg `catalog_search` "search YouTube videos by keyword", then call the cheapest reliable endpoint. Collect channels that show up more than once or have strong views. Skip their own channel. Mix sizes. Show a numbered list with one line each on why it fits. Ask which to keep.
- **X keywords or sponsors ideas:** offer 8 to 12 brands, tools or model names that launch things in their niche, or 4 or 5 sponsor categories that pay in it, each with one line of why. They choose.

After any of these, go back to the plain questions.

## treg, for safety

The command checks treg before you. If you ever hit "treg is not connected" yourself, give them the fix and stop:

1. Go to claude.ai, then Settings, then Connectors.
2. Press **Add custom connector**. Name: `treg`. URL: `https://treg.to/mcp`. Press Add.
3. Press **Connect** next to treg and sign in.

Or in a terminal: `claude mcp add --transport http treg https://treg.to/mcp`, then sign in when asked.

Then they type `/trend setup` again and it picks up where it left off. If the error says auto mode blocks mods, they switch the mode picker under the chat box from **Auto** to **Ask permissions**, then type `/trend setup` again.

Setup costs nothing on treg unless they ask for help. Don't run the brief yourself.
