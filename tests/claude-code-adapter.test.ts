import { describe, it, expect, beforeEach, vi } from 'vitest'

// Capture call arguments so each test can inspect what the adapter passed
// through to the SDK. Populated inside the vi.mock factory below.
const queryCalls: Array<{ prompt: string; options: Record<string, unknown> }> = []

// Configurable fake usage block returned by the mock — tests can override this.
let fakeUsage: Record<string, number> | null = null

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { prompt: string; options: Record<string, unknown> }) => {
    queryCalls.push(args)
    // Return an async iterable with one 'result' message — matches the
    // subset of the real SDK's stream shape that ClaudeCodeAdapter reads.
    return (async function* () {
      const msg: any = { type: 'result' as const, subtype: 'success', result: 'ok' }
      if (fakeUsage !== null) msg.usage = fakeUsage
      yield msg
    })()
  },
}))

import { ClaudeCodeAdapter } from '../src/adapters/claude-code.js'

describe('ClaudeCodeAdapter', () => {
  beforeEach(() => {
    queryCalls.length = 0
    fakeUsage = null
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
    // No maxTurns cap (removed in ea5d512) — absence is the correct behaviour.
    expect(opts.maxTurns).toBeUndefined()
    expect(opts.allowedTools).toEqual([])
    // Uses dontAsk for automated contexts (changed in cf2ac39).
    expect(opts.permissionMode).toBe('dontAsk')
  })

  // ─── Usage surfacing ────────────────────────────────────────────────────────

  it('populates lastUsage from camelCase SDK result fields', async () => {
    fakeUsage = {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 30,
      cacheCreationInputTokens: 10,
    }
    const adapter = new ClaudeCodeAdapter()
    await adapter.call('sys', 'msg')
    expect(adapter.lastUsage).toEqual({ input: 100, output: 50, cacheRead: 30, cacheCreate: 10 })
  })

  it('accepts snake_case SDK result fields as a fallback', async () => {
    fakeUsage = {
      input_tokens: 200,
      output_tokens: 80,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 20,
    }
    const adapter = new ClaudeCodeAdapter()
    await adapter.call('sys', 'msg')
    expect(adapter.lastUsage).toEqual({ input: 200, output: 80, cacheRead: 0, cacheCreate: 20 })
  })

  it('returns zero lastUsage when the result message has no usage block', async () => {
    // fakeUsage is null — mock yields no usage field.
    const adapter = new ClaudeCodeAdapter()
    await adapter.call('sys', 'msg')
    expect(adapter.lastUsage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 })
  })

  it('lastUsage is zero-valued before the first call', () => {
    const adapter = new ClaudeCodeAdapter()
    expect(adapter.lastUsage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 })
  })

  it('fires onUsage callback with parsed token counts', async () => {
    fakeUsage = { inputTokens: 7, outputTokens: 3, cacheReadInputTokens: 1, cacheCreationInputTokens: 2 }
    const received: any[] = []
    const adapter = new ClaudeCodeAdapter({ onUsage: (u) => received.push(u) })
    await adapter.call('sys', 'msg')
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ input: 7, output: 3, cacheRead: 1, cacheCreate: 2 })
  })

  it('fires onUsage with zeroes when no usage block is present', async () => {
    // fakeUsage is null
    const received: any[] = []
    const adapter = new ClaudeCodeAdapter({ onUsage: (u) => received.push(u) })
    await adapter.call('sys', 'msg')
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 })
  })

  it('swallows exceptions thrown by the onUsage callback', async () => {
    fakeUsage = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }
    const adapter = new ClaudeCodeAdapter({
      onUsage: () => { throw new Error('callback exploded') },
    })
    // Must not throw; the text result should still be returned.
    await expect(adapter.call('sys', 'msg')).resolves.toBe('ok')
  })

  it('old call signature (system, user) still returns text unaffected', async () => {
    const adapter = new ClaudeCodeAdapter()
    const result = await adapter.call('system prompt', 'user message')
    expect(result).toBe('ok')
    expect(queryCalls[0].prompt).toBe('user message')
    expect(queryCalls[0].options.systemPrompt).toBe('system prompt')
  })
})
