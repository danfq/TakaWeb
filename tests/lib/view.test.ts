import { describe, expect, test } from "vitest"
import { SEALED_PARAM, hasPlainFilter, readFilter, sameFilter, writeFilter } from "@/lib/stats/view"

describe("filters in the url", () => {
  test("are written plain, replacing any other", () => {
    const params = new URLSearchParams(`language=Go&${SEALED_PARAM}=old&tz=UTC`)
    writeFilter(params, { dimension: "project", value: "TakaWeb" })

    expect(params.toString()).toBe("tz=UTC&project=TakaWeb")
    expect(readFilter(params)).toEqual({ dimension: "project", value: "TakaWeb" })
    expect(hasPlainFilter(params)).toBe(true)
  })

  test("are written sealed while names are hidden, with no name left", () => {
    const params = new URLSearchParams("project=TakaWeb")
    writeFilter(params, { dimension: "project", value: "TakaWeb" }, "token")

    expect(params.toString()).toBe(`${SEALED_PARAM}=token`)
    expect(hasPlainFilter(params)).toBe(false)
    expect(readFilter(params)).toBeNull()
  })

  test("are cleared along with any sealed one", () => {
    const params = new URLSearchParams(`os=linux&${SEALED_PARAM}=token`)
    writeFilter(params, null, "ignored")

    expect(params.toString()).toBe("")
  })

  test("compare by what they narrow down to", () => {
    expect(sameFilter(null, null)).toBe(true)
    expect(sameFilter({ dimension: "os", value: "linux" }, { dimension: "os", value: "linux" })).toBe(true)
    expect(sameFilter({ dimension: "os", value: "linux" }, { dimension: "editor", value: "linux" })).toBe(
      false
    )
    expect(sameFilter({ dimension: "os", value: "linux" }, null)).toBe(false)
  })
})
