import { beforeEach, describe, expect, test, vi } from "vitest"
import {
  ADMIN_USERNAME,
  bootstrap,
  createAdmin,
  getAdmin,
  hasAdmin,
  setPasswordHash,
  verifySetupToken,
} from "@/lib/server/auth/admin"
import {
  createSession,
  invalidateSession,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  validateSession,
} from "@/lib/server/auth/session"
import { db } from "@/lib/server/db"

const DAY = 86_400_000
const ORIGIN = { ip: "192.0.2.1", userAgent: "Firefox" }

describe("admin account", () => {
  test("issues a setup token once, until the admin exists", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})

    bootstrap()
    bootstrap()

    expect(log).toHaveBeenCalledTimes(1)
    const token = String(log.mock.calls[0][0]).match(/([0-9a-f]{4}-){7}[0-9a-f]{4}/)![0]

    expect(verifySetupToken("wrong")).toBe(false)
    // pasted tokens may lose their dashes or change case
    expect(verifySetupToken(token.replaceAll("-", "").toUpperCase())).toBe(true)
    expect(hasAdmin()).toBe(false)

    const id = createAdmin("hash-1")
    expect(id).toBeTypeOf("number")
    expect(hasAdmin()).toBe(true)
    // the token is spent once the admin exists
    expect(verifySetupToken(token)).toBe(false)
    // a second setup never replaces the admin
    expect(createAdmin("hash-2")).toBeNull()
    expect(getAdmin()).toEqual({ id, passwordHash: "hash-1" })

    expect(setPasswordHash(id!, "hash-3")).toBe(true)
    expect(getAdmin()?.passwordHash).toBe("hash-3")
    expect(setPasswordHash(9999, "x")).toBe(false)
  })
})

describe("sessions", () => {
  let userId: number

  beforeEach(() => {
    db.exec("DELETE FROM session")
    userId = (getAdmin() ?? { id: createAdmin("hash")! }).id
  })

  test("resolve a token to its user and session, storing only a hash", () => {
    const { token, expiresAt } = createSession(userId, ORIGIN)
    const result = validateSession(token)

    expect(result?.user).toEqual({ id: userId, username: ADMIN_USERNAME })
    expect(result?.session.expiresAt).toBe(expiresAt)
    expect(result?.renewed).toBe(false)

    const stored = db.prepare("SELECT id FROM session").all() as { id: string }[]
    expect(stored.map((row) => row.id)).not.toContain(token)
    expect(validateSession("not-a-token")).toBeNull()
  })

  test("renew once less than half their lifetime is left, and expire after", () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 0, 1) })

    try {
      const { token } = createSession(userId, ORIGIN)

      vi.setSystemTime(Date.UTC(2026, 0, 1) + 20 * DAY)
      const renewed = validateSession(token)
      expect(renewed?.renewed).toBe(true)
      expect(renewed?.session.expiresAt).toBe(Date.UTC(2026, 0, 1) + 50 * DAY)

      vi.setSystemTime(Date.UTC(2026, 0, 1) + 51 * DAY)
      expect(validateSession(token)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test("are listed newest first with where they signed in from", () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 0, 1) })

    try {
      const first = validateSession(createSession(userId, ORIGIN).token)!
      vi.setSystemTime(Date.UTC(2026, 0, 2))
      const second = validateSession(
        createSession(userId, { ip: "198.51.100.4", userAgent: "Safari" }).token
      )!

      expect(listSessions(userId, first.session.id)).toEqual([
        {
          id: second.session.id,
          ip: "198.51.100.4",
          userAgent: "Safari",
          createdAt: Date.UTC(2026, 0, 2),
          current: false,
        },
        {
          id: first.session.id,
          ip: "192.0.2.1",
          userAgent: "Firefox",
          createdAt: Date.UTC(2026, 0, 1),
          current: true,
        },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  test("can be revoked, except the one asking", () => {
    const current = validateSession(createSession(userId, ORIGIN).token)!.session.id
    const other = validateSession(createSession(userId, ORIGIN).token)!.session.id

    expect(revokeSession(userId, current, current)).toBe(false)
    expect(revokeSession(userId + 1, other, current)).toBe(false)
    expect(revokeSession(userId, other, current)).toBe(true)
    expect(listSessions(userId, current).map((session) => session.id)).toEqual([current])

    invalidateSession(current)
    expect(listSessions(userId, current)).toEqual([])
  })

  test("other sessions can all be signed out at once, or every one", () => {
    const keep = validateSession(createSession(userId, ORIGIN).token)!.session.id
    createSession(userId, ORIGIN)
    createSession(userId, ORIGIN)

    expect(revokeOtherSessions(userId, keep)).toBe(2)
    expect(listSessions(userId, keep)).toHaveLength(1)
    expect(revokeOtherSessions(userId, null)).toBe(1)
  })
})
