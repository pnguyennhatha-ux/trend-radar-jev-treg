import { expect, test } from 'claude-code/testing'

import { SETUP_DONE_OPENER, ageInDays, matchesTopic, median, outliers, scoreChannel, setupResume, trimX } from '../hooks/lib'

test('ages parse from YouTube strings', async () => {
  expect(ageInDays('3 days ago')).toBe(3)
  expect(ageInDays('2 weeks ago')).toBe(14)
  expect(ageInDays('20 hours ago')).toBe(0)
  expect(ageInDays('???')).toBe(999)
})

test('median of odd and even lists', async () => {
  expect(median([5, 1, 3])).toBe(3)
  expect(median([1, 2, 3, 4])).toBe(2.5)
  expect(median([])).toBe(0)
})

test('outliers: proven needs 2.5x and 3+ days, ads (>100x) are dropped', async () => {
  const rows = [
    { title: 'normal a', views: 1000, published: '10 days ago', url: 'a' },
    { title: 'normal b', views: 1000, published: '12 days ago', url: 'b' },
    { title: 'normal c', views: 1000, published: '14 days ago', url: 'c' },
    { title: 'normal d', views: 1000, published: '15 days ago', url: 'g' },
    { title: 'normal e', views: 1000, published: '16 days ago', url: 'h' },
    { title: 'big hit', views: 5000, published: '5 days ago', url: 'd' },
    { title: 'too new', views: 4000, published: '1 day ago', url: 'e' },
    { title: 'paid ads', views: 500000, published: '20 days ago', url: 'f' },
  ]
  const { videos } = scoreChannel('@x', rows)
  const { proven, rising } = outliers(videos)
  expect(proven.map(v => v.title)).toEqual(['big hit'])
  expect(rising.map(v => v.title)).toEqual(['too new'])
})

test('topic matching needs every word', async () => {
  expect(matchesTopic('Claude Code Mods Are Game Changers', 'claude mods')).toBe(true)
  expect(matchesTopic('Claude Code Skills', 'claude mods')).toBe(false)
})

test('X posts are trimmed, replies dropped, sorted by likes', async () => {
  const now = 1_800_000_000
  const posts = trimX([
    { text: 'a', likeCount: 5, authorUsername: 'u1', createdUtc: now - 86400 },
    { text: 'b', likeCount: 50, authorUsername: 'u2', createdUtc: now },
    { text: 'reply', likeCount: 999, isReply: true },
  ], now)
  expect(posts.map(p => p.author)).toEqual(['u2', 'u1'])
  expect(posts[1]!.ageDays).toBe(1)
})

import { normalizeHandle, parseIdeas } from '../hooks/lib'

test('parseIdeas reads the JSON, clamps scores and maps pillars', async () => {
  const text = 'Sure! {"ideas":[{"title":"A","pillar":2,"score":14,"whyNow":"w","angle":"a","sponsor":"s","topic":"t","proof":[{"label":"x","url":"https://y.com"},{"label":"bad","url":"ftp://z"}]}],"freshOnX":[],"skip":["no"]}'
  const out = parseIdeas(text, ['P1', 'P2'])!
  expect(out.ideas[0]!.pillar).toBe('P2')
  expect(out.ideas[0]!.score).toBe(10)
  expect(out.ideas[0]!.proof).toHaveLength(1)
  expect(out.skip).toEqual(['no'])
  expect(parseIdeas('no json here', ['P1'])).toBeNull()
})

test('handles normalize from links and bare names', async () => {
  expect(normalizeHandle('https://www.youtube.com/@nateherk/videos')).toBe('@nateherk')
  expect(normalizeHandle('nateherk')).toBe('@nateherk')
  expect(normalizeHandle('  ')).toBe('')
})

import { briefPrompt, brandBrief, EMPTY_CONFIG, parseArgs } from '../hooks/lib'

test('command words: counts, days, notes, check, setup', async () => {
  expect(parseArgs('')).toEqual({ kind: 'brief', ideas: undefined, days: undefined, note: '' })
  expect(parseArgs('5 ideas')).toEqual({ kind: 'brief', ideas: 5, days: undefined, note: '' })
  expect(parseArgs('8 ideas 21 days · focus on Shorts')).toEqual({ kind: 'brief', ideas: 8, days: 21, note: 'focus on Shorts' })
  expect(parseArgs('3 weeks')).toMatchObject({ kind: 'brief', days: 21 })
  expect(parseArgs('99 ideas 500 days')).toMatchObject({ ideas: 10, days: 90 })
  expect(parseArgs('this week')).toEqual({ kind: 'brief', ideas: undefined, days: undefined, note: 'this week' })
  expect(parseArgs('check claude mods')).toEqual({ kind: 'check', topic: 'claude mods' })
  expect(parseArgs('setup')).toEqual({ kind: 'setup' })
  expect(parseArgs('add @x')).toEqual({ kind: 'add', handle: '@x' })
})

test('notes reach Claude: standing ones in the brief, one-off in the prompt', async () => {
  expect(brandBrief({ ...EMPTY_CONFIG, notes: ['avoid crypto'] })).toContain('avoid crypto')
  expect(briefPrompt({}, 3, 7, 'focus on Shorts')).toContain('NOTE FOR THIS RUN (weigh it heavily): focus on Shorts')
  expect(briefPrompt({}, 3, 7, '')).toContain('Pick the 7 best')
})

test('setup resumes at the first unfinished step', async () => {
  const empty = setupResume(EMPTY_CONFIG)
  expect(empty.next).toBe('channel')
  expect(empty.filled).toEqual([])
  expect(empty.said).toBe("treg is connected. What's your YouTube channel? (@handle or link)")

  const partly = setupResume({ ...EMPTY_CONFIG, channel: '@me', audience: 'builders' })
  expect(partly.next).toBe('pillars')
  expect(partly.said).toBe('treg is connected. You have your channel and your audience. Next: What are your 2 to 4 pillars, the topics you keep coming back to? (Ask me if you want ideas.)')

  const full = setupResume({ ...EMPTY_CONFIG, channel: '@me', audience: 'builders', pillars: ['A: a', 'B: b'], competitors: ['@a', '@b', '@c', '@d', '@e'], xKeywords: ['x'], sponsorTypes: ['s'] })
  expect(full.next).toBe(null)
  expect(full.missing).toEqual([])
  expect(full.said).toBe(`treg is connected. ${SETUP_DONE_OPENER}`)
})
