export { OpenAIAdapter } from './openai';
export type { OpenAIAdapterConfig } from './openai';
export { AnthropicAdapter } from './anthropic';
export type { AnthropicAdapterConfig } from './anthropic';
export { OllamaAdapter } from './ollama';
export type { OllamaAdapterConfig } from './ollama';
export { parseLenientToolCall } from './ollama';

import type { LLMClient } from '../types';
import type { ProviderConfig } from '../types';
import { OpenAIAdapter } from './openai';
import { AnthropicAdapter } from './anthropic';
import { OllamaAdapter } from './ollama';

export function createAdapter(cfg: ProviderConfig, apiKey: string): LLMClient {
  switch (cfg.provider) {
    case 'anthropic':
      return new AnthropicAdapter({ apiKey, baseUrl: cfg.baseUrl });
    case 'ollama':
      return new OllamaAdapter({ baseUrl: cfg.baseUrl });
    case 'openai':
    case 'generic':
      return new OpenAIAdapter({ apiKey, baseUrl: cfg.baseUrl, extraHeaders: cfg.headers });
  }
}
