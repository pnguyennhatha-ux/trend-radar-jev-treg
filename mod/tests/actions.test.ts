import { expect, test } from 'claude-code/testing'

import { addCompetitor, checkTreg, ideaMarkdown, listPresets, loadConfig, loadPreset, saveIdea, savePreset, slug, type Ctx } from '../hooks/actions'
import { EMPTY_CONFIG, isConfigured } from '../hooks/lib'

function fakeCtx(files: Record<string, string>) {
  const toasts: string[] = []
  let savedIds: string[] = []
  const ctx = {
    dir: '/r',
    readFile: async (p: string) => files[p] ?? null,
    writeFile: async (p: string, t: string) => { files[p] = t },
    listDir: async (d: string) => Object.keys(files).filter(k => k.startsWith(`${d}/`)).map(k => k.slice(d.length + 1)),
    setConfig: async () => {},
    setDirs: async () => { savedIds = ['saved'] },
    toast: (s: string) => { toasts.push(s) },
  } as unknown as Ctx
  return { ctx, files, toasts, ids: () => savedIds }
}

test('missing or broken settings start empty, not configured', async () => {
  expect(await loadConfig(fakeCtx({}).ctx)).toEqual(EMPTY_CONFIG)
  expect(await loadConfig(fakeCtx({ '/r/settings.json': '{oops' }).ctx)).toEqual(EMPTY_CONFIG)
  expect(isConfigured(EMPTY_CONFIG)).toBe(false)
})

test('adding a competitor saves the file at once, no duplicates', async () => {
  const f = fakeCtx({ '/r/settings.json': JSON.stringify({ trendRadar: 1, competitors: ['@a'] }) })
  expect(await addCompetitor(f.ctx, 'youtube.com/@b')).toContain('Added @b')
  expect(JSON.parse(f.files['/r/settings.json']!).competitors).toEqual(['@a', '@b'])
  expect(JSON.parse(f.files['/r/settings.json']!).trendRadar).toBe(1)
  expect(await addCompetitor(f.ctx, '@b')).toContain('already')
})

test('saving an idea makes its folder with idea.md and marks it saved', async () => {
  const f = fakeCtx({})
  const idea = { id: 'i1', title: 'Claude replaces Premiere!', pillar: 'P', score: 8, whyNow: 'w', angle: 'a', sponsor: 's', topic: 't', noteFit: '', signals: { youtube: 1, x: 1, fit: 1, fresh: 1 }, proof: [{ label: 'J', url: 'https://y.com' }] }
  const path = await saveIdea(f.ctx, idea, [])
  expect(path).toMatch(/^\/r\/ideas\/\d{4}-\d{2}-\d{2}-claude-replaces-premiere$/)
  expect(f.files[`${path}/idea.md`]).toContain('# Claude replaces Premiere!')
  expect(f.files[`${path}/idea.md`]).toContain('[J](https://y.com)')
  expect(f.ids()).toEqual(['saved'])
  expect(slug('  !!! ')).toBe('idea')
  expect(ideaMarkdown(idea, '2026-10-12T00:00:00Z')).toContain('**Score:** 8/10')
})

test('presets save the current setup and load back into settings.json', async () => {
  const cfg = { trendRadar: 1, channel: '@me', audience: 'devs', pillars: ['A: a', 'B: b'], competitors: ['@1', '@2', '@3', '@4', '@5'], xKeywords: ['Claude'], sponsorTypes: ['SaaS'] }
  const f = fakeCtx({ '/r/settings.json': JSON.stringify(cfg) })
  expect(await savePreset(f.ctx, 'AI YouTube')).toContain('presets/ai-youtube.json')
  expect(await listPresets(f.ctx)).toEqual([{ file: 'ai-youtube.json', name: 'AI YouTube' }])
  f.files['/r/settings.json'] = '{}'
  expect(isConfigured(await loadConfig(f.ctx))).toBe(false)
  expect(await loadPreset(f.ctx, 'ai-youtube.json')).toContain('Loaded')
  const back = await loadConfig(f.ctx)
  expect(back.channel).toBe('@me')
  expect(isConfigured(back)).toBe(true)
})

test('treg check tells missing, blocked and ok apart', async () => {
  const io = (names: string[], call: () => Promise<any>) => ({ listTools: async () => names, mcpCall: call } as any)
  const treg = ['mcp__abc__call', 'mcp__abc__catalog_search']
  expect((await checkTreg(io([], async () => ({})))).treg).toBe('missing')
  expect((await checkTreg(io(treg, async () => { throw new Error('auto mode classifier gave no verdict') }))).treg).toBe('blocked')
  expect((await checkTreg(io(treg, async () => ({ content: [{ type: 'text', text: '{}' }] })))).treg).toBe('ok')
})
