import { describe, expect, it, vi } from 'vitest';
import {
  buildOpenRouterAuthUrl,
  createOAuthStartUrl,
  createOpenRouterCallbackUrl,
  createPKCEPair,
  exchangeOpenRouterCode,
  type PKCEPair,
} from '../oauthFlow';

describe('OpenRouter OAuth helpers', () => {
  it('builds a localhost callback URL with provider and state', () => {
    const url = createOpenRouterCallbackUrl('https://localhost:3000', 'state-123');
    expect(url.toString()).toBe('https://localhost:3000/oauth-callback.html?provider=openrouter&state=state-123');
  });

  it('builds a same-origin OAuth start URL', () => {
    const start = new URL(createOAuthStartUrl(
      'https://openrouter.ai/auth?callback_url=https%3A%2F%2Flocalhost%3A3000%2Foauth-callback.html',
      'https://localhost:3000'
    ));
    expect(start.toString()).toContain('https://localhost:3000/oauth-start.html?to=');
    expect(start.searchParams.get('to')).toContain('https://openrouter.ai/auth');
  });

  it('builds the OpenRouter auth URL with PKCE challenge params', () => {
    const pkce: PKCEPair = {
      codeVerifier: 'verifier',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
    };
    const url = new URL(buildOpenRouterAuthUrl('https://localhost:3000/oauth-callback.html', pkce));
    expect(url.origin).toBe('https://openrouter.ai');
    expect(url.pathname).toBe('/auth');
    expect(url.searchParams.get('callback_url')).toBe('https://localhost:3000/oauth-callback.html');
    expect(url.searchParams.get('code_challenge')).toBe('challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('generates a PKCE verifier and S256 challenge', async () => {
    const pkce = await createPKCEPair();
    expect(pkce.codeChallengeMethod).toBe('S256');
    expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('exchanges an authorization code for an OpenRouter key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      key: 'sk-or-v1-test',
      user_id: 'user_123',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await exchangeOpenRouterCode('code-123', {
      codeVerifier: 'verifier-123',
      codeChallenge: 'challenge-123',
      codeChallengeMethod: 'S256',
    });

    expect(result).toEqual({ key: 'sk-or-v1-test', userId: 'user_123' });
    expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/auth/keys', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'code-123',
        code_verifier: 'verifier-123',
        code_challenge_method: 'S256',
      }),
    }));

    vi.unstubAllGlobals();
  });
});
