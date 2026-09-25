export interface CompletionRequest {
  system: string;
  prompt: string;
  /** JSON Schema the reply must satisfy; the reply is then a JSON string. */
  schema?: Record<string, unknown>;
  maxTokens?: number;
}

/** One chat model behind one interface, whoever runs it. */
export interface AiProvider {
  readonly id: ProviderId;
  readonly model: string;
  complete(request: CompletionRequest): Promise<string>;
  listModels(): Promise<string[]>;
}

export class AiError extends Error {}

export const PROVIDER_IDS = ['none', 'ollama', 'openai', 'anthropic', 'gemini', 'openrouter', 'openai-compatible'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderInfo {
  label: string;
  baseUrl: string;
  /** Environment variable the CLI reads the key from; the desktop app keeps keys in the OS credential store. */
  keyEnv?: string;
  needsKey: boolean;
  defaultModel?: string;
}

export const PROVIDERS: Record<Exclude<ProviderId, 'none'>, ProviderInfo> = {
  ollama: { label: 'Ollama (on this computer)', baseUrl: 'http://127.0.0.1:11434', needsKey: false },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', needsKey: true },
  anthropic: { label: 'Anthropic', baseUrl: 'https://api.anthropic.com', keyEnv: 'ANTHROPIC_API_KEY', needsKey: true, defaultModel: 'claude-opus-5' },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyEnv: 'GEMINI_API_KEY', needsKey: true },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', needsKey: true },
  'openai-compatible': { label: 'OpenAI-compatible server', baseUrl: 'http://127.0.0.1:8000/v1', keyEnv: 'OPENAI_COMPATIBLE_API_KEY', needsKey: false },
};

/** Model replies sometimes wrap JSON in prose or code fences, especially without native schema support. */
export function parseJsonReply<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new AiError('The model did not return JSON.');
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    throw new AiError('The model returned malformed JSON.');
  }
}

export async function httpJson<T>(url: string, init: RequestInit & { timeoutMs?: number }, label: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 120_000) });
  } catch (error) {
    throw new AiError(`Couldn't reach ${label}: ${(error as Error).message}.`);
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try {
      const body = JSON.parse(text) as { error?: { message?: string } | string };
      detail = typeof body.error === 'string' ? body.error : body.error?.message ?? detail;
    } catch {}
    throw new AiError(`${label} answered ${response.status}: ${detail}`);
  }
  return JSON.parse(text) as T;
}
