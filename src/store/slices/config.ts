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
    model: 'openai/gpt-4o-mini',
    authMode: 'oauth',
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
      const appConfig = { ...state.appConfig, activeProvider: provider };
      // Activating a provider implies enabling it.
      const providers = {
        ...state.providers,
        [provider]: { ...state.providers[provider], enabled: true },
      };
      storage.put(APP_KEY, appConfig);
      storage.put(STORAGE_KEY, providers);
      return { appConfig, providers };
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
    const storedProviders = storage.get<Record<ProviderKey, ProviderConfig>>(STORAGE_KEY);
    const storedApp      = storage.get<AppConfig>(APP_KEY);

    const appConfig = storedApp ? { ...DEFAULT_APP_CONFIG, ...storedApp } : get().appConfig;
    let providers   = storedProviders
      ? { ...DEFAULT_PROVIDERS, ...storedProviders }
      : get().providers;

    // Migration: if the stored active provider somehow has enabled:false, fix it.
    const active = appConfig.activeProvider;
    if (providers[active] && !providers[active].enabled) {
      providers = { ...providers, [active]: { ...providers[active], enabled: true } };
      storage.put(STORAGE_KEY, providers);
    }

    // Migration: early Phase 8 stored OpenRouter configs with an empty model,
    // which makes OpenRouter reject chat calls with HTTP 404.
    const generic = providers.generic;
    if (generic?.baseUrl === 'https://openrouter.ai/api/v1' && !generic.model.trim()) {
      providers = {
        ...providers,
        generic: { ...generic, model: DEFAULT_PROVIDERS.generic.model },
      };
      storage.put(STORAGE_KEY, providers);
    }

    set({ providers, appConfig });
  },
});
