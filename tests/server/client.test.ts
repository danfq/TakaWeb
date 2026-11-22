import { describe, expect, test } from "vitest"
import { clientIp, userAgent } from "@/lib/server/client"

/**
 * a request context with a socket address and forwarded header
 *
 * @param forwarded x-forwarded-for value
 * @param socket socket address
 *
 * @returns request context
 */
const context = (forwarded: string | null, socket = "10.0.0.2") => ({
  request: new Request("http://takaweb.test/", {
    headers: forwarded === null ? {} : { "x-forwarded-for": forwarded },
  }),
  clientAddress: socket,
})

describe("client address", () => {
  test("uses the socket without trusted proxies, whatever the header claims", () => {
    expect(clientIp(context("1.2.3.4"), 0)).toBe("10.0.0.2")
  })

  test("reads the entry the trusted proxy appended", () => {
    expect(clientIp(context("203.0.113.7"), 1)).toBe("203.0.113.7")
    // a client sending its own header cannot pick its address
    expect(clientIp(context("6.6.6.6, 203.0.113.7"), 1)).toBe("203.0.113.7")
    // two proxies, a cdn and nginx
    expect(clientIp(context("6.6.6.6, 203.0.113.7, 198.51.100.1"), 2)).toBe("203.0.113.7")
  })

  test("falls back to the socket when the header is missing or malformed", () => {
    expect(clientIp(context(null), 1)).toBe("10.0.0.2")
    expect(clientIp(context("not-an-ip"), 1)).toBe("10.0.0.2")
    expect(clientIp(context("203.0.113.7"), 2)).toBe("10.0.0.2")
  })

  test("drops the ipv4-mapped ipv6 prefix", () => {
    expect(clientIp(context(null, "::ffff:192.0.2.1"), 0)).toBe("192.0.2.1")
    expect(clientIp(context("::ffff:192.0.2.9"), 1)).toBe("192.0.2.9")
    expect(clientIp(context("2001:db8::1"), 1)).toBe("2001:db8::1")
  })

  test("caps the user agent", () => {
    const request = new Request("http://takaweb.test/", { headers: { "user-agent": "x".repeat(2000) } })

    expect(userAgent({ request })).toHaveLength(512)
    expect(userAgent({ request: new Request("http://takaweb.test/") })).toBe("")
  })
})
