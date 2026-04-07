/**
 * LLM adapter for Anthropic's Claude API.
 * Requires @anthropic-ai/sdk as a dependency in the consuming project.
 */
export class ClaudeAdapter {
    config;
    model;
    maxTokens;
    client = null;
    constructor(config) {
        this.config = config;
        this.model = config.model ?? 'claude-sonnet-4-6';
        this.maxTokens = config.maxTokens ?? 2048;
    }
    async getClient() {
        if (!this.client) {
            // Dynamic import so @anthropic-ai/sdk is only needed when this adapter is used
            const { default: Anthropic } = await import('@anthropic-ai/sdk');
            this.client = new Anthropic({ apiKey: this.config.apiKey });
        }
        return this.client;
    }
    async call(systemPrompt, userMessage) {
        const client = await this.getClient();
        const response = await client.messages.create({
            model: this.model,
            max_tokens: this.maxTokens,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
        });
        const textBlock = response.content.find(b => b.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
            throw new Error('Claude returned no text content');
        }
        return textBlock.text;
    }
}
//# sourceMappingURL=claude.js.map