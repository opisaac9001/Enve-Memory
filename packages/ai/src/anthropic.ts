import Anthropic from '@anthropic-ai/sdk';
import { type AiProvider, AiError, type CompletionRequest } from './provider.ts';

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic' as const;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(model: string, apiKey: string, baseURL?: string) {
    this.model = model;
    this.client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }

  async complete({ system, prompt, schema, maxTokens = 4096 }: CompletionRequest): Promise<string> {
    try {
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
        // Short, well-specified jobs (summaries, tags, cited answers): low effort keeps them fast and cheap.
        output_config: { effort: 'low', ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
        // A classifier decline is retried server-side on the model Anthropic recommends for that category.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
      if (response.stop_reason === 'refusal') throw new AiError('The model declined this request.');
      const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
      if (!text) throw new AiError('The model returned no text.');
      return text;
    } catch (error) {
      if (error instanceof AiError) throw error;
      if (error instanceof Anthropic.AuthenticationError) throw new AiError('Anthropic rejected the API key.');
      if (error instanceof Anthropic.RateLimitError) throw new AiError('Anthropic rate limit reached; try again shortly.');
      if (error instanceof Anthropic.APIError) throw new AiError(`Anthropic error ${error.status}: ${error.message}`);
      throw new AiError(`Couldn't reach Anthropic: ${(error as Error).message}`);
    }
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const model of this.client.models.list()) ids.push(model.id);
    return ids;
  }
}
