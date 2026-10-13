import { atom, read, update } from 'claude-code'
import type { EngineInterface, Elements, Register } from 'claude-code'

import type { TrendChannel, TrendConfig, TrendHealth, TrendIdea, TrendIdeaDir, TrendPreset, TrendRef, TrendReport, TrendTab } from '../types'
import { addCompetitor, brief, busy, check, checkTreg, deletePreset, dirFor, listPresets, listReferences, loadConfig, loadPreset, saveConfig, saveIdea, savePreset, scanDirs, settingsPath, thumbGenerate, thumbRunning, thumbStart, trashDir, type Ctx } from './actions'
import { EMPTY_CONFIG, THUMB_COST, clamp, compact, isConfigured, normalizeHandle, parseArgs, pillarName, setupResume, setupSteps, ytVideoId } from './lib'
import { PILLAR_COLORS, bar, logo, previewImage, scoreColor, scoreRing, thumbTile } from './svg'

const PANE = 'trend-radar'
// The radar is the folder named in the mod's `folder` setting, else the folder opened in Claude Code,
// when it holds a settings.json with "trendRadar": 1.
const NO_DIR = 'Open your Trend Radar folder in Claude Code (the one with settings.json), or set the mod\'s "folder" setting to it.'
const KEYS = { channels: 'channels', skipped: 'skipped', checks: 'checks' }
const TREG_SIGNUP = 'https://treg.to/?ref=cal-uhf7b'
const MADE_BY = 'https://www.youtube.com/%40calvinhia_ai'
const REPO = 'https://github.com/mrdainami/trend-radar-mod'
let tregAsked = false
const VERSION = '1.0.0'

const report = atom({ plugin: 'trend-radar', key: 'report' } as const, null as TrendReport | null)
const status = atom({ plugin: 'trend-radar', key: 'status' } as const, '')
const tab = atom({ plugin: 'trend-radar', key: 'tab' } as const, 'ideas' as TrendTab)
const config = atom({ plugin: 'trend-radar', key: 'config' } as const, null as TrendConfig | null)
const channels = atom({ plugin: 'trend-radar', key: 'channels' } as const, [] as TrendChannel[])
const skipped = atom({ plugin: 'trend-radar', key: 'skipped' } as const, [] as string[])
const checks = atom({ plugin: 'trend-radar', key: 'checks' } as const, {} as Record<string, string>)
const openChannel = atom({ plugin: 'trend-radar', key: 'openChannel' } as const, '')
const notice = atom({ plugin: 'trend-radar', key: 'notice' } as const, '')
const health = atom({ plugin: 'trend-radar', key: 'health' } as const, { treg: 'unchecked', why: '' } as TrendHealth)
const presets = atom({ plugin: 'trend-radar', key: 'presets' } as const, [] as TrendPreset[])
const expanded = atom({ plugin: 'trend-radar', key: 'expanded' } as const, [] as string[])
const runNote = atom({ plugin: 'trend-radar', key: 'runNote' } as const, '')
const pillarFilter = atom({ plugin: 'trend-radar', key: 'pillarFilter' } as const, '')
const noteOpen = atom({ plugin: 'trend-radar', key: 'noteOpen' } as const, false)
const dirs = atom({ plugin: 'trend-radar', key: 'dirs' } as const, [] as TrendIdeaDir[])
const refs = atom({ plugin: 'trend-radar', key: 'refs' } as const, [] as TrendRef[])
const tick = atom({ plugin: 'trend-radar', key: 'tick' } as const, 0)
const vidSort = atom({ plugin: 'trend-radar', key: 'vidSort' } as const, 'multiple' as 'multiple' | 'newest' | 'views')
const vidAll = atom({ plugin: 'trend-radar', key: 'vidAll' } as const, false)
const savedOpen = atom({ plugin: 'trend-radar', key: 'savedOpen' } as const, [] as string[])
const confirmTrash = atom({ plugin: 'trend-radar', key: 'confirmTrash' } as const, '')
const editing = atom({ plugin: 'trend-radar', key: 'editing' } as const, '')

// Competitor thumbnails, cached as bytes: a drawing cannot load a web picture itself.
const picCache = new Map<string, string>()
const picPending = new Set<string>()
function fetchPic($: EngineInterface, dir: string, url: string): void {
  if (!url || picCache.has(url) || picPending.has(url)) return
  picPending.add(url)
  void (async () => {
    try {
      const id = ytVideoId(url) || url.replace(/[^a-z0-9]/gi, '').slice(-24)
      const path = `${dir}/.cache/yt/${id}.jpg`
      if (!(await $.fs.exists(path))) {
        await $.fs.write(`${dir}/.cache/yt/.keep`, '')
        const r = await $.process.run(['curl', '-sSL', '--max-time', '20', '-o', path, url], { timeoutMs: 25_000 })
        if (r.exitCode !== 0) throw new Error(r.stderr)
        await $.process.run(['sips', '-Z', '128', '-s', 'format', 'jpeg', '-s', 'formatOptions', '45', path, '--out', path], { timeoutMs: 20_000 })
      }
      const { base64 } = await $.fs.read(path, { as: 'bytes' })
      picCache.set(url, base64.length < 120_000 ? base64 : '')
    } catch {
      picCache.set(url, '')
    } finally {
      picPending.delete(url)
      await update($, tick, n => n + 1)
    }
  })()
}

// A local picture (a thumbnail preview) as base64, loaded once; '' while loading or when missing.
function loadPic($: EngineInterface, path: string): string {
  const got = picCache.get(path)
  if (got !== undefined) return got
  if (picPending.has(path)) return ''
  picPending.add(path)
  void (async () => {
    try {
      const { base64 } = await $.fs.read(path, { as: 'bytes' })
      picCache.set(path, base64.length < 120_000 ? base64 : '')
    } catch {
      picCache.set(path, '')
    } finally {
      picPending.delete(path)
      await update($, tick, n => n + 1)
    }
  })()
  return ''
}

const briefPrompt = (guide: string, dir: string, d: TrendIdeaDir) =>
  `Write the thumbnail brief for my idea "${d.title}". Follow the guide at ${guide}. Idea folder: ${d.path}. My photos: ${dir}/references. Write ${d.path}/brief.md.`

// The hidden message Claude gets once treg is fine. It carries where setup stands, so Claude resumes instead of restarting.
const setupPrompt = (guide: string, dir: string, r: ReturnType<typeof setupResume>) =>
  [
    `Run Trend Radar setup with me. Follow the guide at ${guide}. Data folder: ${dir}. Settings file: ${dir}/settings.json. treg check: ok.`,
    `Filled: ${r.filled.join(', ') || 'nothing yet'}. Missing: ${r.missing.join(', ') || 'nothing'}.`,
    r.next
      ? `The /trend setup command already asked me: "${r.opener}" If my answer is in this turn, use it and don't ask again. If it isn't, ask that one question in your own words and wait.`
      : 'Everything is filled. Review it with me: read settings.json, say what looks thin, offer fixes, then "✓ Radar ready" and /trend.',
  ].join(' ')

// What /trend setup prints when treg can't be used yet. Plain steps, no Claude turn needed.
const tregHelp = (t: TrendHealth): string => {
  if (t.treg === 'missing') return [
    'Setup stopped: treg is not connected to Claude yet. treg is the data source; setup needs it.',
    '',
    'Connect it:',
    `1. No treg account yet? Sign up: ${TREG_SIGNUP}`,
    '2. Go to claude.ai → Settings → Connectors → Add custom connector.',
    '3. Name: treg. URL: https://treg.to/mcp. Press Add.',
    '4. Press Connect next to treg and sign in.',
    '',
    'Or in a terminal: claude mcp add --transport http treg https://treg.to/mcp',
    '',
    'Then type /trend setup again. It picks up where it left off.',
  ].join('\n')
  if (t.treg === 'blocked') return [
    'Setup stopped: Auto mode blocks mods from calling treg.',
    'Switch the mode picker under the chat box from Auto to Ask permissions, then type /trend setup again.',
  ].join('\n')
  return `Setup stopped: treg answered with an error: ${t.why}\nFix that, then type /trend setup again.`
}

// Every caller (command, chat tool, panel button) gets the same closures over its `$`.
function makeCtx($: EngineInterface, dir: string): Ctx {
  return {
    io: {
      listTools: async () => (await $.tool.list()).map(t => t.name),
      mcpCall: (server, tool, args) => $.mcp.call(server, tool, args) as never,
      complete: req => $.model.complete({ model: 'sonnet', ...req }) as never,
      setStatus: s => update($, status, () => s),
      run: (argv, init) => $.process.run(argv, init),
      readBytes: async p => (await $.fs.read(p, { as: 'bytes' })).base64,
      sleep: ms => $.clock.sleep(ms),
    },
    dir,
    openPath: async p => { await $.process.run(['open', p]) },
    readFile: async p => ((await $.fs.exists(p)) ? $.fs.read(p) : null),
    writeFile: (p, t) => $.fs.write(p, t),
    listDir: async p => ((await $.fs.exists(p)) ? (await $.fs.list(p)).map(f => f.name) : []),
    getChannels: () => read($, channels),
    setConfig: c => update($, config, () => c),
    setReport: async r => {
      await update($, report, () => r)
      await update($, skipped, () => [])
      await update($, tab, () => 'ideas')
      const kept = Object.fromEntries(Object.entries(await read($, checks)).filter(([t]) => r.ideas.some(i => i.topic === t)))
      await update($, checks, () => kept)
      await $.store.set(KEYS.checks, kept)
    },
    setChannels: async c => { await update($, channels, () => c); await $.store.set(KEYS.channels, c) },
    setChecks: async fn => { const all = fn(await read($, checks)); await update($, checks, () => all); await $.store.set(KEYS.checks, all) },
    setDirs: async fn => { await update($, dirs, fn) },
    setStatus: s => update($, status, () => s),
    toast: s => $.ui.toast(s),
    }
}

export const register: Register = (on, options) => {
  let dir = ''

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'trend',
      description: 'Trend Radar: your best video ideas now. Also: /trend 8 ideas 21 days · /trend · <note> · /trend check <topic> · /trend setup',
    })
    await $.tool.register({
      name: 'run',
      description: 'Run Trend Radar: pulls competitor YouTube outliers, X launches and search data through treg, ranks 5 video ideas (or checks one topic), and shows them in the Trend Radar panel. Use when the person asks to run trend radar, get trend ideas or check a topic.',
      inputSchema: { type: 'object', properties: { topic: { type: 'string', description: 'Optional topic to check. Leave empty for the weekly top 5.' } } },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'thumbnail',
      description: 'Draw one thumbnail for an idea folder under ideas/, from its brief.md, the photos in references/, refs/ and inspo/, through treg. Call it when the person says "generate" after the brief is agreed in chat, or asks for another version.',
      inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'The idea folder: its name under ideas/, or its full path.' } }, required: ['folder'] },
      isDeferred: false,
    })

    const isRadar = async (folder: string) => {
      try {
        return !!JSON.parse(await $.fs.read(`${folder}/settings.json`)).trendRadar
      } catch {
        return false
      }
    }
    // The folder opened in Claude Code wins; the `folder` setting is for people who open a bigger project.
    const picked = String(options.folder ?? '').trim().replace(/\/+$/, '')
    if (await isRadar(e.cwd)) dir = e.cwd
    else if (picked && (await isRadar(picked))) dir = picked
    if (!dir) return next(e)

    const readFile = async (p: string) => ((await $.fs.exists(p)) ? $.fs.read(p) : null)
    const cfg = await loadConfig({ dir, readFile })
    await update($, config, () => cfg)

    // The newest report on disk is the one the panel shows.
    const reports = (await $.fs.exists(`${dir}/reports`)) ? await $.fs.list(`${dir}/reports`) : []
    const newest = reports.map(r => r.name).filter(n => n.endsWith('.json')).sort().at(-1)
    if (newest) {
      try {
        const r = JSON.parse(await $.fs.read(`${dir}/reports/${newest}`)) as TrendReport
        if (Array.isArray(r.ideas)) await update($, report, () => r)
      } catch {}
    }
    const [ch, sk, ck] = await Promise.all([$.store.get(KEYS.channels), $.store.get(KEYS.skipped), $.store.get(KEYS.checks)])
    if (Array.isArray(ch)) await update($, channels, () => ch as TrendChannel[])
    if (Array.isArray(sk)) await update($, skipped, () => sk as string[])
    if (ck && typeof ck === 'object') {
      // "this week" was once read as a topic; that check is noise.
      const { ['this week']: _old, ...rest } = ck as Record<string, string>
      await update($, checks, () => rest)
      await $.store.set(KEYS.checks, rest)
    }

    // Older copies kept saved ideas as loose files; each becomes a folder once.
    const listDir = async (p: string) => ((await $.fs.exists(p)) ? (await $.fs.list(p)).map(f => f.name) : [])
    for (const name of (await listDir(`${dir}/saved-ideas`)).filter(n => n.endsWith('.md'))) {
      const folder = name.replace(/\.md$/, '')
      try {
        await $.fs.write(`${dir}/ideas/${folder}/idea.md`, await $.fs.read(`${dir}/saved-ideas/${name}`))
        await $.process.run(['rm', '-f', `${dir}/saved-ideas/${name}`])
      } catch {}
    }
    await update($, dirs, () => [])

    // Edits to settings.json, references/ or ideas/ (by hand or by Claude in chat) show up within seconds.
    let lastSettings = 0
    let lastDirs = '-'
    let lastPresets = '-'
    let lastRefs = '-'
    let scanning = false
    // Cheap fingerprint of ideas/: folder names plus the clocks of meta.json and brief.md.
    const dirsStamp = async () => {
      const names = (await listDir(`${dir}/ideas`)).filter(n => !n.startsWith('.'))
      const parts = await Promise.all(names.map(async name => {
        const stamp = async (f: string) => { try { return String((await $.fs.stat(`${dir}/ideas/${name}/${f}`)).mtimeMs) } catch { return '-' } }
        return `${name}:${await stamp('meta.json')}:${await stamp('brief.md')}:${(await listDir(`${dir}/ideas/${name}/refs`)).length}`
      }))
      return parts.join('|')
    }
    const g = globalThis as { __trendRadarTimer?: { cancel: () => void } }
    g.__trendRadarTimer?.cancel()
    g.__trendRadarTimer = $.clock.every(4000, async () => {
      if (scanning) return
      scanning = true
      try {
      const p = settingsPath(dir)
      if (await $.fs.exists(p)) {
        const { mtimeMs } = await $.fs.stat(p)
        if (mtimeMs !== lastSettings) {
          lastSettings = mtimeMs
          const fresh = await loadConfig({ dir, readFile })
          await update($, config, () => fresh)
        }
      }
      const presetDir = `${dir}/presets`
      const presetNames = (await listDir(presetDir)).sort().join('|')
      if (presetNames !== lastPresets) {
        lastPresets = presetNames
        const names = presetNames ? presetNames.split('|').filter(n => n.endsWith('.json')) : []
        const list = await Promise.all(names.map(async file => {
          let name = file.replace(/\.json$/, '')
          try { name = String(JSON.parse(await $.fs.read(`${presetDir}/${file}`)).name ?? name) } catch {}
          return { file, name }
        }))
        await update($, presets, () => list)
      }
      const found = await listReferences({ dir, listDir })
      const refSig = found.map(r => r.name).join('|')
      if (refSig !== lastRefs) {
        lastRefs = refSig
        await update($, refs, () => found)
      }
      const dirSig = await dirsStamp()
      if (dirSig !== lastDirs) {
        lastDirs = dirSig
        const found2 = await scanDirs({ dir, readFile, listDir })
        await update($, dirs, () => found2)
      }
      } finally {
        scanning = false
      }
    })
    return next(e)
  })

  on('command.run', { command: 'trend' }, async ($, e) => {
    const args = parseArgs(e.args)
    if (!dir) return { text: NO_DIR }
    await $.ui.open({ id: PANE, title: 'Trend Radar' })
    if (args.kind === 'panel') return { text: 'Trend Radar panel opened.' }
    const ctx = makeCtx($, dir)
    if (args.kind === 'setup') {
      await update($, tab, () => 'setup')
      const found = await checkTreg(ctx.io)
      await update($, health, () => found)
      const list = await listPresets(ctx)
      await update($, presets, () => list)
      if (found.treg !== 'ok') return { text: tregHelp(found) }
      const resume = setupResume(await loadConfig(ctx))
      void $.prompt.submit({ text: setupPrompt(`${$.plugin.root}/SETUP.md`, dir, resume) })
      return { text: resume.said }
    }
    if (args.kind === 'add') return { text: await addCompetitor(ctx, args.handle) }
    if (args.kind === 'check') return { text: await check(ctx, args.topic) }
    if (args.kind === 'brief') return { text: await brief(ctx, args) }
    return { text: 'Trend Radar panel opened.' }
  })

  // Chat path: "generate" after the brief is agreed. Draws one picture for that folder.
  on('tool.call', { tool: 'mcp__trend-radar__thumbnail' }, async ($, e) => {
    if (!dir) return { result: NO_DIR }
    const want = String((e as { folder?: unknown }).folder ?? '').trim().replace(/\/+$/, '')
    const name = want.split('/').pop() ?? ''
    const all = await read($, dirs)
    const d = all.find(x => x.name === name || x.path === want) ?? all.find(x => x.slug === name)
    if (!d) return { result: `No idea folder called "${want}". Folders: ${all.map(x => x.name).join(', ') || 'none'}.` }
    await $.ui.open({ id: PANE, title: 'Trend Radar' })
    return { result: await thumbGenerate(makeCtx($, dir), d) }
  })

  // Chat path: Claude runs it for the person.
  on('tool.call', { tool: 'mcp__trend-radar__run' }, async ($, e) => {
    if (!dir) return { result: NO_DIR }
    const topic = String((e as { topic?: unknown }).topic ?? '').trim()
    await $.ui.open({ id: PANE, title: 'Trend Radar' })
    const ctx = makeCtx($, dir)
    return { result: topic ? await check(ctx, topic) : await brief(ctx) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // The desktop table has everything; the terminal lacks Svg, the phone lacks Input.
    const ui = $.ui.resolve(e) as unknown as Partial<Elements['desktop']> & Pick<Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Link' | 'Markdown'>
    const { Box, Text, Button, Link, Markdown } = ui
    if (!dir) {
      return (
        <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor="#FF6B4A">
          <Text bold>Trend Radar needs its folder</Text>
          <Text>{NO_DIR}</Text>
          <Text dimColor>That folder holds settings.json, references/ and ideas/.</Text>
        </Box>
      )
    }
    const Svg = ui.Svg ?? null
    const Input = ui.Input ?? ((p: { placeholder?: string; label?: string }) => <Text dimColor>{p.label ?? p.placeholder} (edit on desktop)</Text>)
    const cols = e.props.bodyColumns ?? 80
    // Drawings are sized to the panel, so nothing shrinks or spills.
    const px = Math.max(240, Math.min(cols * 7.5, 720))
    const chartW = Math.round(Math.min(px - 56, 520))
    const barW = 150
    await read($, tick)

    const [current, now, which, cfgOrNull, chans, skip, checked, opened, note, folders, tregHealth, presetList, openIds, note1, onlyPillar, isNoteOpen, refList, sortBy, showAll, openSaved, trashAsk, editKey] = await Promise.all([
      read($, report), read($, status), read($, tab), read($, config), read($, channels),
      read($, skipped), read($, checks), read($, openChannel), read($, notice), read($, dirs),
      read($, health), read($, presets), read($, expanded), read($, runNote), read($, pillarFilter), read($, noteOpen),
      read($, refs), read($, vidSort), read($, vidAll), read($, savedOpen), read($, confirmTrash), read($, editing),
    ])
    const cfg = cfgOrNull ?? EMPTY_CONFIG
    const ctx = makeCtx($, dir)
    // Same doorman as /trend setup: treg first, then the next unfinished question, answered in the chat box.
    const startSetup = async () => {
      await update($, tab, () => 'setup')
      const found = await checkTreg(ctx.io)
      await update($, health, () => found)
      if (found.treg !== 'ok') { await update($, notice, () => tregHelp(found).split('\n')[0]); return }
      const resume = setupResume(await loadConfig(ctx))
      void $.prompt.submit({ text: setupPrompt(`${$.plugin.root}/SETUP.md`, dir, resume) })
      await update($, notice, () => `Answer in the chat box: ${resume.opener}`)
    }
    const ready = isConfigured(cfg)
    if (!tregAsked) {
      tregAsked = true
      void checkTreg(ctx.io).then(h => update($, health, () => h))
    }
    const recheckTreg = async () => {
      await update($, health, () => ({ treg: 'unchecked', why: '' }))
      const h = await checkTreg(ctx.io)
      await update($, health, () => h)
    }
    const editCfg = async (fn: (c: TrendConfig) => TrendConfig) => saveConfig(ctx, fn(await loadConfig(ctx)))
    const pillarColor = (pillar: string) => {
      const i = cfg.pillars.indexOf(pillar)
      return PILLAR_COLORS[(i < 0 ? 0 : i) % PILLAR_COLORS.length]!
    }
    const Label = (p: { children: string }) => <Text dimColor bold>{p.children}</Text>
    // One drawing may hold 100,000 characters in all. Pictures are the heavy part, so they share a budget;
    // past it, a tile draws without its picture instead of the whole panel being refused.
    let picBudget = 70_000
    const pic = (b64: string) => {
      if (!b64 || b64.length > picBudget) return ''
      picBudget -= b64.length
      return b64
    }

    // ── header: one row of tabs, Refresh on the right ──
    const tabs: [TrendTab, string][] = [['ideas', 'Ideas'], ['saved', `Saved${folders.length ? ` ${folders.length}` : ''}`], ['competitors', 'Competitors'], ['setup', 'Setup']]
    const header = (
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
          <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
            {Svg ? <Svg source={logo(28)} width={28} height={28} alt="Trend Radar" isInteractive /> : <Text color="#FC6467">◔</Text>}
            {tabs.map(([id, label]) => (
              <Button key={`tab-${id}`} variant={which === id ? 'primary' : 'secondary'} dimColor={which !== id} onPress={() => update($, tab, () => id)}>
                {label}
              </Button>
            ))}
          </Box>
          <Button key="refresh" variant="secondary" onPress={() => { void brief(ctx) }}>{busy() ? '⏳ Running…' : '↻ Refresh'}</Button>
        </Box>
        {now ? <Text color={now.startsWith('Failed') ? 'red' : 'yellow'}>{now}</Text> : null}
      </Box>
    )

    // ── pictures of an idea: small tiles, one per version, plus Again / Change / Folder ──
    const startThumb = async (idea: TrendIdea) => {
      const d = await thumbStart(ctx, idea, folders)
      void $.prompt.submit({ text: briefPrompt(`${$.plugin.root}/THUMBNAIL.md`, dir, d) })
    }
    const thumbPart = (d: TrendIdeaDir, idea?: TrendIdea) => {
      const running = thumbRunning() === d.path
      return (
        <Box flexDirection="column" marginTop={1}>
          <Label>THUMBNAILS</Label>
          {d.status ? <Text color={d.status.startsWith('Failed') ? 'red' : 'yellow'} wrap="truncate-end">{d.status}</Text> : null}
          {d.versions.length
            ? (
              <Box flexDirection="row" gap={2} flexWrap="wrap">
                {d.versions.map((v, i) => {
                  const b64 = pic(loadPic($, v.path.replace(/\.png$/, '.preview.jpg')))
                  return (
                    <Box key={`tv-${d.name}-${i}`} flexDirection="column" width={18}>
                      {Svg && b64 ? <Svg source={previewImage(b64, 128)} width={128} height={72} alt={`Thumbnail v${i + 1} for ${d.title}`} /> : null}
                      <Button key={`tv-open-${d.name}-${i}`} plain dimColor onPress={() => { void ctx.openPath(v.path) }}>{`v${i + 1} · ${v.model === 'GPT Image 2.5' ? 'GPT' : 'NB2'} ↗`}</Button>
                    </Box>
                  )
                })}
              </Box>
            )
            : d.brief ? null : <Text dimColor>Brief not written yet. Claude writes it in chat; say "generate" there.</Text>}
          <Box flexDirection="row" gap={1} marginTop={1} alignItems="center" flexWrap="wrap">
            {d.brief ? <Button key={`thumb-again-${d.name}`} variant={d.versions.length ? 'secondary' : 'primary'} onPress={() => { void thumbGenerate(ctx, d) }}>{running ? '⏳ Drawing…' : d.versions.length ? '🎨 Again' : '🎨 Generate'}</Button> : null}
            <Button key={`thumb-change-${d.name}`} variant="secondary" onPress={() => {
              if (d.brief) void $.prompt.fill({ mode: 'replace', text: `Change the thumbnail for "${d.title}" (folder ${d.name}): ` })
              else if (idea) void startThumb(idea)
            }}>{d.brief ? '✍️ Change' : '✍️ Brief in chat'}</Button>
            <Button key={`thumb-folder-${d.name}`} plain dimColor onPress={() => { void ctx.openPath(d.path) }}>📂 Folder</Button>
            <Text dimColor>{THUMB_COST[cfg.thumbQuality]} each</Text>
          </Box>
        </Box>
      )
    }

    // ── 💡 Ideas: one card per idea, all in the app's own text ──
    const card = (idea: TrendIdea, n: number) => {
      const color = pillarColor(idea.pillar)
      const verdict = checked[idea.topic]
      const d = dirFor(folders, idea)
      const isSaved = !!d
      const isOpen = openIds.includes(idea.id)
      const toggle = () => update($, expanded, ids => (ids.includes(idea.id) ? ids.filter(x => x !== idea.id) : [...ids, idea.id]))
      return (
        <Box key={`idea-${idea.id}`} flexDirection="column" borderStyle="round" borderDimColor={!isOpen} paddingX={1} marginBottom={1}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
            <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
              <Text dimColor wrap="truncate-end">{String(n).padStart(2, '0')} · <Text color={color}>●</Text> {pillarName(idea.pillar)}{idea.sponsor ? ` · 💰 ${idea.sponsor}` : ''}</Text>
              <Text bold wrap="wrap">{idea.title}</Text>
              {isOpen ? null : <Text dimColor wrap="truncate-end">{idea.whyNow}</Text>}
            </Box>
            <Box flexShrink={0} width={6}>
              {Svg ? <Svg source={scoreRing(idea.score)} width={40} height={40} alt={`Score ${idea.score} of 10`} /> : <Text color={scoreColor(idea.score)} bold>{idea.score}/10</Text>}
            </Box>
          </Box>
          {idea.noteFit ? <Text color="#A855F7">📝 {idea.noteFit}</Text> : null}
          {isOpen
            ? (
              <Box flexDirection="column" marginTop={1} gap={1}>
                <Box flexDirection="column"><Label>WHY NOW</Label><Text>{idea.whyNow}</Text></Box>
                <Box flexDirection="column"><Label>ANGLE</Label><Text>{idea.angle}</Text></Box>
                {(idea.signals.youtube + idea.signals.x + idea.signals.fit + idea.signals.fresh) > 0
                  ? (
                    <Box flexDirection="row" gap={3} flexWrap="wrap">
                      {([['YouTube', idea.signals.youtube], ['X buzz', idea.signals.x], ['Fit', idea.signals.fit], ['Fresh', idea.signals.fresh]] as [string, number][]).map(([label, v]) => (
                        <Box key={`sig-${idea.id}-${label}`} flexDirection="column">
                          <Text dimColor>{label} <Text bold>{v}</Text></Text>
                          {Svg ? <Svg source={bar(v, 10, color, 100, 6)} width={100} height={6} alt={`${label} ${v} of 10`} /> : null}
                        </Box>
                      ))}
                    </Box>
                  )
                  : null}
                {idea.proof.length > 0
                  ? (
                    <Box flexDirection="column">
                      <Label>PROOF</Label>
                      {(() => {
                        const top = Math.max(3, ...idea.proof.map(p => p.multiple ?? 0))
                        return idea.proof.map((p, i) => (
                          <Box key={`p-${idea.id}-${i}`} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                            <Link href={p.url} label={`${p.label} ↗`} />
                            {Svg && p.multiple ? <Svg source={bar(p.multiple, top, color, barW, 8, 1)} width={barW} height={8} alt={`${p.multiple}x normal views`} /> : null}
                            {p.multiple ? <Text bold>{p.multiple}x</Text> : null}
                          </Box>
                        ))
                      })()}
                      <Text dimColor>x = times the channel's normal views</Text>
                    </Box>
                  )
                  : null}
                {d && (d.brief || d.status || d.versions.length) ? thumbPart(d, idea) : null}
                {verdict ? <Box flexDirection="column"><Label>CHECK</Label><Markdown key={`v-${idea.id}`} text={verdict} /></Box> : null}
              </Box>
            )
            : null}
          <Box flexDirection="row" gap={1} marginTop={1} alignItems="center" flexWrap="wrap">
            <Button key={`more-${idea.id}`} variant="secondary" onPress={toggle}>{isOpen ? 'Less' : 'Details'}</Button>
            <Button key={`save-${idea.id}`} variant={isSaved ? 'secondary' : 'primary'} onPress={() => { if (!isSaved) void saveIdea(ctx, idea, folders) }}>
              {isSaved ? '⭐ Saved' : '☆ Save'}
            </Button>
            {isOpen ? <Button key={`check-${idea.id}`} variant="secondary" onPress={() => { void check(ctx, idea.topic) }}>Check</Button> : null}
            {isOpen
              ? (
                <Button key={`script-${idea.id}`} variant="secondary" onPress={() => {
                  void $.prompt.fill({
                    mode: 'replace',
                    text: `Write a YouTube script for "${idea.title}". Pillar: ${pillarName(idea.pillar)}. Angle: ${idea.angle}. Why now: ${idea.whyNow}. Proof: ${idea.proof.map(p => p.url).join(' ')}. Hook in the first 5 seconds, then a step-by-step build, then a CTA. Keep it in my voice.`,
                  })
                }}>Script</Button>
              )
              : null}
            {isOpen && !(d && (d.brief || d.status || d.versions.length)) ? <Button key={`thumb-${idea.id}`} variant="secondary" onPress={() => { void startThumb(idea) }}>🖼 Thumbnail</Button> : null}
            <Box flexGrow={1} />
            <Button key={`skip-${idea.id}`} plain dimColor onPress={async () => {
              const list = [...(await read($, skipped)), idea.id]
              await update($, skipped, () => list)
              await $.store.set(KEYS.skipped, list)
            }}>Skip</Button>
          </Box>
        </Box>
      )
    }

    const ideasTab = () => {
      if (!ready) {
        return (
          <Box flexDirection="column" borderStyle="round" borderColor="#FF6B4A" paddingX={1}>
            <Text bold>👋 Let's set up your radar</Text>
            <Text>Claude asks a few questions, treg finds your competitors. About 2 minutes, a few cents.</Text>
            <Box flexDirection="row" gap={1}><Text dimColor>No treg yet?</Text><Link href={TREG_SIGNUP} label="Get treg ↗" /></Box>
            <Box marginTop={1} flexDirection="row" gap={1}>
              <Button key="start-setup" variant="primary" onPress={() => { void startSetup() }}>▶ Start setup</Button>
              <Button key="go-presets" onPress={() => update($, tab, () => 'setup')}>Load a preset</Button>
            </Box>
          </Box>
        )
      }
      if (!current) {
        return <Text dimColor>No ideas yet. Press ↻ Refresh or type /trend. About a minute, about 1 cent.</Text>
      }
      const s = current.sources
      const visible = current.ideas.filter(i => !skip.includes(i.id) && (!onlyPillar || i.pillar === onlyPillar))
      const when = new Date(current.at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" gap={2} flexWrap="wrap">
            <Text bold>{current.ideas.length} ideas · {when}</Text>
            <Text dimColor>{s.outliers} outliers · {s.xPosts} X posts · {s.channels}/{s.channelsTotal} channels · last {current.daysBack ?? cfg.daysBack} days · ${s.costUsd.toFixed(3)}</Text>
          </Box>
          {current.note ? <Text color="#A855F7">📝 This run: {current.note}</Text> : null}
          {s.failed.length > 0 ? <Text color="yellow">Some sources failed: {s.failed.join(' | ')}</Text> : null}
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap" marginY={1}>
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Button key="filter-all" plain dimColor={!!onlyPillar} onPress={() => update($, pillarFilter, () => '')}>{onlyPillar ? '○ All' : '● All'}</Button>
              {cfg.pillars.map((p, i) => (
                <Button key={`filter-${i}`} plain dimColor={onlyPillar !== p} onPress={() => update($, pillarFilter, f => (f === p ? '' : p))}>
                  {`${onlyPillar === p ? '●' : '○'} ${pillarName(p)}`}
                </Button>
              ))}
            </Box>
            <Button key="note-toggle" plain dimColor onPress={() => update($, noteOpen, v => !v)}>{isNoteOpen ? '✕ Note' : '＋ Note'}</Button>
          </Box>
          {isNoteOpen
            ? (
              <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginBottom={1}>
                <Text bold>What should the next run focus on?</Text>
                <Text dimColor>Used for one run only. For notes that always apply, use Setup → Notes.</Text>
                <Input key="run-note" placeholder="e.g. focus on Shorts ideas, or ideas for my Fish Audio sponsor" value={note1} submitLabel="↻ Run with note" onSubmit={async (v: string) => {
                  await update($, runNote, () => v.trim())
                  await update($, noteOpen, () => false)
                  void brief(ctx, { note: v.trim() })
                }} />
              </Box>
            )
            : null}
          {current.markdown ? <Markdown key="fallback" text={current.markdown} /> : null}
          {visible.map(idea => card(idea, current.ideas.indexOf(idea) + 1))}
          {visible.length === 0 && current.ideas.length > 0 ? <Text dimColor>Nothing here. Pick another filter or press ↻ Refresh.</Text> : null}
          {current.freshOnX.length > 0
            ? (
              <Box flexDirection="column" marginTop={1}>
                <Label>FRESH ON X</Label>
                {current.freshOnX.map((p, i) => <Link key={`x-${i}`} href={p.url} label={`${p.label} ↗`} />)}
              </Box>
            )
            : null}
          {current.skip.length > 0
            ? (
              <Box flexDirection="column" marginTop={1}>
                <Label>NOT FOR YOU</Label>
                {current.skip.map((t, i) => <Text key={`s-${i}`} dimColor>{t}</Text>)}
              </Box>
            )
            : null}
          {Object.keys(checked).filter(t => !current.ideas.some(i => i.topic === t)).slice(-3).map(t => (
            <Box key={`chk-${t}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginTop={1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Label>{`TOPIC CHECK · ${t.toUpperCase()}`}</Label>
                <Button key={`chk-x-${t}`} plain dimColor onPress={async () => {
                  const { [t]: _gone, ...rest } = await read($, checks)
                  await update($, checks, () => rest)
                  await $.store.set(KEYS.checks, rest)
                }}>✕</Button>
              </Box>
              <Markdown key={`chkmd-${t}`} text={checked[t]!} />
            </Box>
          ))}
        </Box>
      )
    }

    // ── ⭐ Saved: one compact card per idea folder; Details opens proof, pictures and the folder ──
    const savedTab = () => (
      <Box flexDirection="column">
        <Text dimColor>One folder per idea you saved or made a thumbnail for, newest first. Ask Claude "write a script for my saved … idea".</Text>
        <Box flexDirection="column" marginTop={1}>
          {folders.length === 0 ? <Text dimColor>Nothing saved yet. Press ☆ Save or 🖼 Thumbnail on an idea card.</Text> : null}
          {folders.map(d => {
            const isOpen = openSaved.includes(d.name)
            const asking = trashAsk === d.name
            const idea = current?.ideas.find(i => dirFor([d], i))
            const proof = idea?.proof ?? d.inspo.map(i => ({ label: i.label, url: i.url, multiple: i.multiple }))
            return (
              <Box key={`dir-${d.name}`} flexDirection="column" borderStyle="round" borderDimColor={!isOpen} paddingX={1} marginBottom={1}>
                <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
                  <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                    <Text dimColor wrap="truncate-end">{d.name.slice(0, 10)}{idea ? ` · ${pillarName(idea.pillar)}` : ''} · {d.versions.length} picture{d.versions.length === 1 ? '' : 's'}{d.brief ? '' : ' · no brief'}</Text>
                    <Text bold wrap="wrap">{d.title}</Text>
                  </Box>
                  {idea ? <Box flexShrink={0} width={6}>{Svg ? <Svg source={scoreRing(idea.score)} width={40} height={40} alt={`Score ${idea.score} of 10`} /> : <Text bold>{idea.score}/10</Text>}</Box> : null}
                </Box>
                {isOpen
                  ? (
                    <Box flexDirection="column" marginTop={1}>
                      {proof.length
                        ? (
                          <Box flexDirection="column">
                            <Label>PROOF</Label>
                            <Box flexDirection="row" gap={2} flexWrap="wrap">
                              {proof.map((p, i) => <Link key={`sp-${d.name}-${i}`} href={p.url} label={`${p.label}${p.multiple ? ` ${p.multiple}x` : ''} ↗`} />)}
                            </Box>
                          </Box>
                        )
                        : null}
                      {thumbPart(d, idea)}
                    </Box>
                  )
                  : null}
                <Box flexDirection="row" gap={1} marginTop={1} alignItems="center" flexWrap="wrap">
                  <Button key={`dir-more-${d.name}`} variant="secondary" onPress={() => update($, savedOpen, ids => (ids.includes(d.name) ? ids.filter(x => x !== d.name) : [...ids, d.name]))}>{isOpen ? 'Less' : 'Details'}</Button>
                  <Box flexGrow={1} />
                  {asking
                    ? (
                      <Box flexDirection="row" gap={1} alignItems="center">
                        <Text color="yellow">Move this folder to the Trash?</Text>
                        <Button key={`dir-trash-yes-${d.name}`} variant="primary" onPress={async () => { await update($, confirmTrash, () => ''); void trashDir(ctx, d) }}>Yes</Button>
                        <Button key={`dir-trash-no-${d.name}`} variant="secondary" onPress={() => update($, confirmTrash, () => '')}>No</Button>
                      </Box>
                    )
                    : <Button key={`dir-trash-${d.name}`} plain dimColor onPress={() => update($, confirmTrash, () => d.name)}>🗑 Delete</Button>}
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>
    )

    // ── 📺 Competitors ──
    const competitorsTab = () => {
      const byHandle = new Map(chans.map(c => [c.handle, c]))
      const best = (c?: TrendChannel) => (c ? [...c.videos].filter(v => v.ageDays <= 60).sort((a, b) => b.multiple - a.multiple)[0] : undefined)
      const rows = cfg.competitors.map(handle => ({ handle, ch: byHandle.get(handle) }))
      rows.sort((a, b) => (best(b.ch)?.multiple ?? 0) - (best(a.ch)?.multiple ?? 0))
      return (
        <Box flexDirection="column">
          <Input key="add-channel" label="Add a competitor" placeholder="@handle or channel link" submitLabel="Add" onSubmit={async (v: string) => {
            const out = await addCompetitor(ctx, v)
            await update($, notice, () => out)
          }} />
          {note ? <Text color={note.startsWith('✓') ? 'green' : 'yellow'}>{note}</Text> : null}
          {chans.length === 0 ? <Text dimColor>Press ↻ Refresh once to scan everyone and fill in the stats.</Text> : null}
          <Box flexDirection="column" marginTop={1}>
            {rows.map(({ handle, ch }) => {
              const top = best(ch)
              const isOpen = opened === handle
              return (
                <Box key={`ch-${handle}`} flexDirection="column" borderStyle={isOpen ? 'round' : undefined} borderDimColor paddingX={isOpen ? 1 : 0}>
                  <Box flexDirection="row" justifyContent="space-between">
                    <Box flexDirection="row" gap={1}>
                      <Button key={`open-${handle}`} plain onPress={() => update($, openChannel, () => (isOpen ? '' : handle))}>
                        {`${isOpen ? '▾' : '▸'} ${handle}`}
                      </Button>
                      <Text dimColor>{ch ? `median ${compact(ch.median)}` : 'not scanned yet'}</Text>
                      {top && top.multiple >= 2.5 ? <Text color="#FF6B4A">🔥 {top.multiple}x</Text> : null}
                    </Box>
                    <Button key={`rm-${handle}`} plain dimColor onPress={() => editCfg(c => ({ ...c, competitors: c.competitors.filter(x => x !== handle) }))}>✕</Button>
                  </Box>
                  {isOpen && ch
                    ? (() => {
                      const recent = ch.videos.filter(v => v.ageDays <= 60)
                      const hits = recent.filter(v => v.multiple >= 2.5)
                      const list = [...(showAll || hits.length === 0 ? recent : hits)]
                      list.sort((x, y) => (sortBy === 'newest' ? x.ageDays - y.ageDays : sortBy === 'views' ? y.views - x.views : y.multiple - x.multiple))
                      const shown = showAll ? list : list.slice(0, 12)
                      const sorts: [typeof sortBy, string][] = [['multiple', '🔥 Multiple'], ['views', '👁 Views'], ['newest', '🕐 Newest']]
                      return (
                        <Box flexDirection="column" marginY={1}>
                          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
                            <Text dimColor>{hits.length} outlier{hits.length === 1 ? '' : 's'} (2.5x+) in the last 60 days · x = times the channel's normal views</Text>
                            <Box flexDirection="row" gap={1} flexWrap="wrap">
                              {sorts.map(([k, label]) => (
                                <Button key={`sort-${k}`} plain dimColor={sortBy !== k} onPress={() => update($, vidSort, () => k)}>{label}</Button>
                              ))}
                              <Button key="show-all" plain dimColor={!showAll} onPress={() => update($, vidAll, v => !v)}>{showAll ? '● All 30' : '○ All 30'}</Button>
                            </Box>
                          </Box>
                          <Box flexDirection="row" gap={2} flexWrap="wrap" marginTop={1}>
                            {shown.map((v, i) => {
                              if (Svg && v.thumb && !picCache.has(v.thumb)) fetchPic($, dir, v.thumb)
                              return (
                                <Box key={`t-${handle}-${i}`} flexDirection="column" marginBottom={1} width={23} minWidth={0}>
                                  {Svg ? <Svg source={thumbTile(v, pic(picCache.get(v.thumb) ?? ''))} width={168} height={95} alt={v.title} /> : null}
                                  <Link href={v.url} label={`${v.title.length > 22 ? `${v.title.slice(0, 21)}…` : v.title} ↗`} />
                                  <Text dimColor wrap="truncate-end">{compact(v.views)} · {v.ageDays === 999 ? '' : `${v.ageDays}d · `}<Text color={v.multiple >= 2.5 ? '#FF6B4A' : undefined} bold={v.multiple >= 2.5}>{v.multiple}x</Text></Text>
                                </Box>
                              )
                            })}
                          </Box>
                        </Box>
                      )
                    })()
                    : null}
                </Box>
              )
            })}
          </Box>
        </Box>
      )
    }

    // ── ⚙️ Setup: cards, values as text, one input open at a time ──
    const setEdit = (k: string) => update($, editing, cur => (cur === k ? '' : k))
    const Card = (p: { title: string; children: unknown }) => (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginBottom={1}>
        <Box marginBottom={1}><Label>{p.title}</Label></Box>
        {p.children as never}
      </Box>
    )
    const Needed = () => <Text color="#FF6B4A">needed</Text>
    // A row: label, the value as text, Edit. Press Edit and the input appears under it.
    const Row = (p: { k: string; label: string; value: string; helper?: string; needed?: boolean; placeholder: string; onSave: (v: string) => void; last?: boolean }) => (
      <Box flexDirection="column" marginBottom={p.last ? 0 : 1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
          <Box flexDirection="row" gap={1} flexShrink={0}><Text bold>{p.label}</Text>{p.needed ? <Needed /> : null}</Box>
          <Box flexDirection="row" gap={2} alignItems="center" flexShrink={1} minWidth={0}>
            {editKey === p.k ? null : <Text dimColor={!p.value} wrap="truncate-end">{p.value || 'not set'}</Text>}
            <Button key={`edit-${p.k}`} plain dimColor onPress={() => { void setEdit(p.k) }}>{editKey === p.k ? 'Cancel' : 'Edit'}</Button>
          </Box>
        </Box>
        {p.helper ? <Text dimColor>{p.helper}</Text> : null}
        {editKey === p.k
          ? <Input key={`in-${p.k}`} placeholder={p.placeholder} value={p.value} submitLabel="Save" autoFocus onSubmit={(v: string) => { p.onSave(v); void update($, editing, () => '') }} />
          : null}
      </Box>
    )
    // A row of chips, each its own small box with ✕; ＋ Add opens the input.
    const Chips = (p: { field: 'notes' | 'pillars' | 'xKeywords' | 'sponsorTypes'; label: string; helper?: string; needed?: boolean; hint: string; column?: boolean; last?: boolean }) => (
      <Box flexDirection="column" marginBottom={p.last ? 0 : 1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
          <Box flexDirection="row" gap={1}><Text bold>{p.label}</Text>{p.needed ? <Needed /> : null}</Box>
          <Button key={`add-btn-${p.field}`} plain dimColor onPress={() => { void setEdit(p.field) }}>{editKey === p.field ? 'Cancel' : '＋ Add'}</Button>
        </Box>
        {p.helper ? <Text dimColor>{p.helper}</Text> : null}
        {cfg[p.field].length
          ? (
            <Box flexDirection={p.column ? 'column' : 'row'} gap={p.column ? 0 : 1} flexWrap="wrap">
              {cfg[p.field].map((t, i) => (
                <Box key={`${p.field}-chip-${i}`} flexDirection="row" borderStyle="round" borderDimColor paddingX={1}>
                  {p.field === 'pillars' ? <Text color={PILLAR_COLORS[i % PILLAR_COLORS.length]}>● </Text> : null}
                  <Text>{t} </Text>
                  <Button key={`${p.field}-${i}`} plain dimColor onPress={() => editCfg(c => ({ ...c, [p.field]: c[p.field].filter((_, k) => k !== i) }))}>✕</Button>
                </Box>
              ))}
            </Box>
          )
          : <Text dimColor>none yet</Text>}
        {editKey === p.field
          ? <Input key={`add-${p.field}`} placeholder={p.hint} submitLabel="Add" autoFocus onSubmit={(v: string) => {
            const val = v.trim()
            if (val) void editCfg(c => ({ ...c, [p.field]: [...c[p.field], val] }))
          }} />
          : null}
      </Box>
    )
    const steps = setupSteps(cfg)
    const step = (key: string) => steps.find(st => st.key === key)?.isDone ?? false
    const tregOk = tregHealth.treg === 'ok'
    const tregWord = tregHealth.treg === 'ok' ? 'connected'
      : tregHealth.treg === 'unchecked' ? 'checking…'
      : tregHealth.treg === 'missing' ? 'not connected'
      : tregHealth.treg === 'blocked' ? 'blocked by Auto mode'
      : 'connected, but treg is having trouble right now'
    const tregMark = tregHealth.treg === 'ok' ? '✅' : tregHealth.treg === 'unchecked' ? '⏳' : tregHealth.treg === 'error' ? '⚠️' : '⬜'
    const missing = [...(tregOk ? [] : [tregHealth.treg === 'error' ? 'treg (busy, press Check again)' : tregHealth.treg === 'blocked' ? 'treg (mode picker off Auto)' : 'treg']), ...steps.filter(st => !st.isDone).map(st => st.label.toLowerCase())]
    const setupTab = () => (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor={ready && tregOk ? 'green' : '#FF6B4A'} paddingX={1} marginBottom={1}>
          {ready && tregOk
            ? (
              <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2} flexWrap="wrap">
                <Text bold>✓ Radar ready</Text>
                <Button key="ready-refresh" variant="primary" onPress={() => { void brief(ctx) }}>{busy() ? '⏳ Running…' : '↻ Get ideas'}</Button>
              </Box>
            )
            : (
              <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2} flexWrap="wrap">
                <Box flexDirection="column" flexShrink={1} minWidth={0}>
                  <Text bold>Not ready yet</Text>
                  <Text dimColor wrap="truncate-end">Missing: {missing.join(', ')}</Text>
                </Box>
                <Button key="guided-setup" variant="primary" onPress={() => { void startSetup() }}>▶ Let Claude fill this in</Button>
              </Box>
            )}
          <Box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap" marginTop={1}>
            <Text>{tregMark} treg {tregWord}</Text>
            <Button key="treg-check" plain dimColor onPress={() => { void recheckTreg() }}>Check again</Button>
            {tregHealth.treg === 'missing' ? <Link href={TREG_SIGNUP} label="Get treg ↗" /> : null}
            {ready && tregOk ? <Button key="guided-setup-2" plain dimColor onPress={() => { void startSetup() }}>Redo guided setup</Button> : null}
          </Box>
          {tregHealth.why && !tregOk ? <Text color="yellow" wrap="truncate-end">{tregHealth.why}</Text> : null}
          {tregHealth.treg === 'missing' ? <Text dimColor>1. Sign up with the link. 2. In Claude: Settings → Connectors → Add custom connector, URL https://treg.to/mcp → Connect, sign in. 3. Mode picker off Auto. 4. Check again.</Text> : null}
          {tregHealth.treg === 'blocked' ? <Text dimColor>Switch the mode picker under the chat box off Auto, then Check again.</Text> : null}
          {tregHealth.treg === 'error' ? <Text dimColor>Their server, not yours. Wait a few minutes and Check again.</Text> : null}
        </Box>

        <Card title="YOU">
          <Row k="channel" label="Channel" value={cfg.channel} needed={!step('channel')} placeholder="@handle or channel link" onSave={v => { const h = normalizeHandle(v); if (h) void editCfg(c => ({ ...c, channel: h })) }} />
          <Row k="audience" label="Audience" value={cfg.audience} needed={!step('audience')} placeholder="e.g. solopreneurs and content creators" onSave={v => { if (v.trim()) void editCfg(c => ({ ...c, audience: v.trim() })) }} />
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
            <Box flexDirection="row" gap={1}><Text bold>Photos of you</Text><Text dimColor>optional</Text></Box>
            <Box flexDirection="row" gap={2} alignItems="center" flexShrink={1} minWidth={0}>
              <Text dimColor wrap="truncate-end">{refList.length ? refList.map(r => r.name.replace(/\.(jpe?g|png|webp)$/i, '')).join(', ') : 'none yet · generic person'}</Text>
              <Button key="open-refs" plain dimColor onPress={() => { void ctx.openPath(`${dir}/references`) }}>Open folder ↗</Button>
            </Box>
          </Box>
          <Text dimColor>Drop 1 to 4 photos into references/. The first by name is the main face.</Text>
        </Card>

        <Card title="RADAR">
          <Chips field="pillars" label="Pillars" helper={'2 or more, as "Name: what it covers"'} needed={!step('pillars')} hint={'e.g. "Make money: leads, funnels"'} column />
          <Box flexDirection="column" marginBottom={1}>
            <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
              <Box flexDirection="row" gap={1}><Text bold>Competitors</Text>{step('competitors') ? null : <Needed />}</Box>
              <Box flexDirection="row" gap={2} alignItems="center">
                <Text dimColor>{cfg.competitors.length} channel{cfg.competitors.length === 1 ? '' : 's'}</Text>
                <Button key="go-competitors" plain dimColor onPress={() => update($, tab, () => 'competitors')}>See all →</Button>
                <Button key="add-btn-competitors" plain dimColor onPress={() => { void setEdit('competitors') }}>{editKey === 'competitors' ? 'Cancel' : '＋ Add'}</Button>
              </Box>
            </Box>
            <Text dimColor>5 or more YouTube channels in your niche.</Text>
            {editKey === 'competitors'
              ? <Input key="cfg-add-competitor" placeholder="@handle or channel link" submitLabel="Add" autoFocus onSubmit={async (v: string) => { const out = await addCompetitor(ctx, v); await update($, notice, () => out) }} />
              : null}
          </Box>
          <Chips field="xKeywords" label="X keywords" helper="Tools and brands whose launches matter to you." needed={!step('xKeywords')} hint="e.g. Sora" />
          <Chips field="sponsorTypes" label="Sponsor types" needed={!step('sponsorTypes')} hint="e.g. CRM tools" />
          <Chips field="notes" label="Standing notes" helper="Claude weighs these on every run." hint={'e.g. "I have a Fish Audio sponsor this month"'} column last />
        </Card>

        <Card title="RUNS">
          <Row k="days" label="Days back" value={`${cfg.daysBack}`} placeholder="1 to 90" onSave={v => { const n = Number(v); if (n > 0) void editCfg(c => ({ ...c, daysBack: clamp(n, 1, 90) })) }} />
          <Row k="ideas" label="Ideas per run" value={`${cfg.ideasCount}`} placeholder="1 to 10" onSave={v => { const n = Number(v); if (n > 0) void editCfg(c => ({ ...c, ideasCount: clamp(n, 1, 10) })) }} last />
        </Card>

        <Card title="THUMBNAILS">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2} marginBottom={1} flexWrap="wrap">
            <Text bold>Quality</Text>
            <Box flexDirection="row" gap={1}>
              {(['low', 'medium', 'high'] as const).map(q => (
                <Button key={`quality-${q}`} variant={cfg.thumbQuality === q ? 'primary' : 'secondary'} onPress={() => editCfg(c => ({ ...c, thumbQuality: q }))}>{`${q} ${THUMB_COST[q]}`}</Button>
              ))}
            </Box>
          </Box>
          <Row k="style" label="Brand style" value={cfg.thumbStyle} helper="Optional. Colours and text look the image model should keep to." placeholder="e.g. coral #FC6467 accents, glossy 3D text, dark ink background" onSave={v => { void editCfg(c => ({ ...c, thumbStyle: v.trim() })) }} last />
        </Card>

        <Card title="PRESETS">
          <Text dimColor>A preset is this whole setup saved as a file in presets/. Load one to start from it, or drop your own JSON file in there.</Text>
          <Box flexDirection="column" marginTop={1}>
            {presetList.length === 0 ? <Text dimColor>none yet</Text> : null}
            {presetList.map(p => {
              const asking = trashAsk === `preset:${p.file}`
              return (
                <Box key={`preset-row-${p.file}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
                  <Text>{p.name}</Text>
                  <Box flexDirection="row" gap={1} alignItems="center">
                    <Button key={`preset-${p.file}`} variant="secondary" onPress={async () => {
                      const out = await loadPreset(ctx, p.file)
                      await update($, notice, () => out)
                    }}>Load</Button>
                    {asking
                      ? (
                        <Box flexDirection="row" gap={1} alignItems="center">
                          <Text color="yellow">Trash it?</Text>
                          <Button key={`preset-yes-${p.file}`} variant="primary" onPress={async () => {
                            await update($, confirmTrash, () => '')
                            const out = await deletePreset(ctx, p.file)
                            await update($, notice, () => out)
                          }}>Yes</Button>
                          <Button key={`preset-no-${p.file}`} variant="secondary" onPress={() => update($, confirmTrash, () => '')}>No</Button>
                        </Box>
                      )
                      : <Button key={`preset-del-${p.file}`} plain dimColor onPress={() => update($, confirmTrash, () => `preset:${p.file}`)}>🗑</Button>}
                  </Box>
                </Box>
              )
            })}
          </Box>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={1}>
            <Text dimColor>Save the current setup as a preset</Text>
            <Button key="add-btn-preset" plain dimColor onPress={() => { void setEdit('preset') }}>{editKey === 'preset' ? 'Cancel' : '＋ Save as preset'}</Button>
          </Box>
          {editKey === 'preset'
            ? <Input key="save-preset" placeholder="Name it, e.g. AI YouTube" submitLabel="Save" autoFocus onSubmit={async (v: string) => {
              const out = await savePreset(ctx, v)
              await update($, notice, () => out)
              await update($, editing, () => '')
            }} />
            : null}
          {note && which === 'setup' ? <Text color={note.startsWith('✓') ? 'green' : 'yellow'}>{note}</Text> : null}
        </Card>

        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          {Svg ? <Svg source={logo(22)} width={22} height={22} alt="Trend Radar" isInteractive /> : null}
          <Text bold>Trend Radar</Text>
          <Text dimColor>v{VERSION} · made by</Text>
          <Link href={MADE_BY} label="Calvin Hia ↗" />
          <Text dimColor>·</Text>
          <Link href={REPO} label="GitHub ↗" />
          <Text dimColor>· all of this is settings.json; edit it by hand or tell Claude.</Text>
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" paddingX={1}>
        {header}
        {which === 'ideas' ? ideasTab() : which === 'saved' ? savedTab() : which === 'competitors' ? competitorsTab() : setupTab()}
      </Box>
    )
  })
}
