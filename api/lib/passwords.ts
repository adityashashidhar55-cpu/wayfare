import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

// scrypt work factor N (CPU/memory cost). r=8, p=1 are the recommended
// interactive-login parameters; N=16384 is the OWASP minimum for scrypt.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_LEN = 16;
const KEY_LEN = 64;

// Stored format: scrypt$N$saltHex$hashHex
const FORMAT = /^scrypt\$(\d+)\$([0-9a-f]+)\$([0-9a-f]+)$/;

/** Hash a plaintext password for storage. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * Verify a plaintext password against a stored hash. Returns false for any
 * malformed input - never throws - so callers can treat every failure the
 * same ("invalid email or password").
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const match = FORMAT.exec(stored);
  if (!match) return false;
  const [, nStr, saltHex, hashHex] = match;
  const N = Number(nStr);
  if (!Number.isSafeInteger(N) || N <= 0 || (N & (N - 1)) !== 0) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = await scrypt(password, salt, expected.length, {
      N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
