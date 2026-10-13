// Who the radar works for. Saved per person in $.store, so a shared copy is set up fresh.
export type TrendConfig = {
  channel: string
  audience: string
  pillars: string[]
  competitors: string[]
  xKeywords: string[]
  sponsorTypes: string[]
  // Standing notes Claude weighs on every run ("avoid crypto", "I have a Fish Audio deal").
  notes: string[]
  ideasCount: number
  daysBack: number
  // Thumbnails: image quality (price lever) and an optional brand style line.
  thumbQuality: 'low' | 'medium' | 'high'
  thumbStyle: string
}

export type TrendProof = { label: string; url: string; multiple?: number }

// What the score is made of, each 0-10.
export type TrendSignals = { youtube: number; x: number; fit: number; fresh: number }

export type TrendIdea = {
  id: string
  title: string
  pillar: string
  score: number
  whyNow: string
  angle: string
  sponsor: string
  proof: TrendProof[]
  topic: string
  // Which note shaped this idea, when one did.
  noteFit: string
  signals: TrendSignals
}

export type TrendSources = {
  channels: number
  channelsTotal: number
  outliers: number
  xPosts: number
  google: boolean
  costUsd: number
  failed: string[]
}

export type TrendVideo = { title: string; views: number; url: string; thumb: string; multiple: number; ageDays: number }

export type TrendChannel = {
  handle: string
  median: number
  videos: TrendVideo[]
  scannedAt: string
}

export type TrendReport = {
  at: string
  kind: 'brief' | 'check'
  topic?: string
  ideas: TrendIdea[]
  freshOnX: TrendProof[]
  skip: string[]
  // Plain text when Claude's answer could not be read as ideas, or a topic verdict.
  markdown: string
  sources: TrendSources
  // The one-off note this run was asked with.
  note: string
  daysBack: number
}

export type TrendTab = 'ideas' | 'saved' | 'competitors' | 'setup'

export type TrendHealth = { treg: 'ok' | 'missing' | 'blocked' | 'error' | 'unchecked'; why: string }

export type TrendPreset = { file: string; name: string }

// A photo in references/: the person the thumbnails show.
export type TrendRef = { name: string; path: string }

// A competitor thumbnail behind an idea, downloaded into the idea's inspo/ folder.
export type TrendInspo = { label: string; url: string; thumb: string; file: string; multiple?: number }

export type TrendThumbVersion = { path: string; model: string; at: string; costUsd: number }

// One idea's folder under ideas/: made when the idea is saved or a thumbnail is started.
export type TrendIdeaDir = {
  name: string
  path: string
  slug: string
  title: string
  at: string
  // What is happening with the thumbnail now, or '' when idle.
  status: string
  // A quick tweak the person typed; appended to the brief at generation.
  note: string
  // brief.md, the thumbnail prompt Claude wrote in chat; '' until it exists.
  brief: string
  // Extra images the person dropped into refs/.
  refs: string[]
  inspo: TrendInspo[]
  versions: TrendThumbVersion[]
}

declare module 'claude-code' {
  interface PluginState {
    'trend-radar': {
      report: TrendReport | null
      status: string
      tab: TrendTab
      config: TrendConfig | null
      channels: TrendChannel[]
      skipped: string[]
      checks: Record<string, string>
      openChannel: string
      notice: string
      health: TrendHealth
      presets: TrendPreset[]
      expanded: string[]
      runNote: string
      pillarFilter: string
      noteOpen: boolean
      dirs: TrendIdeaDir[]
      refs: TrendRef[]
      // Bumped when a cached picture arrives, so open tiles redraw.
      tick: number
      vidSort: 'multiple' | 'newest' | 'views'
      vidAll: boolean
      savedOpen: string[]
      // The saved folder whose Delete is waiting for a Yes.
      confirmTrash: string
      // Which Setup row shows its input right now ('' for none).
      editing: string
    }
  }
}
