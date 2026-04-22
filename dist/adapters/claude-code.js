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
export class ClaudeCodeAdapter {
    #options;
    constructor(options = {}) {
        this.#options = options;
        if (!process.env.CLAUDECODE) {
            console.warn('[ClaudeCodeAdapter] Warning: CLAUDECODE env var not set. ' +
                'This adapter requires running from within a Claude Code session. ' +
                'For standalone use, use ClaudeAdapter with ANTHROPIC_API_KEY instead.');
        }
    }
    async call(system, user) {
        // Dynamic import — only load when actually called, avoids hard dep.
        // @ts-ignore — optional peer dependency, not in devDependencies
        const { query } = await import('@anthropic-ai/claude-agent-sdk');
        const collectedText = [];
        let finalResult = null;
        const gen = query({
            prompt: user,
            options: {
                systemPrompt: system,
                maxTurns: 1,
                // Disable all tools — pure LLM call for JSON decision output
                allowedTools: [],
                permissionMode: 'default',
                // Forward caller-supplied options so `model` (and any future
                // pass-through config) actually reaches the SDK. Previously the
                // constructor stored `options` but nothing read from them, so a
                // caller's `new ClaudeCodeAdapter({ model: 'haiku' })` was silently
                // ignored and every call ran on the session default (Opus).
                ...(this.#options.model ? { model: this.#options.model } : {}),
            },
        });
        for await (const message of gen) {
            if (message.type === 'result') {
                // Final result — extract text
                if (typeof message.result === 'string') {
                    finalResult = message.result;
                }
                else if (Array.isArray(message.content)) {
                    finalResult = message.content
                        .filter((c) => c.type === 'text')
                        .map((c) => c.text)
                        .join('');
                }
                break;
            }
            if (message.type === 'assistant') {
                // Collect assistant message content as fallback
                if (Array.isArray(message.message?.content)) {
                    for (const block of message.message.content) {
                        if (block.type === 'text')
                            collectedText.push(block.text);
                    }
                }
            }
        }
        const text = finalResult ?? collectedText.join('') ?? '';
        if (!text) {
            throw new Error('ClaudeCodeAdapter: empty response from query()');
        }
        return text;
    }
}
//# sourceMappingURL=claude-code.js.map