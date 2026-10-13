// Making the picture through treg. GPT Image 2.5 needs web links for local
// images, so each one is shrunk and put on a one-hour throwaway link. If that
// host is down, the picture is made with Google's Nano Banana 2 instead, which
// takes the bytes.
import type { TrendConfig } from '../types'
import { balanceMicro, spentSince, tregServer, type Io } from './run'

// What the thumbnail steps need from the host, beyond Io.
export type ThumbIo = Io & {
  run: (argv: string[], init?: { stdin?: string; timeoutMs?: number }) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  readBytes: (path: string) => Promise<string>
  sleep: (ms: number) => Promise<void>
}

const HOST_URL = 'https://litterbox.catbox.moe/resources/internals/api.php'
const GPT_SIZE = '1536x1024'

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

// A picture shrunk for upload: 1024px on the long side, JPEG.
async function shrink(io: ThumbIo, src: string, out: string): Promise<void> {
  const r = await io.run(['sips', '-Z', '1024', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', src, '--out', out], { timeoutMs: 30_000 })
  if (r.exitCode !== 0) throw new Error(`could not read ${src.split('/').pop()}: ${r.stderr.slice(0, 120)}`)
}

// Puts a file on a throwaway link that dies in an hour. Answers the link.
export async function hostFile(io: ThumbIo, path: string): Promise<string> {
  const r = await io.run(['curl', '-sS', '--max-time', '60', '-F', 'reqtype=fileupload', '-F', 'time=1h', '-F', `fileToUpload=@${path}`, HOST_URL], { timeoutMs: 70_000 })
  const url = r.stdout.trim()
  if (r.exitCode !== 0 || !/^https:\/\/\S+\.(jpg|jpeg|png)$/i.test(url)) throw new Error(`upload failed: ${(r.stderr || r.stdout).slice(0, 120) || 'no link came back'}`)
  return url
}

// Downloads a web picture to a file. Quiet on failure: the caller decides what that means.
export async function download(io: ThumbIo, url: string, outPath: string): Promise<boolean> {
  const r = await io.run(['curl', '-sSL', '--max-time', '30', '-o', outPath, url], { timeoutMs: 40_000 })
  return r.exitCode === 0
}

type Made = { model: string; costUsd: number }

async function viaGpt(io: ThumbIo, server: string, cfg: TrendConfig, prompt: string, urls: string[], outPath: string): Promise<Made> {
  const submit = await treg(io, server, {
    endpoint_id: 'reapi.image-gen.gpt-image-2-5',
    body: { model: 'gpt-image-2.5-flare-official', prompt, size: GPT_SIZE, quality: cfg.thumbQuality, n: 1, image_urls: urls },
  })
  const id = String(submit.body?.id ?? '')
  if (!id) throw new Error(`GPT Image gave no task id: ${JSON.stringify(submit.body).slice(0, 150)}`)
  let cost = submit.cost
  let url = ''
  for (let i = 0; i < 48; i++) {
    await io.sleep(5000)
    const poll = await treg(io, server, { endpoint_id: 'reapi.tasks.get', method: 'GET', query: { id } })
    cost += poll.cost
    const status = String(poll.body?.status ?? '')
    if (status === 'completed') {
      url = String(poll.body?.output?.image_urls?.[0] ?? '')
      break
    }
    if (status === 'failed') throw new Error(`GPT Image failed: ${JSON.stringify(poll.body?.error ?? '').slice(0, 150)}`)
    await io.setStatus(`Drawing with GPT Image… ${(i + 1) * 5}s`)
  }
  if (!url) throw new Error('GPT Image took too long. Try again.')
  if (!(await download(io, url, outPath))) throw new Error('could not download the picture')
  return { model: 'GPT Image 2.5', costUsd: cost }
}

async function viaNanoBanana(io: ThumbIo, server: string, prompt: string, localPaths: string[], outPath: string): Promise<Made> {
  const parts: unknown[] = [{ text: prompt }]
  for (const p of localPaths) parts.push({ inlineData: { mimeType: 'image/jpeg', data: await io.readBytes(p) } })
  await io.setStatus('Drawing with Nano Banana 2…')
  const { body, cost } = await treg(io, server, {
    endpoint_id: 'google-ai.image-gen.gemini-3-1-flash-image',
    method: 'POST',
    query: { model: 'gemini-3.1-flash-image', fields: 'candidates(content(parts(text,inlineData)),finishReason),usageMetadata' },
    body: { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { imageSize: '1K', aspectRatio: '16:9' } } },
  })
  const cand = body?.candidates?.[0]
  const data = (cand?.content?.parts ?? []).find((p: any) => p?.inlineData?.data)?.inlineData?.data
  if (!data) throw new Error(`Nano Banana gave no picture (${cand?.finishReason ?? 'no answer'})`)
  const w = await io.run(['python3', '-I', '-c', 'import sys,base64;open(sys.argv[1],"wb").write(base64.b64decode(sys.stdin.read()))', outPath], { stdin: String(data), timeoutMs: 30_000 })
  if (w.exitCode !== 0) throw new Error(`could not save the picture: ${w.stderr.slice(0, 120)}`)
  return { model: 'Nano Banana 2', costUsd: cost }
}

export type ThumbJob = {
  cfg: TrendConfig
  prompt: string
  // Local images, in the order the prompt names them: the person, extra refs, the winners.
  images: string[]
  tmpDir: string
  outPath: string
}

// Makes one picture. Answers which model drew it and what it cost.
export async function runThumbImage(io: ThumbIo, job: ThumbJob): Promise<Made & { fallbackWhy: string }> {
  const server = await tregServer(io)
  const before = await balanceMicro(io, server)
  await io.setStatus(job.images.length ? `Preparing ${job.images.length} image${job.images.length > 1 ? 's' : ''}…` : 'Preparing…')
  const small: string[] = []
  for (let i = 0; i < job.images.length; i++) {
    const out = `${job.tmpDir}/img-${i + 1}.jpg`
    await shrink(io, job.images[i]!, out)
    small.push(out)
  }

  let fallbackWhy = ''
  try {
    const urls: string[] = []
    for (const p of small) {
      await io.setStatus(`Uploading image ${urls.length + 1}/${small.length} (1-hour link)…`)
      urls.push(await hostFile(io, p))
    }
    await io.setStatus('Drawing with GPT Image…')
    const made = await viaGpt(io, server, job.cfg, job.prompt, urls, job.outPath)
    return { ...made, costUsd: await spentSince(io, server, before, made.costUsd), fallbackWhy }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Only a hosting or GPT-side problem falls back; a treg problem is the same for both.
    if (/treg is not connected|classifier/.test(msg)) throw err
    fallbackWhy = msg
  }
  const made = await viaNanoBanana(io, server, job.prompt, small, job.outPath)
  return { ...made, costUsd: await spentSince(io, server, before, made.costUsd), fallbackWhy }
}

// A small JPEG next to the picture, for the panel. Answers whether it was made.
export async function makePreview(io: ThumbIo, src: string, out: string): Promise<boolean> {
  const r = await io.run(['sips', '-Z', '160', '-s', 'format', 'jpeg', '-s', 'formatOptions', '45', src, '--out', out], { timeoutMs: 30_000 })
  return r.exitCode === 0
}
