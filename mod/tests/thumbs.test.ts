import { expect, test } from 'claude-code/testing'

import { ensureDir, inspoFor, listReferences, saveIdea, scanDirs, thumbGenerate, thumbNote, thumbStart, type Ctx } from '../hooks/actions'
import { THUMB_LOCK, assemblePrompt, imageRoles, ytThumbUrl, ytVideoId } from '../hooks/lib'
import type { TrendIdea, TrendIdeaDir } from '../types'

const IDEA: TrendIdea = {
  id: 'i1', title: 'Any Site. Cloned.', pillar: 'Build: sites', score: 8, whyNow: 'w', angle: 'a', sponsor: 's', topic: 't', noteFit: '',
  signals: { youtube: 8, x: 5, fit: 9, fresh: 6 },
  proof: [{ label: '@a repo', url: 'https://www.youtube.com/watch?v=abcdefghijk', multiple: 29.3 }, { label: 'x post', url: 'https://x.com/p/1' }],
}

test('YouTube links give their thumbnail picture', async () => {
  expect(ytVideoId('https://www.youtube.com/watch?v=abcdefghijk&t=1')).toBe('abcdefghijk')
  expect(ytVideoId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk')
  expect(ytThumbUrl('https://www.youtube.com/shorts/abcdefghijk')).toBe('https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg')
  expect(ytThumbUrl('https://x.com/p/1')).toBe('')
  expect(inspoFor(IDEA)).toEqual([{ label: '@a repo', url: 'https://www.youtube.com/watch?v=abcdefghijk', thumb: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', file: 'inspo/01-a-repo.jpg', multiple: 29.3 }])
})

test('the prompt names every image by role, then the brief, then the note', async () => {
  const roles = imageRoles(3, ['logo.png'], 2)
  expect(roles).toContain(THUMB_LOCK)
  expect(roles).toContain('[Image 2] to [Image 3]: the same person')
  expect(roles).toContain('[Image 4]: logo.png')
  expect(roles).toContain('[Image 5] to [Image 6]: other creators')
  const generic = imageRoles(0, [], 1)
  expect(generic).toContain('generic')
  expect(generic).toContain('[Image 1]: other creators')
  const p = assemblePrompt('# Thumbnail brief: X\n\n## Text\n"GO"\n', 1, [], 1, 'text in red', 'coral accents')
  expect(p).not.toContain('# Thumbnail brief')
  expect(p).toContain('## Text\n"GO"')
  expect(p).toContain('Brand style: coral accents')
  expect(p).toContain("THE CREATOR'S NOTE")
  expect(p).toContain('text in red')
  expect(p).toContain('Likeness of the subject')
  expect(assemblePrompt('b', 0, [], 0, '', '')).not.toContain('Likeness of the subject')
})

function fakeCtx(files: Record<string, string>, io: Partial<Ctx['io']>) {
  let all: TrendIdeaDir[] = []
  const toasts: string[] = []
  const ctx = {
    dir: '/r',
    io: { complete: async () => ({ isAnswered: false, reason: 'unused' }), setStatus: async () => {}, listTools: async () => ['mcp__t__call', 'mcp__t__catalog_search'], sleep: async () => {}, run: async () => ({ exitCode: 0, stdout: '', stderr: '' }), readBytes: async () => 'QUJD', ...io },
    readFile: async (p: string) => files[p] ?? null,
    writeFile: async (p: string, t: string) => { files[p] = t },
    listDir: async (d: string) => [...new Set(Object.keys(files).filter(k => k.startsWith(`${d}/`)).map(k => k.slice(d.length + 1).split('/')[0]!))],
    setDirs: async (fn: (a: TrendIdeaDir[]) => TrendIdeaDir[]) => { all = fn(all) },
    setStatus: async () => {},
    openPath: async () => {},
    toast: (s: string) => { toasts.push(s) },
  } as unknown as Ctx
  return { ctx, files, toasts, dirs: () => all }
}

test('references/ lists photos in name order', async () => {
  const f = fakeCtx({ '/r/references/02-smile.jpg': 'x', '/r/references/01-face.jpg': 'x', '/r/references/notes.txt': 'x', '/r/references/.DS_Store': 'x' }, {})
  expect((await listReferences(f.ctx)).map(r => r.name)).toEqual(['01-face.jpg', '02-smile.jpg'])
})

test('save makes the idea folder once; a second save or a thumbnail start reuses it', async () => {
  const f = fakeCtx({}, {})
  const path = await saveIdea(f.ctx, IDEA, [])
  expect(path).toMatch(/^\/r\/ideas\/\d{4}-\d{2}-\d{2}-any-site-cloned$/)
  expect(f.files[`${path}/idea.md`]).toContain('# Any Site. Cloned.')
  expect(f.files[`${path}/idea.md`]).toContain('29.3x')
  const meta = JSON.parse(f.files[`${path}/meta.json`]!)
  expect(meta.slug).toBe('any-site-cloned')
  expect(meta.inspo).toHaveLength(1)
  expect(f.dirs()).toHaveLength(1)
  expect(f.toasts[0]).toContain('Saved to ideas/')
  const again = await ensureDir(f.ctx, IDEA, f.dirs())
  expect(again.path).toBe(path)
  const scanned = await scanDirs(f.ctx)
  expect(scanned).toHaveLength(1)
  expect(scanned[0]!.title).toBe('Any Site. Cloned.')
  expect(scanned[0]!.brief).toBe('')
})

test('thumbnail start downloads the winners into inspo/ and waits for the brief', async () => {
  const argvs: string[][] = []
  const f = fakeCtx({}, { run: async (argv: string[]) => { argvs.push(argv); return { exitCode: 0, stdout: '', stderr: '' } } })
  const d = await thumbStart(f.ctx, IDEA, [])
  expect(argvs[0]![0]).toBe('curl')
  expect(argvs[0]!.at(-1)).toBe('https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg')
  expect(argvs[0]).toContain(`${d.path}/inspo/01-a-repo.jpg`)
  expect(d.status).toContain('Brief in chat')
  expect(d.inspo).toHaveLength(1)
  await thumbNote(f.ctx, d, ' red text ')
  expect(JSON.parse(f.files[`${d.path}/meta.json`]!).note).toBe('red text')
})

test('generate: brief + photos + refs + winners -> upload, GPT Image, download, preview', async () => {
  const calls: string[] = []
  const argvs: string[][] = []
  const f = fakeCtx(
    { '/r/settings.json': JSON.stringify({ trendRadar: 1, thumbQuality: 'high' }), '/r/references/01-face.jpg': 'x' },
    {
      run: async (argv: string[]) => {
        argvs.push(argv)
        if (argv[0] === 'curl' && argv.includes('-F')) return { exitCode: 0, stdout: 'https://litter.catbox.moe/abc.jpg\n', stderr: '' }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
      mcpCall: async (_s: string, _t: string, args: any) => {
        if (args.endpoint_id) calls.push(args.endpoint_id)
        if (!args.endpoint_id) return { content: [{ type: 'text', text: '{}' }] }
        if (args.endpoint_id === 'reapi.image-gen.gpt-image-2-5') expect(args.body.image_urls).toHaveLength(3)
        const body = args.endpoint_id === 'reapi.tasks.get'
          ? { status: 'completed', output: { image_urls: ['https://file.example/0.png'] } }
          : { id: 'task1', status: 'processing' }
        return { content: [{ type: 'text', text: JSON.stringify({ status: 200, body, cost_usd: 0.01 }) }] }
      },
    },
  )
  const d0 = await thumbStart(f.ctx, IDEA, [])
  f.files[`${d0.path}/brief.md`] = '# Thumbnail brief: X\n\n## Text\n"GO"\n'
  f.files[`${d0.path}/refs/logo.png`] = 'x'
  const d = (await scanDirs(f.ctx))[0]!
  expect(d.brief).toContain('"GO"')
  await thumbNote(f.ctx, d, 'red text')
  expect(d.refs).toEqual(['logo.png'])
  const out = await thumbGenerate(f.ctx, d)
  expect(out).toContain(`v1 saved at ${d.path}/thumbnails/v1.png`)
  expect(out).toContain('GPT Image 2.5')
  expect(calls).toEqual(['reapi.image-gen.gpt-image-2-5', 'reapi.tasks.get'])
  const prompt = f.files[`${d.path}/thumbnails/v1-prompt.txt`]!
  expect(prompt).toContain('[Image 2]: logo.png')
  expect(prompt).toContain('[Image 3]: other creators')
  expect(prompt).toContain('"GO"')
  expect(prompt).toContain('red text')
  const meta = JSON.parse(f.files[`${d.path}/meta.json`]!)
  expect(meta.versions).toHaveLength(1)
  expect(meta.status).toBe('')
  expect(argvs.some(a => a[0] === 'sips' && a.includes('160'))).toBe(true)
  expect(f.toasts.at(-1)).toContain('v1 ready')
})

test('generate falls back to Nano Banana 2 when the upload host fails', async () => {
  const calls: string[] = []
  const f = fakeCtx(
    { '/r/settings.json': JSON.stringify({ trendRadar: 1 }), '/r/references/01-face.jpg': 'x' },
    {
      run: async (argv: string[]) => (argv[0] === 'curl' && argv.includes('-F') ? { exitCode: 7, stdout: '', stderr: 'host down' } : { exitCode: 0, stdout: '', stderr: '' }),
      mcpCall: async (_s: string, _t: string, args: any) => {
        if (args.endpoint_id) calls.push(args.endpoint_id)
        if (!args.endpoint_id) return { content: [{ type: 'text', text: '{}' }] }
        return { content: [{ type: 'text', text: JSON.stringify({ status: 200, body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } }] }, finishReason: 'STOP' }] }, cost_usd: 0.067 }) }] }
      },
    },
  )
  const d0 = await ensureDir(f.ctx, IDEA, [])
  f.files[`${d0.path}/brief.md`] = 'face left, text right'
  const d = (await scanDirs(f.ctx))[0]!
  const out = await thumbGenerate(f.ctx, d)
  expect(out).toContain('Nano Banana 2')
  expect(calls).toEqual(['google-ai.image-gen.gemini-3-1-flash-image'])
  expect(JSON.parse(f.files[`${d.path}/meta.json`]!).status).toContain('Nano Banana 2 drew it')
  expect(await thumbGenerate(f.ctx, { ...d, path: '/r/ideas/none', name: 'none' })).toContain('no brief.md')
})
