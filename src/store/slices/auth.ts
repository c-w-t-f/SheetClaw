import type { StateCreator } from 'zustand';
import type { AuthState, ProviderKey } from '../../types';
import { storage } from '../storage';

const AUTH_KEY = (p: ProviderKey) => `xl.auth.${p}`;

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

export interface AuthSlice {
  authStates: Record<ProviderKey, AuthState>;
  setAuthState(provider: ProviderKey, state: Partial<AuthState>): void;
  saveApiKey(provider: ProviderKey, key: string): void;
  clearApiKey(provider: ProviderKey): void;
  loadAuthFromStorage(): void;
  isProviderReady(provider: ProviderKey): boolean;
}

const DEFAULT_AUTH_STATE = (provider: ProviderKey): AuthState => ({
  provider,
  state: 'unauthenticated',
});

const ALL_PROVIDERS: ProviderKey[] = ['ollama', 'openai', 'anthropic', 'generic'];

export const createAuthSlice: StateCreator<AuthSlice> = (set, get) => ({
  authStates: Object.fromEntries(
    ALL_PROVIDERS.map(p => [p, DEFAULT_AUTH_STATE(p)])
  ) as Record<ProviderKey, AuthState>,

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
      apiKeyMasked: trimmed ? maskKey(trimmed) : undefined,
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

  loadAuthFromStorage() {
    const loaded: Partial<Record<ProviderKey, AuthState>> = {};
    for (const p of ALL_PROVIDERS) {
      const saved = storage.get<AuthState>(AUTH_KEY(p));
      if (saved) loaded[p] = saved;
    }
    if (Object.keys(loaded).length > 0) {
      set(state => ({
        authStates: { ...state.authStates, ...loaded },
      }));
    }
  },

  isProviderReady(provider) {
    const s = get().authStates[provider]?.state;
    if (provider === 'ollama') return s === 'unauthenticated' || s === 'authenticated';
    return s === 'authenticated';
  },
});
