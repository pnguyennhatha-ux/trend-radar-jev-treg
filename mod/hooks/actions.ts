// What the panel buttons, /trend and the chat tool all do. No `$` here:
// each caller hands in a Ctx of closures over its own `$`.
import type { TrendChannel, TrendConfig, TrendHealth, TrendIdea, TrendIdeaDir, TrendInspo, TrendPreset, TrendRef, TrendReport, TrendThumbVersion } from '../types'
import { EMPTY_CONFIG, assemblePrompt, clamp, isConfigured, normalizeHandle, ytThumbUrl } from './lib'
import { runBrief, runCheck, tregServer, type Io } from './run'
import { download, makePreview, runThumbImage, type ThumbIo } from './thumbs'

export type Ctx = {
  io: ThumbIo
  dir: string
  readFile: (path: string) => Promise<string | null>
  writeFile: (path: string, text: string) => Promise<void>
  listDir: (path: string) => Promise<string[]>
  getChannels: () => Promise<TrendChannel[]>
  setConfig: (c: TrendConfig) => Promise<unknown>
  setReport: (r: TrendReport) => Promise<unknown>
  setChannels: (c: TrendChannel[]) => Promise<unknown>
  setChecks: (fn: (all: Record<string, string>) => Record<string, string>) => Promise<unknown>
  // The idea folders the panel shows; patched right away, re-scanned every few seconds anyway.
  setDirs: (fn: (all: TrendIdeaDir[]) => TrendIdeaDir[]) => Promise<unknown>
  setStatus: (s: string) => Promise<unknown>
  // Opens a file or folder in the Finder / its app.
  openPath: (path: string) => Promise<unknown>
  toast: (s: string) => void
}

let isBusy = false
export const busy = () => isBusy

export const settingsPath = (dir: string) => `${dir}/settings.json`

// The settings file, or an empty radar when it is missing or broken.
export async function loadConfig(ctx: Pick<Ctx, 'dir' | 'readFile'>): Promise<TrendConfig> {
  return parseConfig(await ctx.readFile(settingsPath(ctx.dir)))
}

export function parseConfig(text: string | null): TrendConfig {
  if (!text) return EMPTY_CONFIG
  try {
    const raw = JSON.parse(text)
    const list = (v: unknown, d: string[]) => (Array.isArray(v) ? v.map(String).filter(Boolean) : d)
    return {
      channel: String(raw.channel ?? EMPTY_CONFIG.channel),
      audience: String(raw.audience ?? EMPTY_CONFIG.audience),
      pillars: list(raw.pillars, EMPTY_CONFIG.pillars),
      competitors: list(raw.competitors, EMPTY_CONFIG.competitors).map(normalizeHandle).filter(Boolean),
      xKeywords: list(raw.xKeywords, EMPTY_CONFIG.xKeywords),
      sponsorTypes: list(raw.sponsorTypes, EMPTY_CONFIG.sponsorTypes),
      notes: list(raw.notes, []),
      ideasCount: clamp(Number(raw.ideasCount) || EMPTY_CONFIG.ideasCount, 1, 10),
      daysBack: clamp(Number(raw.daysBack) || EMPTY_CONFIG.daysBack, 1, 90),
      thumbQuality: raw.thumbQuality === 'low' || raw.thumbQuality === 'high' ? raw.thumbQuality : 'medium',
      thumbStyle: String(raw.thumbStyle ?? ''),
    }
  } catch {
    return EMPTY_CONFIG
  }
}

export async function saveConfig(ctx: Ctx, cfg: TrendConfig): Promise<void> {
  await ctx.writeFile(settingsPath(ctx.dir), `${JSON.stringify({ trendRadar: 1, ...cfg }, null, 2)}\n`)
  await ctx.setConfig(cfg)
}

async function guarded(ctx: Ctx, work: () => Promise<string>): Promise<string> {
  if (isBusy) return 'Trend Radar is already running. Watch the panel.'
  isBusy = true
  try {
    return await work()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await ctx.setStatus(`Failed: ${msg}`)
    return `Trend Radar failed: ${msg}`
  } finally {
    isBusy = false
  }
}

// `ideas` and `days` given here become the new defaults; `note` is for this run only.
export function brief(ctx: Ctx, opts: { ideas?: number; days?: number; note?: string } = {}): Promise<string> {
  return guarded(ctx, async () => {
    await ctx.setStatus('Starting brief…')
    let cfg = await loadConfig(ctx)
    if (!isConfigured(cfg)) throw new Error('your radar is not set up yet. Type /trend setup.')
    if (opts.ideas || opts.days) {
      cfg = { ...cfg, ideasCount: opts.ideas ?? cfg.ideasCount, daysBack: opts.days ?? cfg.daysBack }
      await saveConfig(ctx, cfg)
    }
    const done = await runBrief(ctx.io, cfg, opts.note ?? '')
    await ctx.setReport(done.report)
    await ctx.setChannels(done.channels)
    await ctx.writeFile(`${ctx.dir}/reports/${done.report.at.replace(/[:.]/g, '-')}.json`, JSON.stringify(done.report, null, 2))
    await ctx.setStatus('')
    ctx.toast(`Trend Radar: ${done.report.ideas.length} ideas ready`)
    return `Done. ${done.report.ideas.length} ideas · last ${cfg.daysBack} days${opts.note ? ` · note: ${opts.note}` : ''}. See the Trend Radar panel.`
  })
}

export function check(ctx: Ctx, topic: string): Promise<string> {
  return guarded(ctx, async () => {
    await ctx.setStatus(`Checking "${topic}"…`)
    const cfg = await loadConfig(ctx)
    const done = await runCheck(ctx.io, cfg, topic, await ctx.getChannels())
    await ctx.setChecks(all => ({ ...all, [topic]: done.markdown }))
    await ctx.setStatus('')
    return `Checked "${topic}". The verdict is in the Trend Radar panel.\n\n${done.markdown}`
  })
}

// Instant: it saves the handle. Stats fill in on the next refresh.
export async function addCompetitor(ctx: Ctx, raw: string): Promise<string> {
  const handle = normalizeHandle(raw)
  if (!handle) return 'Give a channel handle, like @nateherk.'
  const cfg = await loadConfig(ctx)
  if (cfg.competitors.includes(handle)) return `${handle} is already on the list.`
  await saveConfig(ctx, { ...cfg, competitors: [...cfg.competitors, handle] })
  return `✓ Added ${handle}. Its stats show after the next ↻ Refresh.`
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'idea'
}

// ── idea folders: ideas/<date>-<slug>/ ──
// idea.md · brief.md · meta.json · inspo/ · refs/ · thumbnails/

const IMAGE_FILE = /\.(jpe?g|png|webp)$/i

export function ideaMarkdown(idea: TrendIdea, at: string): string {
  return `# ${idea.title}

- **Pillar:** ${idea.pillar}
- **Score:** ${idea.score}/10
- **Sponsor angle:** ${idea.sponsor}
- **Saved:** ${at.slice(0, 10)}

## Why now
${idea.whyNow}

## Angle
${idea.angle}

## Proof
${idea.proof.map(p => `- [${p.label}](${p.url})${p.multiple ? ` · ${p.multiple}x` : ''}`).join('\n') || '- none'}
`
}

type Meta = { title: string; slug: string; at: string; status: string; note: string; inspo: TrendInspo[]; versions: TrendThumbVersion[] }

async function readMeta(ctx: Pick<Ctx, 'readFile'>, path: string): Promise<Meta | null> {
  try {
    const raw = JSON.parse((await ctx.readFile(`${path}/meta.json`)) ?? 'null')
    if (!raw || typeof raw !== 'object') return null
    return {
      title: String(raw.title ?? ''), slug: String(raw.slug ?? ''), at: String(raw.at ?? ''), status: String(raw.status ?? ''), note: String(raw.note ?? ''),
      inspo: Array.isArray(raw.inspo) ? raw.inspo : [], versions: Array.isArray(raw.versions) ? raw.versions : [],
    }
  } catch {
    return null
  }
}

async function writeMeta(ctx: Ctx, path: string, meta: Meta): Promise<void> {
  await ctx.writeFile(`${path}/meta.json`, `${JSON.stringify(meta, null, 2)}\n`)
  const entry = await readDir(ctx, path.split('/').pop()!)
  if (entry) await ctx.setDirs(all => [entry, ...all.filter(d => d.path !== path)].sort((a, b) => b.name.localeCompare(a.name)))
}

// One folder as the panel sees it, or null when it is not an idea folder.
export async function readDir(ctx: Pick<Ctx, 'dir' | 'readFile' | 'listDir'>, name: string): Promise<TrendIdeaDir | null> {
  const path = `${ctx.dir}/ideas/${name}`
  const meta = await readMeta(ctx, path)
  const ideaText = await ctx.readFile(`${path}/idea.md`)
  if (!meta && !ideaText) return null
  const title = meta?.title || (ideaText ?? '').split('\n')[0]?.replace(/^#\s*/, '') || name
  const refs = (await ctx.listDir(`${path}/refs`)).filter(n => IMAGE_FILE.test(n) && !n.startsWith('.')).sort()
  return {
    name, path,
    slug: meta?.slug || name.replace(/^\d{4}-\d{2}-\d{2}-/, ''),
    title,
    at: meta?.at || `${name.slice(0, 10)}T00:00:00.000Z`,
    status: meta?.status ?? '',
    note: meta?.note ?? '',
    brief: (await ctx.readFile(`${path}/brief.md`)) ?? '',
    refs,
    inspo: meta?.inspo ?? [],
    versions: meta?.versions ?? [],
  }
}

export async function scanDirs(ctx: Pick<Ctx, 'dir' | 'readFile' | 'listDir'>): Promise<TrendIdeaDir[]> {
  const names = (await ctx.listDir(`${ctx.dir}/ideas`)).filter(n => !n.startsWith('.'))
  const all = await Promise.all(names.map(n => readDir(ctx, n)))
  return all.filter((d): d is TrendIdeaDir => !!d).sort((a, b) => b.name.localeCompare(a.name))
}

export const dirFor = (dirs: TrendIdeaDir[], idea: TrendIdea): TrendIdeaDir | undefined => dirs.find(d => d.slug === slug(idea.title))

// The competitor thumbnails behind an idea: its proof videos' public YouTube pictures.
export function inspoFor(idea: TrendIdea): TrendInspo[] {
  return idea.proof
    .map((p, i) => ({ label: p.label, url: p.url, thumb: ytThumbUrl(p.url), file: `inspo/${String(i + 1).padStart(2, '0')}-${slug(p.label)}.jpg`, multiple: p.multiple }))
    .filter(i => i.thumb)
    .slice(0, 3)
}

// The idea's folder, made on first touch (Save or Thumbnail).
export async function ensureDir(ctx: Ctx, idea: TrendIdea, dirs: TrendIdeaDir[]): Promise<TrendIdeaDir> {
  const found = dirFor(dirs, idea)
  if (found) return found
  const at = new Date().toISOString()
  const name = `${at.slice(0, 10)}-${slug(idea.title)}`
  const path = `${ctx.dir}/ideas/${name}`
  await ctx.writeFile(`${path}/idea.md`, ideaMarkdown(idea, at))
  await ctx.writeFile(`${path}/refs/.keep`, '')
  await writeMeta(ctx, path, { title: idea.title, slug: slug(idea.title), at, status: '', note: '', inspo: inspoFor(idea), versions: [] })
  return (await readDir(ctx, name))!
}

export async function saveIdea(ctx: Ctx, idea: TrendIdea, dirs: TrendIdeaDir[]): Promise<string> {
  const d = await ensureDir(ctx, idea, dirs)
  ctx.toast(`⭐ Saved to ideas/${d.name}`)
  return d.path
}

// ── thumbnails ──

// The photos in references/, in name order. The first is the main face.
export async function listReferences(ctx: Pick<Ctx, 'dir' | 'listDir'>): Promise<TrendRef[]> {
  const dir = `${ctx.dir}/references`
  return (await ctx.listDir(dir)).filter(n => IMAGE_FILE.test(n) && !n.startsWith('.')).sort().map(name => ({ name, path: `${dir}/${name}` }))
}

let thumbBusy = ''
export const thumbRunning = () => thumbBusy

async function patchMeta(ctx: Ctx, d: TrendIdeaDir, fn: (m: Meta) => Meta): Promise<Meta> {
  const cur = (await readMeta(ctx, d.path)) ?? { title: d.title, slug: d.slug, at: d.at, status: '', note: '', inspo: d.inspo, versions: d.versions }
  const next = fn(cur)
  await writeMeta(ctx, d.path, next)
  return next
}

// Step 1: the folder, the winners' pictures in inspo/, then Claude in chat writes brief.md.
// Answers the folder, so the caller can hand the brief to chat.
export async function thumbStart(ctx: Ctx, idea: TrendIdea, dirs: TrendIdeaDir[]): Promise<TrendIdeaDir> {
  const d = await ensureDir(ctx, idea, dirs)
  await patchMeta(ctx, d, m => ({ ...m, status: 'Fetching the winning thumbnails…' }))
  const inspo = d.inspo.length ? d.inspo : inspoFor(idea)
  const got: TrendInspo[] = []
  for (const i of inspo) {
    const out = `${d.path}/${i.file}`
    await ctx.writeFile(`${d.path}/inspo/.keep`, '')
    if (await download(ctx.io, i.thumb, out)) got.push(i)
  }
  await patchMeta(ctx, d, m => ({ ...m, inspo: got, status: "Brief in chat: read it there, then say generate." }))
  return (await readDir(ctx, d.name))!
}

export async function thumbNote(ctx: Ctx, d: TrendIdeaDir, note: string): Promise<void> {
  await patchMeta(ctx, d, m => ({ ...m, note: note.trim() }))
}

// Step 2: the picture, from brief.md plus the person's photos, refs/ and inspo/.
export async function thumbGenerate(ctx: Ctx, d: TrendIdeaDir): Promise<string> {
  if (thumbBusy) return 'A thumbnail is already in progress. Watch the panel.'
  thumbBusy = d.path
  try {
    const cfg = await loadConfig(ctx)
    const brief = (await ctx.readFile(`${d.path}/brief.md`)) ?? ''
    if (!brief.trim()) throw new Error('there is no brief.md yet. Ask Claude in chat to write it.')
    const meta = await patchMeta(ctx, d, m => ({ ...m, status: 'Starting…' }))
    const people = (await listReferences(ctx)).map(r => r.path)
    const extras = (await ctx.listDir(`${d.path}/refs`)).filter(n => IMAGE_FILE.test(n) && !n.startsWith('.')).sort()
    const inspo = meta.inspo.map(i => `${d.path}/${i.file}`)
    const prompt = assemblePrompt(brief, people.length, extras, inspo.length, meta.note, cfg.thumbStyle)
    const n = meta.versions.length + 1
    const outPath = `${d.path}/thumbnails/v${n}.png`
    await ctx.writeFile(`${d.path}/thumbnails/.tmp/.keep`, '')
    await ctx.writeFile(`${d.path}/thumbnails/v${n}-prompt.txt`, `${prompt}\n`)
    const made = await runThumbImage(ctx.io, { cfg, prompt, images: [...people, ...extras.map(e => `${d.path}/refs/${e}`), ...inspo], tmpDir: `${d.path}/thumbnails/.tmp`, outPath })
    await makePreview(ctx.io, outPath, `${d.path}/thumbnails/v${n}.preview.jpg`)
    await patchMeta(ctx, d, m => ({
      ...m,
      status: made.fallbackWhy ? `GPT Image was not reachable (${made.fallbackWhy.slice(0, 80)}), so Nano Banana 2 drew it.` : '',
      versions: [...m.versions, { path: outPath, model: made.model, at: new Date().toISOString(), costUsd: made.costUsd }],
    }))
    await ctx.setStatus('')
    ctx.toast(`🖼 Thumbnail v${n} ready (${made.model})`)
    return `Thumbnail v${n} saved at ${outPath} (${made.model}, $${made.costUsd.toFixed(3)}).`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await patchMeta(ctx, d, m => ({ ...m, status: `Failed: ${msg}` }))
    await ctx.setStatus('')
    return `Thumbnail failed: ${msg}`
  } finally {
    thumbBusy = ''
  }
}

// Moves a file or folder to the Mac's Trash (never a hard delete).
export async function trashPath(ctx: Pick<Ctx, 'io'>, path: string): Promise<string> {
  const quoted = path.replace(/"/g, '\\"')
  const r = await ctx.io.run(['osascript', '-e', `tell application "Finder" to delete POSIX file "${quoted}"`], { timeoutMs: 20_000 })
  return r.exitCode === 0 ? '' : `Could not move it to the Trash: ${r.stderr.slice(0, 120)}`
}

export async function trashDir(ctx: Ctx, d: TrendIdeaDir): Promise<string> {
  const why = await trashPath(ctx, d.path)
  if (why) return why
  await ctx.setDirs(all => all.filter(x => x.path !== d.path))
  ctx.toast(`🗑 ${d.title} moved to the Trash`)
  return `Moved ideas/${d.name} to the Trash.`
}

// ── presets: saved settings files in presets/ ──

export async function listPresets(ctx: Pick<Ctx, 'dir' | 'listDir' | 'readFile'>): Promise<TrendPreset[]> {
  const names = (await ctx.listDir(`${ctx.dir}/presets`)).filter(n => n.endsWith('.json')).sort()
  return Promise.all(names.map(async file => {
    let name = file.replace(/\.json$/, '')
    try {
      name = String(JSON.parse((await ctx.readFile(`${ctx.dir}/presets/${file}`)) ?? '{}').name ?? name)
    } catch {}
    return { file, name }
  }))
}

export async function savePreset(ctx: Ctx, name: string): Promise<string> {
  const clean = name.trim()
  if (!clean) return 'Give the preset a name.'
  const cfg = await loadConfig(ctx)
  const file = `${slug(clean)}.json`
  await ctx.writeFile(`${ctx.dir}/presets/${file}`, `${JSON.stringify({ trendRadarPreset: 1, name: clean, ...cfg }, null, 2)}\n`)
  return `✓ Saved preset "${clean}" (presets/${file})`
}

export async function deletePreset(ctx: Ctx, file: string): Promise<string> {
  const why = await trashPath(ctx, `${ctx.dir}/presets/${file}`)
  return why || `✓ Preset ${file.replace(/\.json$/, '')} moved to the Trash`
}

export async function loadPreset(ctx: Ctx, file: string): Promise<string> {
  const text = await ctx.readFile(`${ctx.dir}/presets/${file}`)
  if (!text) return `✕ presets/${file} is gone.`
  const cfg = parseConfig(text)
  await saveConfig(ctx, cfg)
  return `✓ Loaded preset ${file.replace(/\.json$/, '')}`
}

// treg: is it connected, and may this mod call it? One free call answers both.
export async function checkTreg(io: Io): Promise<TrendHealth> {
  let server: string
  try {
    server = await tregServer(io)
  } catch {
    return { treg: 'missing', why: 'treg is not connected to Claude yet.' }
  }
  try {
    const r = await io.mcpCall(server, 'balance', {})
    if (r.isError) return { treg: 'error', why: (r.content ?? []).map(c => c.text ?? '').join('').slice(0, 160) }
    return { treg: 'ok', why: '' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return msg.includes('classifier')
      ? { treg: 'blocked', why: 'Auto mode blocks mods. Switch the mode picker to Ask permissions.' }
      : { treg: 'error', why: msg.slice(0, 160) }
  }
}
