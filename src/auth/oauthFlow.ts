export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

export interface OAuthCallbackResult {
  provider: string | null;
  code: string;
  state: string;
}

export interface OpenRouterOAuthResult {
  key: string;
  userId?: string;
}

const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
const OPENROUTER_EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

interface OAuthCallbackMessage extends Partial<OAuthCallbackResult> {
  type?: string;
  error?: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function createPKCEPair(): Promise<PKCEPair> {
  const codeVerifier = randomBase64Url(64);
  const bytes = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return {
    codeVerifier,
    codeChallenge: base64Url(new Uint8Array(digest)),
    codeChallengeMethod: 'S256',
  };
}

export function createOpenRouterCallbackUrl(origin = window.location.origin, state = randomBase64Url(24)): URL {
  const url = new URL('/oauth-callback.html', origin);
  url.searchParams.set('provider', 'openrouter');
  url.searchParams.set('state', state);
  return url;
}

export function createOAuthStartUrl(authUrl: string, origin = window.location.origin): string {
  const url = new URL('/oauth-start.html', origin);
  url.searchParams.set('to', authUrl);
  return url.toString();
}

export function buildOpenRouterAuthUrl(callbackUrl: string, pkce: PKCEPair): string {
  const url = new URL(OPENROUTER_AUTH_URL);
  url.searchParams.set('callback_url', callbackUrl);
  url.searchParams.set('code_challenge', pkce.codeChallenge);
  url.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);
  return url.toString();
}

function parseCallbackMessage(raw: unknown): OAuthCallbackMessage | null {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as OAuthCallbackMessage;
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === 'object') return raw as OAuthCallbackMessage;
  return null;
}

function validateCallback(data: OAuthCallbackMessage | null, expectedState: string): OAuthCallbackResult | null {
  if (!data || data.type !== 'xl-oauth-callback') return null;
  if (data.error) throw new Error(data.error);
  if (!data.code || !data.state) {
    throw new Error('OAuth callback did not include a code and state.');
  }
  if (data.state !== expectedState) {
    throw new Error('OAuth state mismatch. Sign-in was cancelled for safety.');
  }
  return { provider: data.provider ?? null, code: data.code, state: data.state };
}

function hasOfficeDialogApi(): boolean {
  return typeof Office !== 'undefined'
    && !!Office.context?.ui?.displayDialogAsync
    && !!Office.EventType?.DialogMessageReceived;
}

function openOAuthOfficeDialog(authUrl: string, expectedState: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<OAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    const startUrl = createOAuthStartUrl(authUrl);
    let settled = false;
    let dialog: Office.Dialog | null = null;

    const timeout = window.setTimeout(() => {
      finish(undefined, new Error('OAuth timed out before the provider returned a code.'));
    }, timeoutMs);

    function finish(result?: OAuthCallbackResult, error?: Error) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      try { dialog?.close(); } catch { /* ignored */ }
      if (error) reject(error);
      else if (result) resolve(result);
    }

    Office.context.ui.displayDialogAsync(
      startUrl,
      { height: 70, width: 45, promptBeforeOpen: false },
      result => {
        if (result.status !== Office.AsyncResultStatus.Succeeded) {
          finish(undefined, new Error(result.error?.message ?? 'Office could not open the OAuth dialog.'));
          return;
        }

        dialog = result.value;
        dialog.addEventHandler(Office.EventType.DialogMessageReceived, arg => {
          try {
            const message = 'message' in arg ? arg.message : undefined;
            const callback = validateCallback(parseCallbackMessage(message), expectedState);
            if (callback) finish(callback);
          } catch (e) {
            finish(undefined, e instanceof Error ? e : new Error(String(e)));
          }
        });
        dialog.addEventHandler(Office.EventType.DialogEventReceived, arg => {
          if ('error' in arg && arg.error === 12006) {
            finish(undefined, new Error('OAuth window was closed before sign-in completed.'));
            return;
          }
          finish(undefined, new Error('Office OAuth dialog closed before sign-in completed.'));
        });
      }
    );
  });
}

export function openOAuthPopup(authUrl: string): Window {
  const popup = window.open(
    authUrl,
    'excel-openrouter-oauth',
    'popup=yes,width=540,height=720'
  );
  if (!popup) {
    throw new Error('OAuth popup was blocked by the host WebView.');
  }
  popup.focus();
  return popup;
}

export function waitForOAuthCallback(
  popup: Window,
  expectedState: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<OAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('OAuth timed out before the provider returned a code.'));
    }, timeoutMs);

    const closedPoll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error('OAuth window was closed before sign-in completed.'));
      }
    }, 500);

    function cleanup() {
      window.clearTimeout(timeout);
      window.clearInterval(closedPoll);
      window.removeEventListener('message', onMessage);
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      let callback: OAuthCallbackResult | null = null;
      try {
        callback = validateCallback(parseCallbackMessage(event.data), expectedState);
      } catch (e) {
        cleanup();
        try { popup.close(); } catch { /* ignored */ }
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      if (!callback) return;

      cleanup();
      try { popup.close(); } catch { /* ignored */ }
      resolve(callback);
    }

    window.addEventListener('message', onMessage);
  });
}

export async function exchangeOpenRouterCode(
  code: string,
  pkce: PKCEPair
): Promise<OpenRouterOAuthResult> {
  const res = await fetch(OPENROUTER_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: pkce.codeVerifier,
      code_challenge_method: pkce.codeChallengeMethod,
    }),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch { /* ignored */ }
    throw new Error(`OpenRouter code exchange failed: HTTP ${res.status}${detail ? ` ${detail.slice(0, 160)}` : ''}`);
  }

  const data = await res.json() as { key?: string; user_id?: string | null };
  if (!data.key) throw new Error('OpenRouter code exchange did not return an API key.');
  return { key: data.key, userId: data.user_id ?? undefined };
}

export async function signInWithOpenRouter(): Promise<OpenRouterOAuthResult> {
  const pkce = await createPKCEPair();
  const callbackUrl = createOpenRouterCallbackUrl(window.location.origin);
  const state = callbackUrl.searchParams.get('state') ?? '';
  const authUrl = buildOpenRouterAuthUrl(callbackUrl.toString(), pkce);
  const callback = hasOfficeDialogApi()
    ? await openOAuthOfficeDialog(authUrl, state)
    : await waitForOAuthCallback(openOAuthPopup(authUrl), state);
  return exchangeOpenRouterCode(callback.code, pkce);
}
