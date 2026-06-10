import type { StateCreator } from 'zustand';
import type { AuthState, ProviderKey, SearchProviderId } from '../../types';
import { storage } from '../storage';

const AUTH_KEY = (p: ProviderKey) => `xl.auth.${p}`;
const SEARCH_AUTH_KEY = (p: SearchProviderId) => `xl.auth.search:${p}`;

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

export interface AuthSlice {
  authStates: Record<ProviderKey, AuthState>;
  searchAuthStates: Record<SearchProviderId, AuthState>;
  setAuthState(provider: ProviderKey, state: Partial<AuthState>): void;
  saveApiKey(provider: ProviderKey, key: string): void;
  saveOAuthCredential(provider: ProviderKey, credential: {
    accessToken: string;
    oauthProvider?: AuthState['oauthProvider'];
    userId?: string;
    refreshToken?: string;
    tokenType?: string;
    expiresAt?: string;
  }): void;
  clearApiKey(provider: ProviderKey): void;
  saveSearchApiKey(provider: SearchProviderId, key: string): void;
  clearSearchApiKey(provider: SearchProviderId): void;
  loadAuthFromStorage(): void;
  isProviderReady(provider: ProviderKey): boolean;
  isSearchProviderReady(provider: SearchProviderId): boolean;
}

const DEFAULT_AUTH_STATE = (provider: string): AuthState => ({
  provider,
  state: 'unauthenticated',
});

const ALL_PROVIDERS: ProviderKey[] = [
  'ollama',
  'openai',
  'anthropic',
  'generic',
  'deepseek',
  'groq',
  'mistral',
  'together',
  'kimi',
  'glm',
  'qwen',
  'llama',
];

const SEARCH_PROVIDERS: SearchProviderId[] = ['tavily'];

export const createAuthSlice: StateCreator<AuthSlice> = (set, get) => ({
  authStates: Object.fromEntries(
    ALL_PROVIDERS.map(p => [p, DEFAULT_AUTH_STATE(p)])
  ) as Record<ProviderKey, AuthState>,
  searchAuthStates: Object.fromEntries(
    SEARCH_PROVIDERS.map(p => [p, DEFAULT_AUTH_STATE(`search:${p}`)])
  ) as Record<SearchProviderId, AuthState>,

  setAuthState(provider, patch) {
    set(state => ({
      authStates: {
        ...state.authStates,
        [provider]: { ...state.authStates[provider], ...patch },
      },
    }));
  },

  saveApiKey(provider, key) {
    const trimmed = key.trim();
    const next: AuthState = {
      provider,
      state: trimmed ? 'authenticated' : 'unauthenticated',
      authMode: trimmed ? 'apikey' : undefined,
      apiKeyMasked: trimmed ? maskKey(trimmed) : undefined,
      _key: trimmed || undefined,
    };
    storage.put(AUTH_KEY(provider), next);
    set(state => ({ authStates: { ...state.authStates, [provider]: next } }));
  },

  saveOAuthCredential(provider, credential) {
    const trimmed = credential.accessToken.trim();
    const next: AuthState = {
      provider,
      state: trimmed ? 'authenticated' : 'unauthenticated',
      authMode: trimmed ? 'oauth' : undefined,
      oauthProvider: credential.oauthProvider,
      apiKeyMasked: trimmed ? maskKey(trimmed) : undefined,
      accessToken: trimmed || undefined,
      refreshToken: credential.refreshToken,
      tokenType: credential.tokenType ?? 'Bearer',
      expiresAt: credential.expiresAt,
      userId: credential.userId,
      _key: trimmed || undefined,
    };
    storage.put(AUTH_KEY(provider), next);
    set(state => ({ authStates: { ...state.authStates, [provider]: next } }));
  },

  clearApiKey(provider) {
    const next: AuthState = { provider, state: 'unauthenticated' };
    storage.put(AUTH_KEY(provider), next);
    set(state => ({ authStates: { ...state.authStates, [provider]: next } }));
  },

  saveSearchApiKey(provider, key) {
    const trimmed = key.trim();
    const next: AuthState = {
      provider: `search:${provider}`,
      state: trimmed ? 'authenticated' : 'unauthenticated',
      authMode: trimmed ? 'apikey' : undefined,
      apiKeyMasked: trimmed ? maskKey(trimmed) : undefined,
      _key: trimmed || undefined,
    };
    storage.put(SEARCH_AUTH_KEY(provider), next);
    set(state => ({ searchAuthStates: { ...state.searchAuthStates, [provider]: next } }));
  },

  clearSearchApiKey(provider) {
    const next: AuthState = { provider: `search:${provider}`, state: 'unauthenticated' };
    storage.put(SEARCH_AUTH_KEY(provider), next);
    set(state => ({ searchAuthStates: { ...state.searchAuthStates, [provider]: next } }));
  },

  loadAuthFromStorage() {
    const loaded: Partial<Record<ProviderKey, AuthState>> = {};
    for (const p of ALL_PROVIDERS) {
      const saved = storage.get<AuthState>(AUTH_KEY(p));
      if (saved) loaded[p] = saved;
    }
    const loadedSearch: Partial<Record<SearchProviderId, AuthState>> = {};
    for (const p of SEARCH_PROVIDERS) {
      const saved = storage.get<AuthState>(SEARCH_AUTH_KEY(p));
      if (saved) loadedSearch[p] = saved;
    }
    if (Object.keys(loaded).length > 0) {
      set(state => ({
        authStates: { ...state.authStates, ...loaded },
      }));
    }
    if (Object.keys(loadedSearch).length > 0) {
      set(state => ({
        searchAuthStates: { ...state.searchAuthStates, ...loadedSearch },
      }));
    }
  },

  isProviderReady(provider) {
    const auth = get().authStates[provider];
    const s = auth?.state;
    if (provider === 'ollama') return s === 'unauthenticated' || s === 'authenticated';
    if (auth?.expiresAt && Date.parse(auth.expiresAt) <= Date.now() + 60_000) return false;
    return s === 'authenticated';
  },

  isSearchProviderReady(provider) {
    const auth = get().searchAuthStates[provider];
    return auth?.state === 'authenticated';
  },
});
