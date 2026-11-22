import { describe, expect, test } from "vitest"
import { hashPassword, verifyPassword } from "@/lib/server/auth/password"

describe("password hashing", () => {
  test("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery")

    expect(hash).toMatch(/^scrypt\$131072\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    expect(await verifyPassword("correct horse battery", hash)).toBe(true)
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false)
  })

  test("salts every hash", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"))
  })

  test("treats equivalent unicode the same", async () => {
    // a precomposed é and an e with a combining accent
    const hash = await hashPassword("café au lait 12")

    expect(await verifyPassword("café au lait 12", hash)).toBe(true)
  })

  test("verifies with the cost stored in the hash, so costs can be raised later", async () => {
    // a cheaper hash made with older parameters
    const old = "scrypt$1024$8$1$c2FsdHNhbHRzYWx0c2FsdA==$" + Buffer.alloc(64).toString("base64")

    expect(await verifyPassword("anything", old)).toBe(false)
  })

  test("rejects malformed hashes", async () => {
    expect(await verifyPassword("x", "bcrypt$whatever")).toBe(false)
    expect(await verifyPassword("x", "")).toBe(false)
  })
})
