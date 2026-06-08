import type { StateCreator } from 'zustand';
import type { ProviderConfig, ProviderKey } from '../../types';
import { storage } from '../storage';

const STORAGE_KEY = 'xl.config.providers';
const APP_KEY = 'xl.config.app';

export interface AppConfig {
  activeProvider: ProviderKey;
  autoApproveSession: boolean;
  pricingMode: 'bundled' | 'custom';
}

const DEFAULT_APP_CONFIG: AppConfig = {
  activeProvider: 'ollama',
  autoApproveSession: false,
  pricingMode: 'bundled',
};

const DEFAULT_PROVIDERS: Record<ProviderKey, ProviderConfig> = {
  ollama: {
    provider: 'ollama',
    label: 'Ollama (local)',
    enabled: true,
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2',
    authMode: 'none',
    authStateRef: 'xl.auth.ollama',
    contextLimits: { maxContextTokens: 128000, historyTokenCap: 100000, maxInlineSheetCells: 5000 },
  },
  openai: {
    provider: 'openai',
    label: 'OpenAI',
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    authMode: 'apikey',
    authStateRef: 'xl.auth.openai',
    contextLimits: { maxContextTokens: 128000, historyTokenCap: 100000, maxInlineSheetCells: 5000 },
  },
  anthropic: {
    provider: 'anthropic',
    label: 'Anthropic',
    enabled: false,
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
    authMode: 'apikey',
    authStateRef: 'xl.auth.anthropic',
    contextLimits: { maxContextTokens: 200000, historyTokenCap: 160000, maxInlineSheetCells: 8000 },
  },
  generic: {
    provider: 'generic',
    label: 'Generic / OpenRouter',
    enabled: false,
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
    authMode: 'apikey',
    authStateRef: 'xl.auth.generic',
    contextLimits: { maxContextTokens: 128000, historyTokenCap: 100000, maxInlineSheetCells: 5000 },
  },
};

export interface ConfigSlice {
  providers: Record<ProviderKey, ProviderConfig>;
  appConfig: AppConfig;
  setProvider(provider: ProviderKey, config: Partial<ProviderConfig>): void;
  setActiveProvider(provider: ProviderKey): void;
  setAppConfig(config: Partial<AppConfig>): void;
  loadConfigFromStorage(): void;
}

export const createConfigSlice: StateCreator<ConfigSlice> = (set, get) => ({
  providers: DEFAULT_PROVIDERS,
  appConfig: DEFAULT_APP_CONFIG,

  setProvider(provider, config) {
    set(state => {
      const updated = {
        ...state.providers,
        [provider]: { ...state.providers[provider], ...config },
      };
      storage.put(STORAGE_KEY, updated);
      return { providers: updated };
    });
  },

  setActiveProvider(provider) {
    set(state => {
      const updated = { ...state.appConfig, activeProvider: provider };
      storage.put(APP_KEY, updated);
      return { appConfig: updated };
    });
  },

  setAppConfig(config) {
    set(state => {
      const updated = { ...state.appConfig, ...config };
      storage.put(APP_KEY, updated);
      return { appConfig: updated };
    });
  },

  loadConfigFromStorage() {
    const providers = storage.get<Record<ProviderKey, ProviderConfig>>(STORAGE_KEY);
    const appConfig = storage.get<AppConfig>(APP_KEY);
    set({
      providers: providers ? { ...DEFAULT_PROVIDERS, ...providers } : get().providers,
      appConfig: appConfig ? { ...DEFAULT_APP_CONFIG, ...appConfig } : get().appConfig,
    });
  },
});
