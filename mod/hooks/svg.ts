// Small drawings for the desktop app. Words are the app's own text; only
// charts and pictures are drawn here, so sizes match everywhere.
import type { TrendVideo } from '../types'
import { compact } from './lib'

const FONT = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif`

export const PILLAR_COLORS = ['#FF6B4A', '#3B82F6', '#22C55E', '#A855F7', '#EAB308']

// Text and track colours follow the viewer's light or dark mode.
const THEME = `<style>
.t{fill:#18181B}.m{fill:#71717A}.track{fill:#E4E4E7}
@media (prefers-color-scheme: dark){.t{fill:#FAFAFA}.m{fill:#A1A1AA}.track{fill:#2A2A2E}}
</style>`

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// The mark: a radar sweep in coral, a hot dot caught on the ring. The sweep turns
// and the dot blinks as it passes; a surface without animation shows the still frame.
export function logo(size = 28, withWord = false): string {
  const w = withWord ? size * 5.6 : size
  const c = size / 2
  const r = size / 2 - 1
  const word = withWord
    ? `<text x="${size + size * 0.4}" y="${c + size * 0.28}" font-family="${FONT}" font-size="${size * 0.78}" font-weight="700" letter-spacing="-0.5" class="t">Trend Radar</text>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${size}" viewBox="0 0 ${w} ${size}">${THEME}
<defs><linearGradient id="sw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FC6467" stop-opacity="0.85"/><stop offset="1" stop-color="#FC6467" stop-opacity="0"/></linearGradient></defs>
<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#FC6467" stroke-opacity="0.35" stroke-width="${size * 0.06}"/>
<circle cx="${c}" cy="${c}" r="${r * 0.55}" fill="none" stroke="#FC6467" stroke-opacity="0.35" stroke-width="${size * 0.06}"/>
<g>
<path d="M ${c} ${c} L ${c} ${c - r} A ${r} ${r} 0 0 1 ${c + r * 0.866} ${c - r * 0.5} Z" fill="url(#sw)"/>
<line x1="${c}" y1="${c}" x2="${c}" y2="${c - r}" stroke="#FC6467" stroke-width="${size * 0.08}" stroke-linecap="round"/>
<animateTransform attributeName="transform" type="rotate" from="0 ${c} ${c}" to="360 ${c} ${c}" dur="4s" repeatCount="indefinite"/>
</g>
<circle cx="${c + r * 0.62}" cy="${c - r * 0.3}" r="${size * 0.11}" fill="#FC6467">
<animate attributeName="opacity" values="1;1;0.25;0.25;1" keyTimes="0;0.12;0.3;0.9;1" dur="4s" repeatCount="indefinite"/>
<animate attributeName="r" values="${size * 0.11};${size * 0.15};${size * 0.11}" keyTimes="0;0.06;0.14" dur="4s" repeatCount="indefinite"/>
</circle>
<circle cx="${c}" cy="${c}" r="${size * 0.07}" fill="#FC6467"/>
${word}</svg>`
}

// 🟢 strong · 🟡 okay · 🔴 weak
export function scoreColor(score: number): string {
  return score >= 8 ? '#22C55E' : score >= 5 ? '#EAB308' : '#EF4444'
}

// The score as a ring, drawn at a fixed small size so it never scales.
export function scoreRing(score: number, size = 40): string {
  const r = size / 2 - 3
  const c = size / 2
  const circ = 2 * Math.PI * r
  const sc = scoreColor(score)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${THEME}
<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#71717A" stroke-opacity="0.22" stroke-width="4"/>
<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${sc}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(circ * Math.min(Math.max(score, 0), 10)) / 10} ${circ}" transform="rotate(-90 ${c} ${c})"/>
<text class="t" x="${c}" y="${c + 5}" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="700">${score}</text>
</svg>`
}

// One plain bar, 0..max, no words. Drawn at a fixed width so it never stretches.
export function bar(value: number, max: number, color: string, width = 160, height = 8, markAt?: number): string {
  const v = Math.min(Math.max(value, 0), max)
  const fill = Math.max(height, (width * v) / max)
  const mark = markAt !== undefined && markAt > 0 && markAt < max
    ? `<line x1="${((width * markAt) / max).toFixed(1)}" x2="${((width * markAt) / max).toFixed(1)}" y1="0" y2="${height}" stroke="#71717A" stroke-dasharray="2 2" stroke-width="1"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${THEME}
<rect class="track" x="0" y="0" width="${width}" height="${height}" rx="${height / 2}"/>
<rect x="0" y="0" width="${fill.toFixed(1)}" height="${height}" rx="${height / 2}" fill="${color}"/>
${mark}</svg>`
}

// A generated thumbnail, from its small base64 JPEG preview, with rounded corners.
export function previewImage(base64: string, width = 480): string {
  const h = Math.round((width * 9) / 16)
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">
<defs><clipPath id="p"><rect width="${width}" height="${h}" rx="10"/></clipPath></defs>
<g clip-path="url(#p)"><image href="data:image/jpeg;base64,${base64}" xlink:href="data:image/jpeg;base64,${base64}" width="${width}" height="${h}" preserveAspectRatio="xMidYMid slice"/></g>
</svg>`
}

// One video tile: the thumbnail from cached bytes (web pictures cannot load inside a drawing), multiple badge.
export function thumbTile(v: TrendVideo, base64: string, width = 168): string {
  const h = Math.round((width * 9) / 16)
  const badge = `${v.multiple}x`
  const pic = base64
    ? `<image href="data:image/jpeg;base64,${base64}" xlink:href="data:image/jpeg;base64,${base64}" width="${width}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
    : `<text x="${width / 2}" y="${h / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#8E8E93">loading…</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">
<defs><clipPath id="c"><rect width="${width}" height="${h}" rx="10"/></clipPath>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2C2C2E"/><stop offset="1" stop-color="#48484A"/></linearGradient></defs>
<g clip-path="url(#c)"><rect width="${width}" height="${h}" fill="url(#g)"/>${pic}</g>
<rect x="${width - 46}" y="6" width="40" height="20" rx="10" fill="${v.multiple >= 2.5 ? '#FF6B4A' : '#000'}" opacity="0.85"/>
<text x="${width - 26}" y="20" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="700" fill="#fff">${esc(badge)}</text>
</svg>`
}
