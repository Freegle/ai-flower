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
 * - Setting maxTurns=1 (single-turn, no tool use)
 * - Returning the text from the final 'result' message
 */

import type { LLMAdapter } from '../schema/types.js'

export interface ClaudeCodeAdapterOptions {
  /** Maximum tokens for the response. Default: 4096 */
  maxTokens?: number
  /** Model to use. Defaults to the session's current model. */
  model?: string
}

export class ClaudeCodeAdapter implements LLMAdapter {
  #options: ClaudeCodeAdapterOptions

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

    const collectedText: string[] = []
    let finalResult: string | null = null

    const gen = query({
      prompt: user,
      options: {
        systemPrompt: system,
        maxTurns: 1,
        // Disable all tools — pure LLM call for JSON decision output
        allowedTools: [],
        // Use 'dontAsk' to skip interactive permission prompts in automated contexts
        // (e.g. monitor-fsm loops). 'default' mode hangs waiting for user interaction
        // that never comes, blocking the generator.
        permissionMode: 'dontAsk',
        // Forward caller-supplied options so `model` (and any future
        // pass-through config) actually reaches the SDK. Previously the
        // constructor stored `options` but nothing read from them, so a
        // caller's `new ClaudeCodeAdapter({ model: 'haiku' })` was silently
        // ignored and every call ran on the session default (Opus).
        ...(this.#options.model ? { model: this.#options.model } : {}),
      },
    })

    for await (const message of gen) {
      if (message.type === 'result') {
        // Final result — extract text
        if (typeof (message as any).result === 'string') {
          finalResult = (message as any).result
        } else if (Array.isArray((message as any).content)) {
          finalResult = (message as any).content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('')
        }
        break
      }
      if (message.type === 'assistant') {
        // Collect assistant message content as fallback
        if (Array.isArray((message as any).message?.content)) {
          for (const block of (message as any).message.content) {
            if (block.type === 'text') collectedText.push(block.text)
          }
        }
      }
    }

    const text = finalResult ?? collectedText.join('') ?? ''

    if (!text) {
      throw new Error('ClaudeCodeAdapter: empty response from query()')
    }

    return text
  }
}
