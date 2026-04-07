import type { LLMAdapter } from '../schema/types.js';
export interface ClaudeAdapterConfig {
    apiKey: string;
    model?: string;
    maxTokens?: number;
}
/**
 * LLM adapter for Anthropic's Claude API.
 * Requires @anthropic-ai/sdk as a dependency in the consuming project.
 */
export declare class ClaudeAdapter implements LLMAdapter {
    private readonly config;
    private readonly model;
    private readonly maxTokens;
    private client;
    constructor(config: ClaudeAdapterConfig);
    private getClient;
    call(systemPrompt: string, userMessage: string): Promise<string>;
}
//# sourceMappingURL=claude.d.ts.map