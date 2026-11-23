import { describe, expect, test } from "vitest"
import { openFilter, sealFilter } from "@/lib/server/seal"

describe("sealed filters", () => {
  test("round trip without the name showing", () => {
    const filter = { dimension: "project" as const, value: "Secret Project" }
    const token = sealFilter(filter)

    expect(token).toMatch(/^[\w-]+$/)
    expect(token).not.toContain("Secret")
    expect(Buffer.from(token, "base64url").toString("latin1")).not.toContain("Secret")
    expect(openFilter(token)).toEqual(filter)
  })

  test("differ every time, so equal filters cannot be told apart", () => {
    const filter = { dimension: "language" as const, value: "TypeScript" }

    expect(sealFilter(filter)).not.toBe(sealFilter(filter))
  })

  test("refuse anything tampered with or made up", () => {
    const token = sealFilter({ dimension: "editor", value: "vim" })
    const raw = Buffer.from(token, "base64url")
    raw[raw.length - 1] ^= 1

    expect(openFilter(raw.toString("base64url"))).toBeNull()
    expect(openFilter("")).toBeNull()
    expect(openFilter("project")).toBeNull()
    expect(openFilter("A".repeat(10_000))).toBeNull()
  })
})
