// The runs. They never touch `$`: the hook hands them an Io of closures.
import type { TrendChannel, TrendConfig, TrendReport, TrendSources } from '../types'
import {
  brandBrief,
  briefPrompt,
  checkPrompt,
  isoDaysAgo,
  matchesTopic,
  outliers,
  parseIdeas,
  scoreChannel,
  trimX,
  xLaunchQuery,
  type Video,
  type VideoRow,
} from './lib'

export type Io = {
  listTools: () => Promise<string[]>
  // Direct MCP call: server name, tool name, args. Answers MCP content blocks.
  mcpCall: (server: string, tool: string, args: Record<string, unknown>) => Promise<{ content?: { type: string; text?: string }[]; isError?: boolean }>
  complete: (req: { system: string; prompt: string; maxTokens: number }) => Promise<{ isAnswered: boolean; text?: string; reason?: string }>
  setStatus: (s: string) => Promise<unknown>
  sleep?: (ms: number) => Promise<void>
}

// treg's MCP server id differs per install: find it from its `call` tool's name.
export async function tregServer(io: Io): Promise<string> {
  const names = await io.listTools()
  const call = names.find(n => n.endsWith('__call') && names.includes(n.replace(/__call$/, '__catalog_search')))
  if (!call) throw new Error('treg is not connected. Add the treg connector (treg.to) and try again.')
  return call.replace(/^mcp__/, '').replace(/__call$/, '')
}

function explain(msg: string): string {
  return msg.includes('classifier')
    ? 'Auto mode blocks mods from calling treg. Switch the mode picker out of Auto, then refresh.'
    : msg
}

// The distinct errors of one run, so an empty result can say why.
function errorLog() {
  const list: string[] = []
  return {
    list,
    note(where: string, err: unknown) {
      const msg = explain((err instanceof Error ? err.message : String(err)).slice(0, 240))
      if (!list.some(e => e.endsWith(msg)) && list.length < 3) list.push(`${where}: ${msg}`)
    },
  }
}

const BLIP = /QueuePool|timed out|timeout|ECONNRESET|503|502|504|overloaded|try again/i

async function tregOnce(io: Io, server: string, input: Record<string, unknown>): Promise<{ body: any; cost: number }> {
  const r = await io.mcpCall(server, 'call', input)
  const text = (r.content ?? []).map(c => c.text ?? '').join('')
  if (r.isError) throw new Error(`treg error: ${text.slice(0, 200)}`)
  let j: any
  try {
    j = JSON.parse(text || '{}')
  } catch {
    throw new Error(`treg answered with text, not data: ${text.slice(0, 200)}`)
  }
  if (j.status && j.status >= 400) throw new Error(`${input.endpoint_id} answered ${j.status}: ${JSON.stringify(j.body).slice(0, 150)}`)
  return { body: j.body, cost: Number(j.cost_usd ?? 0) }
}

// A treg call, retried up to three times when treg itself hiccups (a full connection pool, a timeout, a 5xx).
async function treg(io: Io, server: string, input: Record<string, unknown>): Promise<{ body: any; cost: number }> {
  let last: unknown
  for (let i = 0; i < 3; i++) {
    try {
      return await tregOnce(io, server, input)
    } catch (err) {
      last = err
      const msg = err instanceof Error ? err.message : String(err)
      if (!BLIP.test(msg) || i === 2) throw err
      await io.setStatus(`treg hiccup, trying again (${i + 2}/3)…`)
      await (io.sleep ? io.sleep(4000) : Promise.resolve())
    }
  }
  throw last
}

// The team's balance in micro-dollars, or null when treg will not say.
export async function balanceMicro(io: Io, server: string): Promise<number | null> {
  try {
    const r = await io.mcpCall(server, 'balance', {})
    const j = JSON.parse((r.content ?? []).map(c => c.text ?? '').join('') || '{}')
    const micro = Number(j.balance_micro)
    return Number.isFinite(micro) ? micro : null
  } catch {
    return null
  }
}

// What a run really cost: the balance before minus the balance after, once the
// holds settle. Each call's `cost_usd` is only the hold, often more than the bill.
export async function spentSince(io: Io, server: string, before: number | null, heldSum: number): Promise<number> {
  if (before === null) return heldSum
  for (let i = 0; i < 3; i++) {
    await (io.sleep ? io.sleep(2500) : Promise.resolve())
    const after = await balanceMicro(io, server)
    if (after === null) break
    const spent = (before - after) / 1_000_000
    // Holds in flight settle within seconds; once the figure stops at or below the holds, it is the bill.
    if (spent <= heldSum + 1e-9 && i > 0) return Math.max(0, spent)
    if (i === 2) return Math.max(0, spent)
  }
  return heldSum
}

async function pool<T>(n: number, jobs: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = []
  let i = 0
  const worker = async () => {
    while (i < jobs.length) {
      const k = i++
      out[k] = await jobs[k]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker))
  return out
}

type Scanned = { channel: string; median: number; videos: Video[] }

async function fetchChannel(io: Io, server: string, channel: string): Promise<{ scanned: Scanned; cost: number }> {
  const { body, cost } = await treg(io, server, {
    endpoint_id: 'crawl4ai.youtube.channel.videos',
    body: { channel, limit: 30 },
  })
  return { scanned: { channel, ...scoreChannel(channel, (body?.rows ?? []) as VideoRow[]) }, cost }
}

function toChannel(s: Scanned): TrendChannel {
  return {
    handle: s.channel,
    median: s.median,
    scannedAt: new Date().toISOString(),
    videos: s.videos.map(v => ({ title: v.title, views: v.views, url: v.url, thumb: v.thumbnail ?? '', multiple: v.multiple, ageDays: v.ageDays })),
  }
}

// Checks a handle before it joins the list: does YouTube know it?
export async function verifyChannel(io: Io, handle: string): Promise<{ ok: boolean; channel?: TrendChannel; why?: string }> {
  try {
    const server = await tregServer(io)
    const { scanned } = await fetchChannel(io, server, handle)
    if (scanned.videos.length === 0) return { ok: false, why: 'no channel or no videos found' }
    return { ok: true, channel: toChannel(scanned) }
  } catch (err) {
    return { ok: false, why: explain(err instanceof Error ? err.message : String(err)) }
  }
}

async function fetchAll(io: Io, server: string, cfg: TrendConfig, log: ReturnType<typeof errorLog>) {
  let cost = 0
  let done = 0
  const all = [cfg.channel, ...cfg.competitors]
  const results = await pool(4, all.map(channel => async () => {
    try {
      const r = await fetchChannel(io, server, channel)
      cost += r.cost
      return r.scanned
    } catch (err) {
      log.note(channel, err)
      return { channel, median: 0, videos: [] as Video[] }
    } finally {
      await io.setStatus(`YouTube ${++done}/${all.length}…`)
    }
  }))
  const own = results[0] ?? { channel: cfg.channel, median: 0, videos: [] }
  const competitors = results.slice(1)
  if (competitors.every(c => c.videos.length === 0)) {
    throw new Error(`no competitor data came back. ${log.list.join(' | ') || 'No error text.'}`)
  }
  return { own, competitors, cost }
}

async function searchX(io: Io, server: string, query: string, log: ReturnType<typeof errorLog>) {
  try {
    const { body, cost } = await treg(io, server, {
      endpoint_id: 'anyapi.x.search.posts',
      body: { query, limit: 40, queryType: 'Top' },
    })
    return { posts: trimX(body?.output?.data?.items ?? [], Date.now() / 1000), cost }
  } catch (err) {
    log.note('X search', err)
    return { posts: [], cost: 0 }
  }
}

const short = (v: Video) => ({ channel: v.channel, title: v.title, views: v.views, x: v.multiple, days: v.ageDays, url: v.url })

export async function runBrief(io: Io, cfg: TrendConfig, note = ''): Promise<{ report: TrendReport; channels: TrendChannel[] }> {
  const log = errorLog()
  const server = await tregServer(io)
  const before = await balanceMicro(io, server)
  const yt = await fetchAll(io, server, cfg, log)
  await io.setStatus('Searching X…')
  const launches = await searchX(io, server, xLaunchQuery(cfg, isoDaysAgo(Math.min(cfg.daysBack, 7))), log)

  const proven: Video[] = []
  const rising: Video[] = []
  for (const c of yt.competitors) {
    const o = outliers(c.videos, cfg.daysBack)
    proven.push(...o.proven)
    rising.push(...o.rising)
  }
  proven.sort((a, b) => b.multiple - a.multiple)
  const data = {
    proven: proven.slice(0, 40).map(short),
    rising: rising.slice(0, 15).map(short),
    creatorRecentTitles: yt.own.videos.slice(0, 25).map(v => `${v.title} (${v.views} views, ${v.multiple}x)`),
    xLaunches: launches.posts.slice(0, 25),
  }

  await io.setStatus('Claude is ranking ideas…')
  const r = await io.complete({ system: brandBrief(cfg), prompt: briefPrompt(data, cfg.pillars.length, cfg.ideasCount, note), maxTokens: 4000 })
  if (!r.isAnswered) throw new Error(`Claude gave no answer (${r.reason})`)
  const parsed = parseIdeas(r.text ?? '', cfg.pillars, cfg.ideasCount)
  // Put each proof video's real multiple on its link, for the proof chart.
  const byUrl = new Map(yt.competitors.flatMap(c => c.videos).map(v => [v.url, v] as const))
  for (const idea of parsed?.ideas ?? []) {
    idea.proof = idea.proof.map(p => {
      const v = byUrl.get(p.url)
      return v ? { ...p, multiple: v.multiple } : p
    })
  }
  const sources: TrendSources = {
    channels: yt.competitors.filter(c => c.videos.length > 0).length,
    channelsTotal: cfg.competitors.length,
    outliers: proven.length,
    xPosts: launches.posts.length,
    google: false,
    costUsd: await spentSince(io, server, before, yt.cost + launches.cost),
    failed: log.list,
  }
  return {
    report: {
      at: new Date().toISOString(),
      kind: 'brief',
      ideas: parsed?.ideas ?? [],
      freshOnX: parsed?.freshOnX ?? [],
      skip: parsed?.skip ?? [],
      markdown: parsed ? '' : (r.text ?? ''),
      sources,
      note,
      daysBack: cfg.daysBack,
    },
    channels: [yt.own, ...yt.competitors].filter(c => c.videos.length > 0).map(toChannel),
  }
}

// A topic verdict as Markdown, plus what it cost.
export async function runCheck(io: Io, cfg: TrendConfig, topic: string, cached: TrendChannel[]): Promise<{ markdown: string; costUsd: number }> {
  const log = errorLog()
  const server = await tregServer(io)
  const before = await balanceMicro(io, server)
  // Reuse a scan from the last 12 hours: a check then costs two calls, not seventeen.
  const fresh = cached.length > 0 && Date.now() - Date.parse(cached[0]!.scannedAt) < 12 * 3600_000
  type Row = { channel: string; title: string; views: number; x: number; days: number; url: string }
  let videos: Row[]
  let own: Row[]
  let ytCost = 0
  if (fresh) {
    const flat = cached.flatMap(c => c.videos.map(v => ({ channel: c.handle, title: v.title, views: v.views, x: v.multiple, days: v.ageDays, url: v.url })))
    own = flat.filter(v => v.channel === cfg.channel)
    videos = flat.filter(v => v.channel !== cfg.channel)
  } else {
    const yt = await fetchAll(io, server, cfg, log)
    ytCost = yt.cost
    own = yt.own.videos.map(short)
    videos = yt.competitors.flatMap(c => c.videos.map(short))
  }
  await io.setStatus(`Checking "${topic}" on X and Google…`)
  const x = await searchX(io, server, `${topic} min_faves:20 since:${isoDaysAgo(14)}`, log)
  let volume: unknown = 'unavailable'
  let volCost = 0
  try {
    const { body, cost } = await treg(io, server, {
      endpoint_id: 'serpstat.google.keywords.volume',
      body: { method: 'SerpstatKeywordProcedure.getKeywordsInfo', id: '1', params: { keywords: [topic.toLowerCase()], se: 'g_us' } },
    })
    volCost = cost
    const rows = body?.result?.data ?? []
    volume = rows.map((k: any) => ({ keyword: k.keyword, monthlySearches: k.region_queries_count, cpc: k.cost }))
  } catch (err) {
    log.note('Google volume', err)
  }
  const matches = videos.filter(v => matchesTopic(v.title, topic)).sort((a, b) => b.x - a.x)
  const data = {
    competitorMatches: matches.slice(0, 25),
    creatorMatches: own.filter(v => matchesTopic(v.title, topic)),
    xPosts: x.posts.slice(0, 15),
    googleUS: volume,
  }
  const r = await io.complete({ system: brandBrief(cfg), prompt: checkPrompt(topic, data), maxTokens: 1200 })
  if (!r.isAnswered) throw new Error(`Claude gave no answer (${r.reason})`)
  return { markdown: r.text ?? '', costUsd: await spentSince(io, server, before, ytCost + x.cost + volCost) }
}
