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
import type { LLMAdapter, LLMUsage } from '../schema/types.js';
export interface ClaudeCodeAdapterOptions {
    /** Maximum tokens for the response. Default: 4096 */
    maxTokens?: number;
    /** Model to use. Defaults to the session's current model. */
    model?: string;
    /**
     * Explicit path to the claude executable. If omitted the adapter runs
     * `which claude` to find the globally-installed binary, which avoids the
     * SDK's platform-package auto-detection picking the musl variant on
     * glibc WSL2 systems.
     */
    pathToClaudeCodeExecutable?: string;
    /**
     * Optional callback fired after every call() with the token counts from
     * that call. Receives zeroes when the SDK result message carries no usage
     * data (e.g. in tests with a stubbed SDK). Never throws — the adapter
     * swallows any exception thrown by this callback.
     */
    onUsage?: (usage: LLMUsage) => void;
}
export declare class ClaudeCodeAdapter implements LLMAdapter {
    #private;
    /**
     * Token counts from the most recent call(). Populated after every
     * successful call(); zero-valued before the first call or when the SDK
     * result message carries no usage block.
     */
    lastUsage: LLMUsage;
    constructor(options?: ClaudeCodeAdapterOptions);
    call(system: string, user: string): Promise<string>;
}
//# sourceMappingURL=claude-code.d.ts.map