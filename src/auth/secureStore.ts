/**
 * Encryption at rest for provider credentials.
 *
 * Secrets are sealed with AES-GCM-256 (Web Crypto) before they reach
 * localStorage. The key is a non-extractable CryptoKey persisted in
 * IndexedDB: script can use it to encrypt/decrypt but can never read its
 * raw bytes, and the ciphertext in localStorage is useless without it.
 *
 * Fallbacks, in order: where IndexedDB is unavailable, a JWK in
 * localStorage (weaker — key and ciphertext share a store, but still
 * defeats plaintext scans); where neither browser store exists (unit
 * tests), an ephemeral in-memory key.
 *
 * Threat model: this protects the at-rest copy (disk inspection, storage
 * dumps, accidental exports). Same-origin XSS can still call decrypt;
 * only an OS credential vault outside the WebView closes that hole.
 */

const PREFIX = 'enc1:';
const DB_NAME = 'xl.keystore';
const DB_STORE = 'keys';
const DB_KEY_ID = 'primary';
const JWK_FALLBACK_KEY = 'xl.keystore.jwk';
const IV_BYTES = 12;

export class SecretDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretDecryptError';
  }
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Seal a secret for storage. Output format: `enc1:<iv b64>:<ciphertext b64>`. */
export async function encryptSecret(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain)
  );
  return PREFIX + toBase64(iv) + ':' + toBase64(new Uint8Array(ct));
}

/**
 * Open a sealed secret. Values without the `enc1:` prefix are returned
 * as-is so pre-encryption (plaintext) entries keep working; callers use
 * isEncryptedSecret to detect and re-seal them.
 */
export async function decryptSecret(value: string): Promise<string> {
  if (!isEncryptedSecret(value)) return value;

  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new SecretDecryptError('Malformed encrypted secret.');
  }

  const key = await getKey();
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(parts[0]) },
      key,
      fromBase64(parts[1])
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new SecretDecryptError('Stored secret could not be decrypted with the current key.');
  }
}

/** Test hook: drops the cached key so the next call acquires a fresh one. */
export function __resetSecureStoreForTests(): void {
  keyPromise = null;
}

// ── Key acquisition ────────────────────────────────────────────────────────

let keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (!keyPromise) keyPromise = acquireKey();
  return keyPromise;
}

async function acquireKey(): Promise<CryptoKey> {
  if (typeof indexedDB !== 'undefined') {
    try {
      return await getOrCreateIdbKey();
    } catch {
      // IndexedDB blocked or CryptoKey not clonable in this host
    }
  }
  if (typeof localStorage !== 'undefined') {
    try {
      return await getOrCreateJwkKey();
    } catch {
      // localStorage blocked or stored JWK corrupt
    }
  }
  return generateAesKey(false);
}

function generateAesKey(extractable: boolean): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, extractable, [
    'encrypt',
    'decrypt',
  ]);
}

async function getOrCreateIdbKey(): Promise<CryptoKey> {
  const db = await openKeystore();
  try {
    const existing = await idbGet(db, DB_KEY_ID);
    if (existing instanceof CryptoKey) return existing;
    const key = await generateAesKey(false);
    await idbPut(db, DB_KEY_ID, key);
    return key;
  } finally {
    db.close();
  }
}

async function getOrCreateJwkKey(): Promise<CryptoKey> {
  const raw = localStorage.getItem(JWK_FALLBACK_KEY);
  if (raw) {
    const jwk = JSON.parse(raw) as JsonWebKey;
    return crypto.subtle.importKey('jwk', jwk, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  const generated = await generateAesKey(true);
  const jwk = await crypto.subtle.exportKey('jwk', generated);
  localStorage.setItem(JWK_FALLBACK_KEY, JSON.stringify(jwk));
  // Re-import non-extractable so the live handle can't be exported either.
  return crypto.subtle.importKey('jwk', jwk, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// ── IndexedDB helpers ──────────────────────────────────────────────────────

function openKeystore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open keystore.'));
  });
}

function idbGet(db: IDBDatabase, id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Keystore read failed.'));
  });
}

function idbPut(db: IDBDatabase, id: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Keystore write failed.'));
  });
}

// ── Base64 helpers ─────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new SecretDecryptError('Encrypted secret is not valid base64.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
