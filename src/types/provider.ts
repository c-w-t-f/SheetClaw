import type { ProviderKey } from './usage';

export interface ModelInfo {
  id: string;
  name?: string;
  contextWindow?: number;
  supportsTools?: boolean;
}

export interface ProviderCapabilities {
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsOAuth: boolean;
  nativeUsage: boolean;
  toolFormat: 'openai' | 'anthropic';
}

export interface ProviderConfig {
  provider: ProviderKey;
  label?: string;
  enabled: boolean;
  baseUrl: string;
  model: string;
  knownModels?: ModelInfo[];
  authMode: 'apikey' | 'oauth' | 'none';
  authStateRef: string;
  headers?: Record<string, string>;
  contextLimits: {
    maxContextTokens: number;
    historyTokenCap: number;
    maxInlineSheetCells: number;
  };
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AuthState {
  provider: ProviderKey;
  state:
    | 'unauthenticated'
    | 'authenticating'
    | 'authenticated'
    | 'token-expired'
    | 'validating'
    | 'error';
  apiKeyMasked?: string;
  error?: string;
  /** Raw key — Phase 8 will move this to OS vault. Personal-use only. */
  _key?: string;
}
