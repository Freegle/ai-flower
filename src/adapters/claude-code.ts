/**
 * Claude Code Adapter — uses @anthropic-ai/claude-agent-sdk query() which
 * authenticates via the running Claude Code session (subscription auth).
 *
 * This means no ANTHROPIC_API_KEY is needed when running from within a
 * Claude Code instance (CLAUDECODE=1 is set automatically).
 *
 * Usage:
 *   import { ClaudeCodeAdapter } from 'ai-flower/adapters/claude-code'
 *   const engine = new WorkflowEngine({ ..., llmAdapter: new ClaudeCodeAdapter() })
 *
 * The adapter uses query() as a pure text-in / text-out call by:
 * - Passing the FSM system prompt via options.systemPrompt
 * - Returning the text from the final 'result' message
 *
 * After each successful call(), the `lastUsage` property is populated with
 * token counts from the SDK result message. An optional `onUsage` callback
 * receives the same data so callers can record per-call usage without polling.
 */

import type { LLMAdapter, LLMUsage } from '../schema/types.js'

export interface ClaudeCodeAdapterOptions {
  /** Maximum tokens for the response. Default: 4096 */
  maxTokens?: number
  /** Model to use. Defaults to the session's current model. */
  model?: string
  /**
   * Explicit path to the claude executable. If omitted the adapter runs
   * `which claude` to find the globally-installed binary, which avoids the
   * SDK's platform-package auto-detection picking the musl variant on
   * glibc WSL2 systems.
   */
  pathToClaudeCodeExecutable?: string
  /**
   * Optional callback fired after every call() with the token counts from
   * that call. Receives zeroes when the SDK result message carries no usage
   * data (e.g. in tests with a stubbed SDK). Never throws — the adapter
   * swallows any exception thrown by this callback.
   */
  onUsage?: (usage: LLMUsage) => void
}

export class ClaudeCodeAdapter implements LLMAdapter {
  #options: ClaudeCodeAdapterOptions

  /**
   * Token counts from the most recent call(). Populated after every
   * successful call(); zero-valued before the first call or when the SDK
   * result message carries no usage block.
   */
  lastUsage: LLMUsage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.#options = options

    if (!process.env.CLAUDECODE) {
      console.warn(
        '[ClaudeCodeAdapter] Warning: CLAUDECODE env var not set. ' +
        'This adapter requires running from within a Claude Code session. ' +
        'For standalone use, use ClaudeAdapter with ANTHROPIC_API_KEY instead.'
      )
    }
  }

  async call(system: string, user: string): Promise<string> {
    // Dynamic import — only load when actually called, avoids hard dep.
    // @ts-ignore — optional peer dependency, not in devDependencies
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const { execFileSync } = await import('node:child_process')

    // Resolve the claude executable. Prefer the caller-supplied path, then
    // fall back to `which claude` (the globally-installed binary). Without an
    // explicit path the SDK tries to auto-detect from its platform-specific
    // npm packages; on glibc WSL2 it can pick the musl variant, which cannot
    // execute and throws "native binary not found".
    let claudeExe: string | undefined = this.#options.pathToClaudeCodeExecutable
    if (!claudeExe) {
      try {
        const found = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim()
        if (found) claudeExe = found
      } catch { /* fall through — let SDK auto-detect */ }
    }

    const collectedText: string[] = []
    let finalResult: string | null = null
    const seenTypes: string[] = []
    let rawUsage: any = null

    const gen = query({
      prompt: user,
      options: {
        systemPrompt: system,
        // No maxTurns cap — Claude Code consumes turns on startup (memory
        // reads, hooks) before the model even responds, so any fixed cap
        // risks error_max_turns. With allowedTools:[] there is no loop risk.
        allowedTools: [],
        // Use 'dontAsk' to skip interactive permission prompts in automated contexts
        // (e.g. monitor-fsm loops). 'default' mode hangs waiting for user interaction
        // that never comes, blocking the generator.
        permissionMode: 'dontAsk',
        // Explicit executable path avoids musl/glibc mismatch on WSL2.
        ...(claudeExe ? { pathToClaudeCodeExecutable: claudeExe } : {}),
        // Forward caller-supplied options so `model` (and any future
        // pass-through config) actually reaches the SDK. Previously the
        // constructor stored `options` but nothing read from them, so a
        // caller's `new ClaudeCodeAdapter({ model: 'haiku' })` was silently
        // ignored and every call ran on the session default (Opus).
        ...(this.#options.model ? { model: this.#options.model } : {}),
      },
    })

    for await (const message of gen) {
      const msg = message as any
      seenTypes.push(msg.type ?? 'unknown')
      if (msg.type === 'result') {
        // SDK error subtypes — surface the reason rather than "empty response"
        if (msg.subtype && msg.subtype !== 'success') {
          throw new Error(`ClaudeCodeAdapter: query() ended with subtype=${msg.subtype}`)
        }
        // Capture the usage block (present on both success and error result messages).
        // The SDK uses camelCase: { inputTokens, outputTokens, cacheReadInputTokens,
        // cacheCreationInputTokens }. We also accept snake_case for forward compat.
        if (msg.usage && typeof msg.usage === 'object') {
          rawUsage = msg.usage
        }
        if (typeof msg.result === 'string') {
          finalResult = msg.result
        } else if (Array.isArray(msg.content)) {
          finalResult = msg.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('')
        }
        break
      }
      if (msg.type === 'assistant') {
        if (Array.isArray(msg.message?.content)) {
          for (const block of msg.message.content) {
            if (block.type === 'text') collectedText.push(block.text)
          }
        }
      }
    }

    const text = finalResult ?? collectedText.join('') ?? ''

    if (!text) {
      throw new Error(`ClaudeCodeAdapter: empty response from query() (saw message types: ${seenTypes.join(', ') || 'none'})`)
    }

    // Parse token usage from the result message. The SDK camelCases the fields
    // (inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens);
    // we also accept the snake_case variants for resilience.
    const usage: LLMUsage = {
      input:       this.#pickNumber(rawUsage, ['inputTokens',       'input_tokens']),
      output:      this.#pickNumber(rawUsage, ['outputTokens',      'output_tokens']),
      cacheRead:   this.#pickNumber(rawUsage, ['cacheReadInputTokens',   'cache_read_input_tokens']),
      cacheCreate: this.#pickNumber(rawUsage, ['cacheCreationInputTokens', 'cache_creation_input_tokens']),
    }
    this.lastUsage = usage

    if (this.#options.onUsage) {
      try { this.#options.onUsage(usage) } catch { /* swallow — never let usage reporting break the call */ }
    }

    return text
  }

  /** Pick the first numeric value from an object by trying a list of key names. */
  #pickNumber(obj: any, keys: string[]): number {
    if (!obj || typeof obj !== 'object') return 0
    for (const k of keys) {
      const v = obj[k]
      if (typeof v === 'number' && Number.isFinite(v)) return v
    }
    return 0
  }
}
