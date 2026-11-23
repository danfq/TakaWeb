import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createAdmin, getAdmin } from "@/lib/server/auth/admin"
import { timeStep, totpCode } from "@/lib/server/auth/totp"
import {
  CHALLENGE_COOKIE,
  checkTotp,
  disableTotp,
  endChallenge,
  failChallenge,
  finishEnrollment,
  hasTotp,
  readChallenge,
  startChallenge,
  startEnrollment,
} from "@/lib/server/auth/two-factor"
import type { CookieContext } from "@/lib/server/auth/session"
import { db } from "@/lib/server/db"
import { context } from "../helpers/context"

const NOW = Date.UTC(2026, 0, 1)

let userId: number

/**
 * a browser's request, with the cookies it sends and gets back
 *
 * @param cookies cookies it sends
 *
 * @returns request context and its cookie jar
 */
function browser(cookies: Record<string, string> = {}) {
  const request = context("/", { cookies })

  return Object.assign(request as unknown as CookieContext, { jar: request.cookies.jar })
}

/**
 * the code an app would show for a secret right now
 *
 * @param secret base32 secret
 * @param offset steps from now
 *
 * @returns {string} code
 */
const codeFor = (secret: string, offset = 0): string => totpCode(secret, timeStep() + offset)

/**
 * turn two-factor on for the admin
 *
 * @returns {string} secret
 */
function enable(): string {
  const { secret } = startEnrollment("session", userId)
  expect(finishEnrollment("session", userId, codeFor(secret))).toBe("ok")

  return secret
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  userId = (getAdmin() ?? { id: createAdmin("hash")! }).id
  disableTotp(userId)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("enrollment", () => {
  test("turns on once a code proves the app has the secret", () => {
    const { secret, uri } = startEnrollment("session", userId)

    expect(uri).toContain(`secret=${secret}`)
    expect(hasTotp(userId)).toBe(false)

    expect(finishEnrollment("session", userId, codeFor(secret, 5))).toBe("invalid")
    expect(finishEnrollment("session", userId, codeFor(secret))).toBe("ok")
    expect(hasTotp(userId)).toBe(true)

    // the code that turned it on cannot also sign in
    expect(checkTotp(userId, codeFor(secret))).toBe(false)
  })

  test("belongs to the session that started it, and expires", () => {
    const { secret } = startEnrollment("session", userId)

    expect(finishEnrollment("other", userId, codeFor(secret))).toBe("expired")

    vi.setSystemTime(NOW + 11 * 60_000)
    expect(finishEnrollment("session", userId, codeFor(secret))).toBe("expired")
    expect(hasTotp(userId)).toBe(false)
  })
})

describe("codes", () => {
  test("work once each, within a step of now", () => {
    const secret = enable()

    vi.setSystemTime(NOW + 60_000)
    expect(checkTotp(userId, codeFor(secret))).toBe(true)
    expect(checkTotp(userId, codeFor(secret))).toBe(false)

    // an earlier step is spent too once a later one was used
    expect(checkTotp(userId, codeFor(secret, -1))).toBe(false)
    expect(checkTotp(userId, codeFor(secret, 1))).toBe(true)
    expect(checkTotp(userId, codeFor(secret, 3))).toBe(false)
  })

  test("never pass once two-factor is off", () => {
    const secret = enable()

    expect(disableTotp(userId)).toBe(true)
    expect(disableTotp(userId)).toBe(false)
    expect(hasTotp(userId)).toBe(false)

    vi.setSystemTime(NOW + 60_000)
    expect(checkTotp(userId, codeFor(secret))).toBe(false)
    expect(db.prepare("SELECT totp_secret FROM user WHERE id = ?").get(userId)).toEqual({ totp_secret: null })
  })
})

describe("challenges", () => {
  test("hold a sign in on the browser that passed the password", () => {
    const request = browser()

    expect(readChallenge(request)).toBeNull()

    startChallenge(request, userId)
    const token = request.jar.get(CHALLENGE_COOKIE)!

    expect(readChallenge(request)).toEqual({ id: expect.any(String), userId })
    // only a hash of the token is kept
    expect(readChallenge(request)!.id).not.toBe(token)
    expect(readChallenge(browser({ [CHALLENGE_COOKIE]: "forged" }))).toBeNull()

    endChallenge(request, readChallenge(request)!.id)
    expect(request.jar.has(CHALLENGE_COOKIE)).toBe(false)
    expect(readChallenge(browser({ [CHALLENGE_COOKIE]: token }))).toBeNull()
  })

  test("expire, and give out after five wrong codes", () => {
    const request = browser()
    startChallenge(request, userId)
    const { id } = readChallenge(request)!

    for (let attempt = 1; attempt < 5; attempt++) expect(failChallenge(id)).toBe(true)
    expect(failChallenge(id)).toBe(false)
    expect(readChallenge(request)).toBeNull()

    startChallenge(request, userId)
    vi.setSystemTime(NOW + 5 * 60_000)
    expect(readChallenge(request)).toBeNull()
  })
})
