import { describe, expect, test } from "vitest"
import {
  fromBase32,
  generateSecret,
  timeStep,
  toBase32,
  totpCode,
  totpUri,
  verifyTotp,
} from "@/lib/server/auth/totp"

// the rfc 6238 sha1 test key, 12345678901234567890 in ascii
const SECRET = toBase32(Buffer.from("12345678901234567890"))

describe("totp", () => {
  test("base32 round trips and ignores case, spaces and padding", () => {
    const bytes = Buffer.from("any bytes at all!")

    expect(fromBase32(toBase32(bytes))).toEqual(bytes)
    expect(SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
    expect(fromBase32("gezd gnbv gy3t qojq gezd gnbv gy3t qojq==")).toEqual(
      Buffer.from("12345678901234567890")
    )
    expect(fromBase32("not base32!")).toBeNull()
  })

  test("matches the rfc 6238 vectors, cut to six digits", () => {
    expect(totpCode(SECRET, timeStep(59_000))).toBe("287082")
    expect(totpCode(SECRET, timeStep(1_111_111_109_000))).toBe("081804")
    expect(totpCode(SECRET, timeStep(1_234_567_890_000))).toBe("005924")
    expect(totpCode(SECRET, timeStep(2_000_000_000_000))).toBe("279037")
  })

  test("accepts codes one step either side of now", () => {
    const now = 1_234_567_890_000
    const step = timeStep(now)

    expect(verifyTotp(SECRET, totpCode(SECRET, step), 0, now)).toBe(step)
    expect(verifyTotp(SECRET, totpCode(SECRET, step - 1), 0, now)).toBe(step - 1)
    expect(verifyTotp(SECRET, totpCode(SECRET, step + 1), 0, now)).toBe(step + 1)
    expect(verifyTotp(SECRET, totpCode(SECRET, step - 2), 0, now)).toBeNull()
    expect(verifyTotp(SECRET, totpCode(SECRET, step + 2), 0, now)).toBeNull()
  })

  test("never accepts a step already used, or anything but digits", () => {
    const now = 1_234_567_890_000
    const step = timeStep(now)
    const code = totpCode(SECRET, step)

    expect(verifyTotp(SECRET, code, step, now)).toBeNull()
    expect(verifyTotp(SECRET, totpCode(SECRET, step - 1), step - 1, now)).toBeNull()
    expect(verifyTotp(SECRET, `${code}0`, 0, now)).toBeNull()
    expect(verifyTotp(SECRET, "12345a", 0, now)).toBeNull()
    expect(verifyTotp(SECRET, "", 0, now)).toBeNull()
  })

  test("makes fresh 160-bit secrets and links apps can scan", () => {
    const secret = generateSecret()

    expect(fromBase32(secret)).toHaveLength(20)
    expect(generateSecret()).not.toBe(secret)

    const uri = new URL(totpUri(secret, "admin"))
    expect(uri.protocol).toBe("otpauth:")
    expect(uri.host).toBe("totp")
    expect(uri.pathname).toBe("/TakaWeb:admin")
    expect(Object.fromEntries(uri.searchParams)).toEqual({
      secret,
      issuer: "TakaWeb",
      algorithm: "SHA1",
      digits: "6",
      period: "30",
    })
  })
})
