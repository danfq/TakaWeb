import { createHash, randomBytes } from "node:crypto"
import type { AstroCookies } from "astro"
import { TAKAWEB_URL } from "astro:env/server"
import { db } from "@/lib/server/db"
import type { SessionInfo } from "@/lib/account"

export const SESSION_COOKIE = "takaweb_session"

const DAY = 24 * 60 * 60 * 1000

/**
 * session lifetime, renewed once less than half remains
 */
const SESSION_TTL = 30 * DAY
const RENEW_THRESHOLD = SESSION_TTL / 2

export type User = { id: number; username: string }
export type Session = { id: string; userId: number; expiresAt: number }

/**
 * where a session signed in from
 */
export type SessionOrigin = { ip: string; userAgent: string }

type CookieContext = { cookies: AstroCookies; url: URL }

/**
 * hash a session token, only hashes are stored
 *
 * @param token raw session token
 *
 * @returns {string} session id
 */
const toSessionId = (token: string): string => createHash("sha256").update(token).digest("hex")

/**
 * create a session for a user
 *
 * @param userId user id
 * @param origin address and user agent it signed in from
 *
 * @returns {{ token: string; expiresAt: number }} raw token and expiry
 */
export function createSession(
  userId: number,
  origin: SessionOrigin
): {
  token: string
  expiresAt: number
} {
  const token = randomBytes(32).toString("base64url")
  const now = Date.now()
  const expiresAt = now + SESSION_TTL

  // prune expired sessions on the way
  db.prepare("DELETE FROM session WHERE expires_at <= ?").run(now)
  db.prepare(
    "INSERT INTO session (id, user_id, expires_at, created_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(toSessionId(token), userId, expiresAt, now, origin.ip, origin.userAgent)

  return { token, expiresAt }
}

/**
 * resolve a session token, renewing it when close to expiry
 *
 * @param token raw session token
 *
 * @returns {{ session: Session; user: User; renewed: boolean } | null} session or null
 */
export function validateSession(token: string): { session: Session; user: User; renewed: boolean } | null {
  const id = toSessionId(token)
  const row = db
    .prepare(
      `SELECT session.user_id, session.expires_at, user.username
       FROM session
       INNER JOIN user ON user.id = session.user_id
       WHERE session.id = ?`
    )
    .get(id) as { user_id: number; expires_at: number; username: string } | undefined

  if (!row) return null

  const now = Date.now()

  if (now >= row.expires_at) {
    invalidateSession(id)
    return null
  }

  let expiresAt = row.expires_at
  const renewed = expiresAt - now < RENEW_THRESHOLD

  if (renewed) {
    expiresAt = now + SESSION_TTL
    db.prepare("UPDATE session SET expires_at = ? WHERE id = ?").run(expiresAt, id)
  }

  return {
    session: { id, userId: row.user_id, expiresAt },
    user: { id: row.user_id, username: row.username },
    renewed,
  }
}

/**
 * delete a session
 *
 * @param id session id
 */
export function invalidateSession(id: string) {
  db.prepare("DELETE FROM session WHERE id = ?").run(id)
}

/**
 * every live session of a user, newest first
 *
 * @param userId user id
 * @param currentId session making the request
 *
 * @returns {SessionInfo[]} sessions
 */
export function listSessions(userId: number, currentId: string): SessionInfo[] {
  const rows = db
    .prepare(
      `SELECT id, ip, user_agent, created_at FROM session
       WHERE user_id = ? AND expires_at > ?
       ORDER BY created_at DESC, id`
    )
    .all(userId, Date.now()) as { id: string; ip: string; user_agent: string; created_at: number }[]

  return rows.map((row) => ({
    id: row.id,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    current: row.id === currentId,
  }))
}

/**
 * sign out another session of a user, never the one asking
 *
 * @param userId user id
 * @param id session to revoke
 * @param currentId session making the request
 *
 * @returns {boolean} whether a session was revoked
 */
export function revokeSession(userId: number, id: string, currentId: string): boolean {
  if (id === currentId) return false

  const { changes } = db.prepare("DELETE FROM session WHERE id = ? AND user_id = ?").run(id, userId)

  return changes > 0
}

/**
 * sign out every session of a user except one
 *
 * @param userId user id
 * @param keepId session to keep, null signs out all of them
 *
 * @returns {number} sessions revoked
 */
export function revokeOtherSessions(userId: number, keepId: string | null): number {
  const { changes } = db.prepare("DELETE FROM session WHERE user_id = ? AND id IS NOT ?").run(userId, keepId)

  return Number(changes)
}

/**
 * only mark cookies secure when served over https
 *
 * @param url request url
 *
 * @returns {boolean} whether cookies should be secure
 */
const isSecure = (url: URL): boolean =>
  (TAKAWEB_URL ? new URL(TAKAWEB_URL).protocol : url.protocol) === "https:"

/**
 * set the session cookie
 *
 * @param context request cookies and url
 * @param token raw session token
 * @param expiresAt expiry timestamp
 */
export function setSessionCookie({ cookies, url }: CookieContext, token: string, expiresAt: number) {
  cookies.set(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure(url),
    expires: new Date(expiresAt),
  })
}

/**
 * clear the session cookie
 *
 * @param context request cookies and url
 */
export function deleteSessionCookie({ cookies, url }: CookieContext) {
  cookies.delete(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure(url),
  })
}
