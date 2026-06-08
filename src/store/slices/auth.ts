import type { StateCreator } from 'zustand';
import type { AuthState, ProviderKey } from '../../types';

export interface AuthSlice {
  authStates: Record<ProviderKey, AuthState>;
  setAuthState(provider: ProviderKey, state: Partial<AuthState>): void;
  isProviderReady(provider: ProviderKey): boolean;
}

const DEFAULT_AUTH_STATE = (provider: ProviderKey): AuthState => ({
  provider,
  state: 'unauthenticated',
});

const ALL_PROVIDERS: ProviderKey[] = ['ollama', 'openai', 'anthropic', 'generic'];

export const createAuthSlice: StateCreator<AuthSlice> = set => ({
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

  isProviderReady(provider) {
    const s = this.authStates[provider]?.state;
    if (provider === 'ollama') return s === 'unauthenticated' || s === 'authenticated';
    return s === 'authenticated';
  },
});
