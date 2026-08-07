import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { config } from '../config';

/**
 * Hand-rolled rather than promisify()'d: promisify collapses scrypt's
 * overloads and loses the options argument, which is where the cost
 * parameters live.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Password hashing with scrypt.
 *
 * scrypt rather than argon2id purely for operational reasons: it ships inside
 * Node, so there is no native module to compile on a developer's Windows
 * machine or in a slim CI container. It is memory-hard and on OWASP's
 * recommended list, which makes it a legitimate choice rather than a
 * compromise. If argon2id becomes worth the build cost later, only this file
 * changes - the stored format carries its own algorithm tag.
 *
 * Never bcrypt: it silently truncates at 72 bytes.
 *
 * Stored format:  scrypt$N$r$p$<salt-b64>$<hash-b64>
 *
 * The parameters travel WITH the hash, so raising the cost later does not
 * invalidate existing passwords - old hashes keep verifying under their own
 * parameters and get upgraded on next login.
 */

const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function maxmemFor(n: number, r: number): number {
  // Node's default cap is 32MB, well below what a sound cost needs.
  return 256 * n * r + 1024 * 1024;
}

export async function hashPassword(plain: string): Promise<string> {
  const n = 2 ** config.PASSWORD_COST_EXPONENT;
  const salt = randomBytes(SALT_LENGTH);

  const derived = (await scryptAsync(plain.normalize('NFKC'), salt, KEY_LENGTH, {
    N: n,
    r: R,
    p: P,
    maxmem: maxmemFor(n, R),
  }));

  return [
    'scrypt',
    n,
    R,
    P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(
  plain: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }

  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');

  const derived = (await scryptAsync(
    plain.normalize('NFKC'),
    salt,
    expected.length,
    { N: n, r, p, maxmem: maxmemFor(n, r) },
  ));

  // Constant time: a length-dependent early return leaks information.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** True when a hash was made with weaker parameters than we now require. */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored) return true;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < 2 ** config.PASSWORD_COST_EXPONENT;
}

