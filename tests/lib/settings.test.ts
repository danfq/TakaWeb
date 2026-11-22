import { describe, expect, test } from "vitest"
import {
  DEFAULT_SETTINGS,
  fixedRange,
  hour12,
  parseSettings,
  pickSettings,
  sameSettings,
} from "@/lib/settings"

describe("settings", () => {
  test("keep only known keys with valid values", () => {
    expect(
      pickSettings({ timeFormat: "24h", durations: "weird", hideNames: "yes", tabTitle: true, extra: 1 })
    ).toEqual({
      timeFormat: "24h",
      tabTitle: true,
    })
    expect(pickSettings(null)).toEqual({})
    expect(pickSettings("nope")).toEqual({})
  })

  test("fill in defaults", () => {
    expect(parseSettings({ defaultRange: "month" })).toEqual({ ...DEFAULT_SETTINGS, defaultRange: "month" })
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })

  test("compare by value", () => {
    expect(sameSettings(parseSettings({}), DEFAULT_SETTINGS)).toBe(true)
    expect(sameSettings(parseSettings({ hideNames: true }), DEFAULT_SETTINGS)).toBe(false)
  })

  test("map to formatting options", () => {
    expect(hour12("auto")).toBeUndefined()
    expect(hour12("12h")).toBe(true)
    expect(hour12("24h")).toBe(false)
    expect(fixedRange(DEFAULT_SETTINGS)).toBeNull()
    expect(fixedRange({ ...DEFAULT_SETTINGS, defaultRange: "year" })).toBe("year")
  })
})
