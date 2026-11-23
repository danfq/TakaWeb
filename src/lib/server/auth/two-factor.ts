import { createHash, randomBytes } from "node:crypto"
import { ADMIN_USERNAME } from "@/lib/server/auth/admin"
import { isSecure, type CookieContext } from "@/lib/server/auth/session"
import { generateSecret, totpUri, verifyTotp } from "@/lib/server/auth/totp"
import { db } from "@/lib/server/db"

/**
 * holds a sign in that passed the password and still needs a code
 */
export const CHALLENGE_COOKIE = "takaweb_challenge"

const MINUTE = 60_000

/**
 * how long a password stays good for while the code is typed
 */
const CHALLENGE_TTL = 5 * MINUTE

/**
 * wrong codes a challenge takes before the password is needed again
 */
const CHALLENGE_ATTEMPTS = 5

/**
 * how long a new secret waits to be confirmed with a code
 */
const ENROLLMENT_TTL = 10 * MINUTE

type Challenge = { userId: number; expiresAt: number; attempts: number }
type Enrollment = { userId: number; secret: string; expiresAt: number }

type TwoFactorState = {
  // by token hash
  challenges: Map<string, Challenge>
  // by session id
  enrollments: Map<string, Enrollment>
}

// survives dev reloads, so a reload never drops a sign in halfway through
const globals = globalThis as typeof globalThis & { __takawebTwoFactor?: TwoFactorState }

const state = (globals.__takawebTwoFactor ??= {
  challenges: new Map(),
  enrollments: new Map(),
})

/**
 * hash a challenge token, only hashes are kept
 *
 * @param token raw token
 *
 * @returns {string} challenge id
 */
const toChallengeId = (token: string): string => createHash("sha256").update(token).digest("hex")

/**
 * drop expired challenges and enrollments
 *
 * @param now current instant
 */
function prune(now: number) {
  for (const [id, challenge] of state.challenges) if (now >= challenge.expiresAt) state.challenges.delete(id)
  for (const [id, enrollment] of state.enrollments)
    if (now >= enrollment.expiresAt) state.enrollments.delete(id)
}

/**
 * whether a user signs in with a code too
 *
 * @param userId user id
 *
 * @returns {boolean} whether two-factor is on
 */
export function hasTotp(userId: number): boolean {
  const row = db.prepare("SELECT totp_secret FROM user WHERE id = ?").get(userId) as
    { totp_secret: string | null } | undefined

  return !!row?.totp_secret
}

/**
 * check a code against a user's secret, spending its time step so it never works twice
 *
 * @param userId user id
 * @param code code from the app
 *
 * @returns {boolean} whether it was valid and unused
 */
export function checkTotp(userId: number, code: string): boolean {
  const row = db.prepare("SELECT totp_secret, totp_step FROM user WHERE id = ?").get(userId) as
    { totp_secret: string | null; totp_step: number } | undefined

  if (!row?.totp_secret) return false

  const step = verifyTotp(row.totp_secret, code, row.totp_step)
  if (step === null) return false

  // a code replayed at the same moment loses the race here
  const { changes } = db
    .prepare("UPDATE user SET totp_step = ? WHERE id = ? AND totp_step < ?")
    .run(step, userId, step)

  return changes > 0
}

/**
 * turn two-factor off
 *
 * @param userId user id
 *
 * @returns {boolean} whether it was on
 */
export function disableTotp(userId: number): boolean {
  const { changes } = db
    .prepare("UPDATE user SET totp_secret = NULL, totp_step = 0 WHERE id = ? AND totp_secret IS NOT NULL")
    .run(userId)

  return changes > 0
}

/**
 * make a secret for a session to add to its app, kept until confirmed with a code
 *
 * @param sessionId session setting it up
 * @param userId user id
 *
 * @returns {{ secret: string; uri: string }} base32 secret and the link to scan
 */
export function startEnrollment(sessionId: string, userId: number): { secret: string; uri: string } {
  const now = Date.now()
  prune(now)

  const secret = generateSecret()
  state.enrollments.set(sessionId, { userId, secret, expiresAt: now + ENROLLMENT_TTL })

  return { secret, uri: totpUri(secret, ADMIN_USERNAME) }
}

/**
 * turn two-factor on once a code proves the app has the secret
 *
 * @param sessionId session setting it up
 * @param userId user id
 * @param code code from the app
 *
 * @returns {"ok" | "expired" | "invalid" | "enabled"} outcome, enabled when two-factor was already on
 */
export function finishEnrollment(
  sessionId: string,
  userId: number,
  code: string
): "ok" | "expired" | "invalid" | "enabled" {
  const enrollment = state.enrollments.get(sessionId)

  if (!enrollment || enrollment.userId !== userId || Date.now() >= enrollment.expiresAt) {
    state.enrollments.delete(sessionId)
    return "expired"
  }

  const step = verifyTotp(enrollment.secret, code)
  if (step === null) return "invalid"

  // never replace a secret that is already on, overlapping setups lose here
  const { changes } = db
    .prepare("UPDATE user SET totp_secret = ?, totp_step = ? WHERE id = ? AND totp_secret IS NULL")
    .run(enrollment.secret, step, userId)
  state.enrollments.delete(sessionId)

  return changes > 0 ? "ok" : "enabled"
}

/**
 * hold a sign in until a code comes in, on this browser
 *
 * @param context request cookies and url
 * @param userId user signing in
 */
export function startChallenge({ cookies, url }: CookieContext, userId: number) {
  const now = Date.now()
  prune(now)

  const token = randomBytes(32).toString("base64url")
  state.challenges.set(toChallengeId(token), { userId, expiresAt: now + CHALLENGE_TTL, attempts: 0 })

  cookies.set(CHALLENGE_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: isSecure(url),
    maxAge: CHALLENGE_TTL / 1000,
  })
}

/**
 * the sign in this browser has waiting for a code
 *
 * @param context request cookies
 *
 * @returns {{ id: string; userId: number } | null} challenge, null when there is none or it expired
 */
export function readChallenge({
  cookies,
}: Pick<CookieContext, "cookies">): { id: string; userId: number } | null {
  const token = cookies.get(CHALLENGE_COOKIE)?.value
  if (!token) return null

  const id = toChallengeId(token)
  const challenge = state.challenges.get(id)

  if (!challenge) return null

  if (Date.now() >= challenge.expiresAt) {
    state.challenges.delete(id)
    return null
  }

  return { id, userId: challenge.userId }
}

/**
 * count a wrong code against a challenge, dropping it once out of attempts
 *
 * @param id challenge id
 *
 * @returns {boolean} whether it may still be tried
 */
export function failChallenge(id: string): boolean {
  const challenge = state.challenges.get(id)
  if (!challenge) return false

  if (++challenge.attempts >= CHALLENGE_ATTEMPTS) {
    state.challenges.delete(id)
    return false
  }

  return true
}

/**
 * drop a challenge and its cookie, once signed in or given up on
 *
 * @param context request cookies and url
 * @param id challenge id, when one was found
 */
export function endChallenge({ cookies, url }: CookieContext, id?: string) {
  if (id) state.challenges.delete(id)

  cookies.delete(CHALLENGE_COOKIE, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: isSecure(url),
  })
}
