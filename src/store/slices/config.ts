import type { StateCreator } from 'zustand';
import type { ProviderConfig, ProviderKey, WebAccessConfig } from '../../types';
import { storage } from '../storage';

const STORAGE_KEY = 'xl.config.providers';
const APP_KEY = 'xl.config.app';

export interface AppConfig {
  activeProvider: ProviderKey;
  autoApproveSession: boolean;
  pricingMode: 'bundled' | 'custom';
  webAccess: WebAccessConfig;
}

const DEFAULT_APP_CONFIG: AppConfig = {
  activeProvider: 'ollama',
  autoApproveSession: false,
  pricingMode: 'bundled',
  webAccess: { provider: 'none', readerFallback: false },
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
  deepseek: {
    provider: 'deepseek',
    label: 'DeepSeek',
    enabled: false,
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    authMode: 'apikey',
    authStateRef: 'xl.auth.deepseek',
    contextLimits: { maxContextTokens: 128000, historyTokenCap: 100000, maxInlineSheetCells: 5000 },
  },
  groq: {
    provider: 'groq',
    label: 'Groq',
    enabled: false,
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    authMode: 'apikey',
    authStateRef: 'xl.auth.groq',
    contextLimits: { maxContextTokens: 128000, historyTokenCap: 100000, maxInlineSheetCells: 5000 },
  },
  mistral: {
    provider: 'mistral',
    label: 'Mistral',
    enabled: false,
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    authMode: 'apikey',
    authStateRef: 'xl.auth.mistral',
    contextLimits: { maxContextTokens: 128000, historyTokenCap: 100000, maxInlineSheetCells: 5000 },
  },
  together: {
    provider: 'together',
    label: 'Together AI',
    enabled: false,
    baseUrl: 'https://api.together.ai/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    authMode: 'apikey',
    authStateRef: 'xl.auth.together',
    contextLimits: { maxContextTokens: 128000, historyTokenCap: 100000, maxInlineSheetCells: 5000 },
  },
  kimi: {
    provider: 'kimi',
    label: 'Kimi',
    enabled: false,
    baseUrl: 'https://api.moonshot.ai/v1',
    model: 'kimi-k2.6',
    authMode: 'apikey',
    authStateRef: 'xl.auth.kimi',
    contextLimits: { maxContextTokens: 256000, historyTokenCap: 200000, maxInlineSheetCells: 8000 },
  },
  glm: {
    provider: 'glm',
    label: 'GLM',
    enabled: false,
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: 'glm-4.7',
    authMode: 'apikey',
    authStateRef: 'xl.auth.glm',
    contextLimits: { maxContextTokens: 128000, historyTokenCap: 100000, maxInlineSheetCells: 5000 },
  },
  qwen: {
    provider: 'qwen',
    label: 'Qwen',
    enabled: false,
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    authMode: 'apikey',
    authStateRef: 'xl.auth.qwen',
    contextLimits: { maxContextTokens: 128000, historyTokenCap: 100000, maxInlineSheetCells: 5000 },
  },
  llama: {
    provider: 'llama',
    label: 'Llama',
    enabled: false,
    baseUrl: 'https://api.llama.com/compat/v1',
    model: 'Llama-3.3-70B-Instruct',
    authMode: 'apikey',
    authStateRef: 'xl.auth.llama',
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
