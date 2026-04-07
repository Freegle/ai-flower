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
import type { LLMAdapter } from '../schema/types.js';
export interface ClaudeCodeAdapterOptions {
    /** Maximum tokens for the response. Default: 4096 */
    maxTokens?: number;
    /** Model to use. Defaults to the session's current model. */
    model?: string;
}
export declare class ClaudeCodeAdapter implements LLMAdapter {
    #private;
    constructor(options?: ClaudeCodeAdapterOptions);
    call(system: string, user: string): Promise<string>;
}
//# sourceMappingURL=claude-code.d.ts.map