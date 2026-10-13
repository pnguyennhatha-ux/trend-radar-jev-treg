import { expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'trend-radar', props: { bodyColumns: 80 } as never } as const

// With no Trend Radar folder (no `folder` setting, no settings.json beside the session), the panel says so.
test('without its folder the panel asks for it, on desktop and terminal', async ($, on) => {
  mock.store(on)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'trend-radar', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /needs its folder/ })).toBeDefined()
    expect(await ui.find({ key: 'tab-ideas' })).toBeUndefined()
    await ui.unmount()
  }
})
