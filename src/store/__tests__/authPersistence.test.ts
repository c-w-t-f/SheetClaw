import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../index';
import { flushAuthPersistence } from '../slices/auth';
import { isEncryptedSecret } from '../../auth/secureStore';
import type { AuthState } from '../../types';

const OPENAI_KEY = 'sk-test-openai-0123456789abcdef';

function makeLocalStorageStub() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

let ls: ReturnType<typeof makeLocalStorageStub>;

beforeEach(() => {
  ls = makeLocalStorageStub();
  vi.stubGlobal('localStorage', ls);
});

describe('auth slice persistence', () => {
  it('persists API keys as ciphertext, never plaintext', async () => {
    useStore.getState().saveApiKey('openai', OPENAI_KEY);
    await flushAuthPersistence();

    const raw = ls.getItem('xl.auth.openai');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain(OPENAI_KEY);

    const saved = JSON.parse(raw!) as AuthState;
    expect(saved._key).toBeTruthy();
    expect(isEncryptedSecret(saved._key!)).toBe(true);
    // In-memory state keeps the usable plaintext for adapters.
    expect(useStore.getState().authStates.openai._key).toBe(OPENAI_KEY);
  });

  it('restores the plaintext key on load', async () => {
    useStore.getState().saveApiKey('openai', OPENAI_KEY);
    await flushAuthPersistence();

    // Simulate a fresh boot: wipe the in-memory copy, then hydrate.
    useStore.setState(s => ({
      authStates: {
        ...s.authStates,
        openai: { provider: 'openai', state: 'unauthenticated' },
      },
    }));
    await useStore.getState().loadAuthFromStorage();

    const auth = useStore.getState().authStates.openai;
    expect(auth.state).toBe('authenticated');
    expect(auth._key).toBe(OPENAI_KEY);
  });

  it('migrates a legacy plaintext entry to ciphertext on load', async () => {
    const legacy = {
      _v: 1,
      provider: 'anthropic',
      state: 'authenticated',
      authMode: 'apikey',
      apiKeyMasked: 'sk-a••••gacy',
      _key: 'sk-ant-legacy-key',
    };
    ls.setItem('xl.auth.anthropic', JSON.stringify(legacy));

    await useStore.getState().loadAuthFromStorage();
    expect(useStore.getState().authStates.anthropic._key).toBe('sk-ant-legacy-key');

    await flushAuthPersistence();
    const raw = ls.getItem('xl.auth.anthropic')!;
    expect(raw).not.toContain('sk-ant-legacy-key');
    expect(isEncryptedSecret((JSON.parse(raw) as AuthState)._key!)).toBe(true);
  });

  it('encrypts OAuth access and refresh tokens', async () => {
    useStore.getState().saveOAuthCredential('generic', {
      accessToken: 'or-access-token-123',
      refreshToken: 'or-refresh-token-456',
      oauthProvider: 'openrouter',
    });
    await flushAuthPersistence();

    const raw = ls.getItem('xl.auth.generic')!;
    expect(raw).not.toContain('or-access-token-123');
    expect(raw).not.toContain('or-refresh-token-456');
    const saved = JSON.parse(raw) as AuthState;
    expect(isEncryptedSecret(saved.accessToken!)).toBe(true);
    expect(isEncryptedSecret(saved.refreshToken!)).toBe(true);
    expect(isEncryptedSecret(saved._key!)).toBe(true);
  });

  it('a clear issued after a save wins, despite async sealing', async () => {
    useStore.getState().saveApiKey('groq', 'sk-groq-transient');
    useStore.getState().clearApiKey('groq');
    await flushAuthPersistence();

    const saved = JSON.parse(ls.getItem('xl.auth.groq')!) as AuthState;
    expect(saved.state).toBe('unauthenticated');
    expect(saved._key).toBeUndefined();
    expect(ls.getItem('xl.auth.groq')).not.toContain('sk-groq-transient');
  });
});
