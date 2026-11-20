import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/server/db";

export const ADMIN_USERNAME = "admin";

type AdminState = {
  booted: boolean;
  exists: boolean;
  tokenHash: Buffer | null;
};

// survives dev reloads so the printed token stays valid
const globals = globalThis as typeof globalThis & { __takawebAdmin?: AdminState };

const state = (globals.__takawebAdmin ??= {
  booted: false,
  exists: false,
  tokenHash: null,
});

/**
 * sha256 digest of a value
 *
 * @param value input
 *
 * @returns {Buffer} digest
 */
const sha256 = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

/**
 * strip separators and casing so pasted tokens still match
 *
 * @param token raw token
 *
 * @returns {string} normalized token
 */
const normalize = (token: string): string =>
  token.replace(/[^a-f0-9]/gi, "").toLowerCase();

/**
 * check whether the admin account was created
 *
 * @returns {boolean} whether it exists
 */
export function hasAdmin(): boolean {
  if (state.exists) return true;

  state.exists = !!db
    .prepare("SELECT 1 FROM user WHERE username = ?")
    .get(ADMIN_USERNAME);

  return state.exists;
}

/**
 * get the admin account
 *
 * @returns {{ id: number; passwordHash: string } | null} admin or null
 */
export function getAdmin(): { id: number; passwordHash: string } | null {
  const row = db
    .prepare("SELECT id, password_hash FROM user WHERE username = ?")
    .get(ADMIN_USERNAME) as { id: number; password_hash: string } | undefined;

  return row ? { id: row.id, passwordHash: row.password_hash } : null;
}

/**
 * create the admin account, unless one already exists
 *
 * @param passwordHash encoded password hash
 *
 * @returns {number | null} admin id, or null if it already existed
 */
export function createAdmin(passwordHash: string): number | null {
  const row = db
    .prepare(
      `INSERT INTO user (username, password_hash, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
    )
    .get(ADMIN_USERNAME, passwordHash, Date.now()) as { id: number } | undefined;

  if (!row) return null;

  state.exists = true;
  state.tokenHash = null;

  return row.id;
}

/**
 * check a setup token in constant time
 *
 * @param token token from the setup form
 *
 * @returns {boolean} whether it matches the issued token
 */
export function verifySetupToken(token: string): boolean {
  if (!state.tokenHash) return false;

  return timingSafeEqual(sha256(normalize(token)), state.tokenHash);
}

/**
 * issue a one-time setup token and print it, once per process
 * only the hash is kept, so a restart issues a new token
 */
export function bootstrap() {
  if (state.booted) return;
  state.booted = true;

  if (hasAdmin()) return;

  const raw = randomBytes(16).toString("hex");
  state.tokenHash = sha256(raw);

  const token = raw.match(/.{4}/g)!.join("-");
  const lines = [
    "no admin account found, open /setup and use this one-time token:",
    "",
    `    ${token}`,
    "",
    "the token is valid until it is used or the server restarts",
  ];

  console.log(`\n${lines.map((line) => `[takaweb] ${line}`).join("\n")}\n`);
}
