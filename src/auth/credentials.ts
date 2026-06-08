import type { AuthState } from '../types';

const EXPIRY_MARGIN_MS = 60_000;

export function isAuthExpired(auth: AuthState | undefined, now = Date.now()): boolean {
  if (!auth?.expiresAt) return false;
  const expiresAt = Date.parse(auth.expiresAt);
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt - EXPIRY_MARGIN_MS <= now;
}

export function getAuthCredential(auth: AuthState | undefined): string {
  if (!auth || isAuthExpired(auth)) return '';
  return auth.accessToken ?? auth._key ?? '';
}

