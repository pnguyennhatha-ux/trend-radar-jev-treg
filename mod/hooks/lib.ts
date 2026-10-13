// Pure helpers: no `$`, so tests can run them directly.
import type { TrendConfig, TrendIdea, TrendProof } from '../types'

// A fresh radar watches nothing. `/trend setup` or a preset fills it in.
export const EMPTY_CONFIG: TrendConfig = {
  channel: '', audience: '', pillars: [], competitors: [], xKeywords: [], sponsorTypes: [],
  notes: [], ideasCount: 5, daysBack: 60, thumbQuality: 'medium', thumbStyle: '',
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(Math.round(n), lo), hi)

export type TrendArgs =
  | { kind: 'brief'; ideas?: number; days?: number; note: string }
  | { kind: 'check'; topic: string }
  | { kind: 'setup' | 'panel' }
  | { kind: 'add'; handle: string }

// "/trend 8 ideas 21 days · focus on Shorts" and friends. Words that are not a count,
// a window or a command become a one-off note, so "/trend this week" still runs the brief.
export function parseArgs(raw: string): TrendArgs {
  const arg = raw.trim()
  if (/^setup$/i.test(arg)) return { kind: 'setup' }
  if (/^panel$/i.test(arg)) return { kind: 'panel' }
  if (/^add\s+/i.test(arg)) return { kind: 'add', handle: arg.replace(/^add\s+/i, '') }
  if (/^check\s+/i.test(arg)) return { kind: 'check', topic: arg.replace(/^check\s+/i, '').trim() }
  const [head = '', ...rest] = arg.split(/\s*(?:·|\||—|--|note:)\s*/i)
  let left = head
  let ideas: number | undefined
  let days: number | undefined
  left = left.replace(/(\d+)\s*ideas?\b/i, (_, n) => { ideas = clamp(Number(n), 1, 10); return ' ' })
  left = left.replace(/(\d+)\s*(days?|d)\b/i, (_, n) => { days = clamp(Number(n), 1, 90); return ' ' })
  left = left.replace(/(\d+)\s*weeks?\b/i, (_, n) => { days = clamp(Number(n) * 7, 1, 90); return ' ' })
  const note = [left, ...rest].map(t => t.trim()).filter(Boolean).join(' · ')
  return { kind: 'brief', ideas, days, note }
}

export type SetupStep = { key: string; label: string; isDone: boolean }

// The checklist the Setup tab shows. treg is checked separately (it needs a live call).

// What /trend setup prints for the first unfinished step. The person answers in chat; Claude takes it from there.
const SETUP_OPENERS: Record<string, string> = {
  channel: "What's your YouTube channel? (@handle or link)",
  audience: 'Who do you make videos for? One line is enough.',
  pillars: 'What are your 2 to 4 pillars, the topics you keep coming back to? (Ask me if you want ideas.)',
  competitors: 'Which channels are in your lane? Give me 5 or more @handles. (Ask me if you want me to search.)',
  xKeywords: 'Which brands, tools or models launch things in your niche? A few names is enough.',
  sponsorTypes: 'What kinds of sponsors fit you?',
}
const SETUP_NAMES: Record<string, string> = {
  channel: 'your channel', audience: 'your audience', pillars: 'pillars', competitors: 'competitors', xKeywords: 'X keywords', sponsorTypes: 'sponsor types',
}
export const SETUP_DONE_OPENER = 'Everything is filled in. Say "check it" and I\'ll read it back to you, or type /trend for your first ideas.'

export type SetupResume = { filled: string[]; missing: string[]; next: string | null; opener: string; said: string }

// Where setup stands: which fields are filled, which is next, and the line the command prints for it.
export function setupResume(cfg: TrendConfig): SetupResume {
  const steps = setupSteps(cfg)
  const filled = steps.filter(s => s.isDone).map(s => s.key)
  const missing = steps.filter(s => !s.isDone).map(s => s.key)
  const next = missing[0] ?? null
  const opener = (next && SETUP_OPENERS[next]) || SETUP_DONE_OPENER
  const have = filled.map(k => SETUP_NAMES[k])
  const haveLine = have.length === 0 ? '' : have.length === steps.length ? '' : `You have ${have.length === 1 ? have[0] : `${have.slice(0, -1).join(', ')} and ${have[have.length - 1]}`}. Next: `
  return { filled, missing, next, opener, said: `treg is connected. ${haveLine}${opener}` }
}

export function setupSteps(cfg: TrendConfig): SetupStep[] {
  return [
    { key: 'channel', label: 'Your channel', isDone: cfg.channel.length > 1 },
    { key: 'audience', label: 'Your audience', isDone: cfg.audience.length > 2 },
    { key: 'pillars', label: 'Pillars (2+)', isDone: cfg.pillars.length >= 2 },
    { key: 'competitors', label: 'Competitors (5+)', isDone: cfg.competitors.length >= 5 },
    { key: 'xKeywords', label: 'X keywords', isDone: cfg.xKeywords.length >= 1 },
    { key: 'sponsorTypes', label: 'Sponsor types', isDone: cfg.sponsorTypes.length >= 1 },
  ]
}

export const isConfigured = (cfg: TrendConfig) => setupSteps(cfg).every(s => s.isDone)

export function normalizeHandle(raw: string): string {
  const s = raw.trim().replace(/^(https?:\/\/)?(www\.|m\.)?youtube\.com\//, '').replace(/\/.*$/, '')
  if (!s) return ''
  return s.startsWith('@') || s.startsWith('UC') ? s : `@${s}`
}

export type VideoRow = { title: string; views: number; published: string; url: string; thumbnail?: string }
export type Video = VideoRow & { channel: string; ageDays: number; multiple: number }

const UNIT_DAYS: Record<string, number> = {
  second: 0, minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365,
}

// "3 days ago", "1 month ago", "20 hours ago" -> days
export function ageInDays(published: string): number {
  const m = /(\d+)\s+(second|minute|hour|day|week|month|year)/.exec(published ?? '')
  if (!m) return 999
  return Number(m[1]) * (UNIT_DAYS[m[2] ?? ''] ?? 0)
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

// Every video with its multiple of the channel's median views.
export function scoreChannel(channel: string, rows: VideoRow[]): { median: number; videos: Video[] } {
  const clean = rows.filter(r => typeof r.views === 'number' && r.title)
  const med = median(clean.map(r => r.views))
  const videos = clean.map(r => ({
    ...r,
    channel,
    ageDays: ageInDays(r.published),
    multiple: med > 0 ? Math.round((r.views / med) * 10) / 10 : 0,
  }))
  return { median: med, videos }
}

// Proven hits (>= 2.5x, 3-60 days old) and fresh risers (< 3 days, >= 1.5x).
// Above 100x is almost always paid ads, so it is left out.
export function outliers(videos: Video[], daysBack = 60): { proven: Video[]; rising: Video[] } {
  const ok = videos.filter(v => v.multiple <= 100)
  return {
    proven: ok.filter(v => v.ageDays >= 3 && v.ageDays <= Math.max(daysBack, 3) && v.multiple >= 2.5),
    rising: ok.filter(v => v.ageDays < 3 && v.multiple >= 1.5),
  }
}

export function matchesTopic(title: string, topic: string): boolean {
  const words = topic.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const t = title.toLowerCase()
  return words.length > 0 && words.every(w => t.includes(w))
}

export type XPost = { author: string; text: string; likes: number; views: number; ageDays: number; url: string }

export function trimX(items: any[], nowSec: number): XPost[] {
  return (items ?? [])
    .filter(i => i && typeof i.text === 'string' && !i.isReply)
    .map(i => ({
      author: String(i.authorUsername ?? ''),
      text: String(i.text).replace(/\s+/g, ' ').slice(0, 240),
      likes: Number(i.likeCount ?? 0),
      views: Number(i.viewCount ?? 0),
      ageDays: Math.round(((nowSec - Number(i.createdUtc ?? nowSec)) / 86400) * 10) / 10,
      url: String(i.url ?? ''),
    }))
    .sort((a, b) => b.likes - a.likes)
}

export function isoDaysAgo(days: number, now = Date.now()): string {
  return new Date(now - days * 86400_000).toISOString().slice(0, 10)
}

export function xLaunchQuery(cfg: TrendConfig, since: string): string {
  const names = cfg.xKeywords.slice(0, 12).map(k => (k.includes(' ') ? `"${k}"` : k)).join(' OR ')
  return `(launched OR "just dropped" OR released OR "new model" OR announcing) (${names}) min_faves:300 since:${since}`
}

export function brandBrief(cfg: TrendConfig): string {
  return `You are the content strategist for the YouTube creator ${cfg.channel}.
Goal: grow views fast AND be valuable to sponsors.
Audience: ${cfg.audience}.
Pillars (number them 1..${cfg.pillars.length} in this order):
${cfg.pillars.map((p, i) => `  ${i + 1} ${p}`).join('\n')}
Sponsor categories worth aiming at: ${cfg.sponsorTypes.join(', ')}.
Market-proven formats: "AI replaces a paid tool for FREE"; "I tested X vs Y" where both BUILD the same thing; real-numbers case studies; "X will 10x your <tool>"; "Everything you know about X is outdated"; N mistakes/rules lists; fresh launch walkthroughs.
Weak formats: vague money promises, pure news recaps, generic advice.
Write in short, plain words. No hype filler.${cfg.notes.length ? `
The creator's standing notes (weigh these on every pick):
${cfg.notes.map(n => `  - ${n}`).join('\n')}` : ''}`
}

export function briefPrompt(data: unknown, pillarCount: number, count = 5, note = ''): string {
  return `DATA (JSON): competitor YouTube outliers ("proven" >=2.5x channel median, "rising" <3 days old), the creator's own recent titles, and top X posts about launches from the last 5 days:
${JSON.stringify(data)}

${note ? `NOTE FOR THIS RUN (weigh it heavily): ${note}\n\n` : ''}TASK: Pick the ${count} best video ideas for now. Rank them best first. Favour proof from several competitors, freshness on X, fit with a pillar, a proven format, and topics the creator has NOT already covered (check their titles). Use only URLs that appear in the data.

Answer with ONLY one JSON object, no prose, no code fence:
{"ideas":[{"title":"<video title in a proven format>","pillar":<1..${pillarCount}>,"score":<1-10>,"whyNow":"<one line with the proof: channels, multiples, X buzz>","angle":"<one line: what to show or build>","sponsor":"<one short sponsor category>","topic":"<2-4 word search topic>","noteFit":"<which note this idea serves, ≤8 words, or empty>","signals":{"youtube":<0-10 competitor proof>,"x":<0-10 buzz on X>,"fit":<0-10 fit with pillars and audience>,"fresh":<0-10 how new / not yet covered>},"proof":[{"label":"<channel or @author, ≤4 words>","url":"<url from data>"}]}],
 "freshOnX":[{"label":"<launch in ≤8 words>","url":"<url>"}],
 "skip":["<hot topic that does not fit, and why, ≤15 words>"]}
At most 3 proof links per idea, 3 freshOnX, 2 skip.`
}

export function checkPrompt(topic: string, data: unknown): string {
  return `TOPIC TO CHECK: "${topic}"
DATA (JSON): competitor YouTube videos whose titles match the topic (with multiple of that channel's median), the creator's own matching titles, top X posts on it from the last 14 days, and Google search volume:
${JSON.stringify(data)}

TASK: Is this worth a video right now? Be honest; little data is a signal too.

OUTPUT exactly this Markdown, nothing before or after:
**<🔥 HOT | 😐 MEH | 💀 DEAD>** · <x/10> · <pillar or "doesn't fit">

- <2-3 short bullets with numbers from the data>

**Best angle:** <one title>

**Proof:** <up to 3 markdown links>`
}

// Reads Claude's brief answer. Null when it is not the JSON asked for.
export function parseIdeas(text: string, pillars: string[], count = 5): { ideas: TrendIdea[]; freshOnX: TrendProof[]; skip: string[] } | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: any
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(raw?.ideas) || raw.ideas.length === 0) return null
  const links = (list: any): TrendProof[] =>
    (Array.isArray(list) ? list : [])
      .filter((p: any) => p && typeof p.url === 'string' && /^https?:\/\//.test(p.url))
      .map((p: any) => ({ label: String(p.label ?? 'link').slice(0, 40), url: p.url }))
      .slice(0, 3)
  const ideas = raw.ideas.slice(0, count).map((i: any, n: number) => {
    const p = Math.min(Math.max(Number(i.pillar) || 1, 1), Math.max(pillars.length, 1))
    return {
      id: `${Date.now().toString(36)}-${n}`,
      title: String(i.title ?? 'Untitled idea'),
      pillar: pillars[p - 1] ?? `Pillar ${p}`,
      score: Math.min(Math.max(Math.round(Number(i.score) || 0), 0), 10),
      whyNow: String(i.whyNow ?? ''),
      angle: String(i.angle ?? ''),
      sponsor: String(i.sponsor ?? ''),
      topic: String(i.topic ?? i.title ?? ''),
      noteFit: String(i.noteFit ?? ''),
      signals: {
        youtube: clamp(Number(i.signals?.youtube) || 0, 0, 10),
        x: clamp(Number(i.signals?.x) || 0, 0, 10),
        fit: clamp(Number(i.signals?.fit) || 0, 0, 10),
        fresh: clamp(Number(i.signals?.fresh) || 0, 0, 10),
      },
      proof: links(i.proof),
    }
  })
  return { ideas, freshOnX: links(raw.freshOnX), skip: (Array.isArray(raw.skip) ? raw.skip : []).map(String).slice(0, 2) }
}

// "Make content: Shorts, ..." -> "Make content"
export function pillarName(pillar: string): string {
  return pillar.split(':')[0]!.trim()
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(Math.round(n))
}

// ── thumbnails ──

// Price per picture, 16:9, through treg. Shown next to the Generate button.
export const THUMB_COST: Record<TrendConfig['thumbQuality'], string> = { low: '~0.4¢', medium: '~1¢', high: '~3¢' }

// The same lock for every person: it points at the photo, and names nobody.
export const THUMB_LOCK = `[Image 1] is the subject. Match this person exactly: face shape, eye shape, brows, nose, cheeks, jaw, skin tone, hair style and colour, any jewellery or glasses, and the clothing shown in the photo. Do not beautify, slim, sharpen the jaw, enlarge the eyes, change skin tone, or idealise. Likeness over looking good. Keep the face large and nothing covering it.`

// youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID -> ID
export function ytVideoId(url: string): string {
  const m = /(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/.exec(url ?? '')
  return m?.[1] ?? ''
}

// The public thumbnail of a YouTube video, or '' when the link is not a video.
export function ytThumbUrl(url: string): string {
  const id = ytVideoId(url)
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ''
}

// The images the model gets, in order: the person, extra references, then the winners.
// The brief (written in chat) describes the picture; this block says what each image is.
export function imageRoles(personCount: number, extraNames: string[], inspoCount: number): string {
  const lines: string[] = []
  let n = 1
  if (personCount > 0) {
    lines.push(THUMB_LOCK)
    if (personCount > 1) lines.push(`[Image 2]${personCount > 2 ? ` to [Image ${personCount}]` : ''}: the same person, more angles. Use them to get the face right.`)
    n = personCount + 1
  } else {
    lines.push('No photo of the creator was given. Draw a generic, friendly adult presenter, not a famous person.')
  }
  extraNames.forEach(name => {
    lines.push(`[Image ${n}]: ${name}, a reference the creator added. Use it as the brief says; if the brief does not mention it, use it exactly as shown, do not redraw it.`)
    n += 1
  })
  if (inspoCount > 0) {
    lines.push(`[Image ${n}]${inspoCount > 1 ? ` to [Image ${n + inspoCount - 1}]` : ''}: other creators' thumbnails that worked. Layout, energy and colour inspiration ONLY. Do not copy their faces, their text, or their logos.`)
  }
  return `=== REFERENCE IMAGES ===\n${lines.join('\n')}`
}

// The whole prompt: image roles, the brief from chat, the quick note, the closing rules.
export function assemblePrompt(brief: string, personCount: number, extraNames: string[], inspoCount: number, note: string, style: string): string {
  const body = brief.trim().replace(/^#\s.*\n/, '').trim()
  return `${imageRoles(personCount, extraNames, inspoCount)}
=== THE BRIEF ===
${body}${style ? `\nBrand style: ${style}.` : ''}${note ? `\n=== THE CREATOR'S NOTE (follow it over the brief where they differ) ===\n${note}` : ''}
=== FINAL ===
YouTube thumbnail, 16:9. One finished picture, no watermark, no video player chrome. Any text exactly as the brief spells it, bold and readable at phone size.${personCount > 0 ? ' Expression close to the reference photos. Likeness of the subject over aesthetic improvement.' : ''}`
}
