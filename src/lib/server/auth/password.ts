import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

type ScryptParams = { N: number; r: number; p: number };

/**
 * scrypt cost, owasp recommended baseline
 */
const PARAMS: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * derive a key from a password
 *
 * @param password plain password
 * @param salt random salt
 * @param params scrypt cost
 * @param length key length in bytes
 *
 * @returns {Promise<Buffer>} derived key
 */
function derive(
  password: string,
  salt: Buffer,
  { N, r, p }: ScryptParams,
  length = KEY_LENGTH,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      length,
      { N, r, p, maxmem: 256 * N * r },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/**
 * hash a password with a fresh salt
 *
 * @param password plain password
 *
 * @returns {Promise<string>} encoded hash as scrypt$N$r$p$salt$key
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, PARAMS);

  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * check a password against an encoded hash in constant time
 *
 * @param password plain password
 * @param encoded hash from hashPassword
 *
 * @returns {Promise<boolean>} whether it matches
 */
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, N, r, p, salt, hash] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;

  const expected = Buffer.from(hash, "base64");
  const key = await derive(
    password,
    Buffer.from(salt, "base64"),
    { N: Number(N), r: Number(r), p: Number(p) },
    expected.length,
  );

  return timingSafeEqual(key, expected);
}
