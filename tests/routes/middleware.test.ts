import { describe, expect, test, vi } from "vitest"

const closing = vi.hoisted(() => ({ value: false }))

vi.mock("@/lib/server/shutdown", async (original) => ({
  ...(await original<typeof import("@/lib/server/shutdown")>()),
  isClosing: () => closing.value,
}))

const { onRequest } = await import("@/middleware")
const { createAdmin } = await import("@/lib/server/auth/admin")
const { SESSION_COOKIE, createSession } = await import("@/lib/server/auth/session")
const { context } = await import("../helpers/context")

vi.spyOn(console, "log").mockImplementation(() => {})

/**
 * run the middleware, the route answering 200 when reached
 *
 * @param path request path
 * @param cookies cookies
 *
 * @returns {Promise<Response>} response
 */
const visit = async (path: string, cookies: Record<string, string> = {}) =>
  (await onRequest(context(path, { cookies }) as never, async () => new Response("route"))) as Response

describe("middleware", () => {
  test("sends everyone to setup until the admin exists", async () => {
    expect((await visit("/")).headers.get("Location")).toBe("/setup")
    expect((await visit("/login")).headers.get("Location")).toBe("/setup")
    expect((await visit("/setup")).status).toBe(200)
  })

  test("keeps the health route and actions open, and the api closed", async () => {
    expect((await visit("/api/health")).status).toBe(200)
    expect((await visit("/_actions/auth.login")).status).toBe(200)
    expect((await visit("/api/stream")).status).toBe(401)
  })

  test("asks for a sign in, then lets the admin through", async () => {
    const userId = createAdmin("hash")!
    const { token } = createSession(userId, { ip: "", userAgent: "" })

    expect((await visit("/")).headers.get("Location")).toBe("/login")
    expect((await visit("/setup")).headers.get("Location")).toBe("/login")
    expect((await visit("/login")).status).toBe(200)

    const signedIn = { [SESSION_COOKIE]: token }
    expect((await visit("/", signedIn)).status).toBe(200)
    expect((await visit("/api/stream", signedIn)).status).toBe(200)
    expect((await visit("/login", signedIn)).headers.get("Location")).toBe("/")

    // a stale cookie is treated as signed out
    expect((await visit("/", { [SESSION_COOKIE]: "stale" })).headers.get("Location")).toBe("/login")
  })

  test("adds security headers to every response", async () => {
    const response = await visit("/api/health")

    expect(response.headers.get("X-Frame-Options")).toBe("DENY")
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin")
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'")
    // not served over https in tests
    expect(response.headers.get("Strict-Transport-Security")).toBeNull()
  })

  test("turns requests away while shutting down", async () => {
    closing.value = true

    try {
      const response = await visit("/")
      expect(response.status).toBe(503)
      expect(response.headers.get("Retry-After")).toBe("5")
    } finally {
      closing.value = false
    }
  })
})
