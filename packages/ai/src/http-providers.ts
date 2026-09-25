import { type AiProvider, type CompletionRequest, type ProviderId, httpJson } from './provider.ts';

/** OpenAI, OpenRouter, LM Studio, vLLM, llama.cpp and anything else speaking the Chat Completions API. */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly id: ProviderId;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(id: ProviderId, model: string, baseUrl: string, apiKey?: string) {
    this.id = id;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) };
  }

  async complete({ system, prompt, schema, maxTokens = 4096 }: CompletionRequest): Promise<string> {
    const body = {
      model: this.model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      ...(schema ? { response_format: { type: 'json_schema', json_schema: { name: 'result', schema, strict: true } } } : {}),
    };
    const response = await httpJson<{ choices: { message: { content: string | null; reasoning_content?: string } }[] }>(
      `${this.baseUrl}/chat/completions`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), timeoutMs: 300_000 }, this.id,
    );
    const message = response.choices[0]?.message;
    const content = stripThinking(message?.content ?? '');
    // LM Studio returns schema-constrained output from reasoning models in reasoning_content, leaving content empty.
    return content || (schema ? message?.reasoning_content ?? '' : '');
  }

  async listModels(): Promise<string[]> {
    const response = await httpJson<{ data: { id: string }[] }>(`${this.baseUrl}/models`, { headers: this.headers(), timeoutMs: 15_000 }, this.id);
    return response.data.map((m) => m.id).sort();
  }
}

/** Reasoning models served over plain chat APIs may inline their thinking. */
export const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

export class OllamaProvider implements AiProvider {
  readonly id = 'ollama' as const;
  readonly model: string;
  private readonly baseUrl: string;

  constructor(model: string, baseUrl: string) {
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async complete({ system, prompt, schema, maxTokens = 4096 }: CompletionRequest): Promise<string> {
    // Ollama silently drops the start of prompts longer than its context (often 4096), which loses the system prompt,
    // and without num_predict a small model can generate until the timeout. Size both to the request.
    const estimate = Math.ceil((system.length + prompt.length) / 3) + maxTokens;
    const numCtx = Math.min(32_768, Math.max(4096, Math.ceil(estimate / 1024) * 1024));
    const response = await httpJson<{ message: { content: string } }>(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        options: { num_ctx: numCtx, num_predict: maxTokens },
        ...(schema ? { format: schema } : {}),
      }),
      timeoutMs: 300_000,
    }, 'Ollama');
    return stripThinking(response.message.content);
  }

  async listModels(): Promise<string[]> {
    const response = await httpJson<{ models: { name: string }[] }>(`${this.baseUrl}/api/tags`, { timeoutMs: 5_000 }, 'Ollama');
    return response.models.map((m) => m.name).sort();
  }
}

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(model: string, baseUrl: string, apiKey: string) {
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  async complete({ system, prompt, schema, maxTokens = 4096 }: CompletionRequest): Promise<string> {
    const response = await httpJson<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(
      `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, ...(schema ? { responseMimeType: 'application/json', responseJsonSchema: schema } : {}) },
        }),
      },
      'Gemini',
    );
    return response.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  }

  async listModels(): Promise<string[]> {
    const response = await httpJson<{ models: { name: string; supportedGenerationMethods?: string[] }[] }>(
      `${this.baseUrl}/models`, { headers: { 'x-goog-api-key': this.apiKey }, timeoutMs: 15_000 }, 'Gemini',
    );
    return response.models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent') ?? true)
      .map((m) => m.name.replace(/^models\//, ''))
      .sort();
  }
}
