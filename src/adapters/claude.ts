import type { LLMAdapter } from '../schema/types.js'

export interface ClaudeAdapterConfig {
  apiKey: string
  model?: string
  maxTokens?: number
}

/**
 * LLM adapter for Anthropic's Claude API.
 * Requires @anthropic-ai/sdk as a dependency in the consuming project.
 */
export class ClaudeAdapter implements LLMAdapter {
  private readonly model: string
  private readonly maxTokens: number
  private client: unknown = null

  constructor(private readonly config: ClaudeAdapterConfig) {
    this.model = config.model ?? 'claude-sonnet-4-6'
    this.maxTokens = config.maxTokens ?? 2048
  }

  private async getClient(): Promise<{ messages: { create: (opts: unknown) => Promise<{ content: Array<{ type: string; text: string }> }> } }> {
    if (!this.client) {
      // Dynamic import so @anthropic-ai/sdk is only needed when this adapter is used
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      this.client = new Anthropic({ apiKey: this.config.apiKey })
    }
    return this.client as ReturnType<ClaudeAdapter['getClient']> extends Promise<infer T> ? T : never
  }

  async call(systemPrompt: string, userMessage: string): Promise<string> {
    const client = await this.getClient()
    const response = await client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude returned no text content')
    }
    return textBlock.text
  }
}
