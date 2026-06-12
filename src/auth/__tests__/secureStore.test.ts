import { describe, expect, it } from 'vitest';
import {
  __resetSecureStoreForTests,
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  SecretDecryptError,
} from '../secureStore';

const SECRET = 'sk-test-abcdef0123456789';

describe('secureStore', () => {
  it('round-trips a secret through encrypt and decrypt', async () => {
    const sealed = await encryptSecret(SECRET);
    expect(await decryptSecret(sealed)).toBe(SECRET);
  });

  it('produces an enc1 envelope that does not contain the plaintext', async () => {
    const sealed = await encryptSecret(SECRET);
    expect(isEncryptedSecret(sealed)).toBe(true);
    expect(sealed).toMatch(/^enc1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(sealed).not.toContain(SECRET);
  });

  it('uses a fresh IV per call, so equal inputs yield different ciphertexts', async () => {
    const a = await encryptSecret(SECRET);
    const b = await encryptSecret(SECRET);
    expect(a).not.toBe(b);
  });

  it('passes legacy plaintext values through decrypt unchanged', async () => {
    expect(isEncryptedSecret(SECRET)).toBe(false);
    expect(await decryptSecret(SECRET)).toBe(SECRET);
  });

  it('rejects a malformed envelope', async () => {
    await expect(decryptSecret('enc1:not-valid')).rejects.toBeInstanceOf(SecretDecryptError);
    await expect(decryptSecret('enc1:!!!:???')).rejects.toBeInstanceOf(SecretDecryptError);
  });

  it('rejects a tampered ciphertext', async () => {
    const sealed = await encryptSecret(SECRET);
    const [prefix, iv, ct] = sealed.split(':');
    const flipped = ct[0] === 'A' ? 'B' + ct.slice(1) : 'A' + ct.slice(1);
    await expect(decryptSecret(`${prefix}:${iv}:${flipped}`)).rejects.toBeInstanceOf(
      SecretDecryptError
    );
  });

  it('rejects ciphertext sealed under a lost key', async () => {
    const sealed = await encryptSecret(SECRET);
    __resetSecureStoreForTests();
    await expect(decryptSecret(sealed)).rejects.toBeInstanceOf(SecretDecryptError);
  });
});
