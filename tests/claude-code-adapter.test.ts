import { describe, it, expect, beforeEach, vi } from 'vitest'

// Capture call arguments so each test can inspect what the adapter passed
// through to the SDK. Populated inside the vi.mock factory below.
const queryCalls: Array<{ prompt: string; options: Record<string, unknown> }> = []

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { prompt: string; options: Record<string, unknown> }) => {
    queryCalls.push(args)
    // Return an async iterable with one 'result' message — matches the
    // subset of the real SDK's stream shape that ClaudeCodeAdapter reads.
    return (async function* () {
      yield { type: 'result' as const, result: 'ok' }
    })()
  },
}))

import { ClaudeCodeAdapter } from '../src/adapters/claude-code.js'

describe('ClaudeCodeAdapter', () => {
  beforeEach(() => {
    queryCalls.length = 0
    // Suppress the CLAUDECODE env warning in constructor output.
    process.env.CLAUDECODE = '1'
  })

  it('forwards the configured model to query() options', async () => {
    const adapter = new ClaudeCodeAdapter({ model: 'haiku' })
    const out = await adapter.call('sys', 'user msg')
    expect(out).toBe('ok')
    expect(queryCalls).toHaveLength(1)
    expect(queryCalls[0].options.model).toBe('haiku')
  })

  it('omits the model field when no model is configured', async () => {
    const adapter = new ClaudeCodeAdapter()
    await adapter.call('sys', 'user msg')
    expect(queryCalls).toHaveLength(1)
    // No model key at all — the SDK then falls back to the session default.
    expect('model' in queryCalls[0].options).toBe(false)
  })

  it('still sets the invariant options regardless of config', async () => {
    const adapter = new ClaudeCodeAdapter({ model: 'sonnet' })
    await adapter.call('my system prompt', 'user')
    const opts = queryCalls[0].options
    expect(opts.systemPrompt).toBe('my system prompt')
    expect(opts.maxTurns).toBe(1)
    expect(opts.allowedTools).toEqual([])
    expect(opts.permissionMode).toBe('default')
  })
})
