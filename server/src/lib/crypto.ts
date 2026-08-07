import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';
import { config } from '../config';

/**
 * Encryption at rest for third-party credentials.
 *
 * A Google refresh token is a long-lived key to somebody's calendar. Stored in
 * plaintext, a leaked database dump — or a stray log line, or a support
 * engineer running an ad-hoc SELECT — hands over every connected studio's
 * schedule. Hashing is not an option because we need the value back, so this
 * is real symmetric encryption with the key held outside the database.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails loudly instead of
 * decrypting to garbage. Each value gets a fresh random IV, so identical
 * tokens do not produce identical ciphertext.
 *
 * Format: v1.<iv-b64>.<tag-b64>.<ciphertext-b64>
 * The version prefix exists so the key can be rotated later without guessing
 * which scheme a given row used.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, the size GCM is specified for
const VERSION = 'v1';

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;

  const configured = config.CREDENTIAL_ENCRYPTION_KEY;

  if (configured) {
    const decoded = Buffer.from(configured, 'base64');
    if (decoded.length !== 32) {
      throw new Error(
        'CREDENTIAL_ENCRYPTION_KEY must be 32 bytes, base64 encoded. ' +
          'Generate one with: openssl rand -base64 32',
      );
    }
    cachedKey = decoded;
    return cachedKey;
  }

  /**
   * Development and test only. Derived from the JWT secret so it is stable
   * across restarts — otherwise every reload would orphan every stored token.
   * Production refuses to start without a real key (see config.ts).
   */
  cachedKey = createHash('sha256')
    .update(`dev-credential-key:${config.JWT_ACCESS_SECRET}`)
    .digest();

  return cachedKey;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

export function decryptSecret(encoded: string): string {
  const parts = encoded.split('.');

  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Malformed encrypted value.');
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(parts[1]!, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(parts[2]!, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(parts[3]!, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Test hook — the key is cached, and tests change the config underneath it. */
export function resetEncryptionKey() {
  cachedKey = null;
}
