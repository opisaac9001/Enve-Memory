import type { EnveMemory } from '@enve-memory/core';
import { AnthropicProvider } from './anthropic.ts';
import { GeminiProvider, OllamaProvider, OpenAiCompatibleProvider } from './http-providers.ts';
import { type AiProvider, AiError, PROVIDERS, PROVIDER_IDS, type ProviderId } from './provider.ts';

export interface ProviderConfig {
  provider: ProviderId;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

/** Reads a provider's key; the CLI uses environment variables, the desktop app the OS credential store. */
export type KeyLookup = (provider: ProviderId) => string | undefined;

export const envKeys: KeyLookup = (provider) => {
  if (provider === 'none') return undefined;
  const name = PROVIDERS[provider].keyEnv;
  return name ? process.env[name] : undefined;
};

export function createProvider({ provider, model, baseUrl, apiKey }: ProviderConfig): AiProvider {
  if (provider === 'none') throw new AiError('No AI provider is configured.');
  const info = PROVIDERS[provider];
  const url = baseUrl || info.baseUrl;
  const chosen = model || info.defaultModel;
  if (!chosen) throw new AiError(`Choose a model for ${info.label}.`);
  if (info.needsKey && !apiKey) {
    throw new AiError(`${info.label} needs an API key${info.keyEnv ? ` (set ${info.keyEnv})` : ''}.`);
  }
  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider(chosen, apiKey!, baseUrl || undefined);
    case 'gemini':
      return new GeminiProvider(chosen, url, apiKey!);
    case 'ollama':
      return new OllamaProvider(chosen, url);
    case 'openai':
    case 'openrouter':
    case 'openai-compatible':
      return new OpenAiCompatibleProvider(provider, chosen, url, apiKey);
  }
}

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/** The library's configured provider, or null when AI is off. */
export function providerFor(memory: EnveMemory, keys: KeyLookup = envKeys): AiProvider | null {
  const id = memory.settings.get('aiProvider');
  if (!isProviderId(id) || id === 'none') return null;
  return createProvider({
    provider: id,
    model: memory.settings.get('aiModel'),
    baseUrl: memory.settings.get('aiBaseUrl'),
    apiKey: keys(id),
  });
}
