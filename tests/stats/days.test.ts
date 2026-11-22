import { describe, expect, test } from "vitest"
import { dayIndex, days, isTimeZone, keyIndex, monthStart, offsetIn, weekday } from "@/lib/server/stats/days"

const HOUR = 3_600_000

describe("day table", () => {
  test("knows real timezones", () => {
    expect(isTimeZone("Europe/Lisbon")).toBe(true)
    expect(isTimeZone("Mars/Olympus")).toBe(false)
  })

  test("has 23 and 25 hour days around dst switches", () => {
    const table = days("America/New_York", Date.UTC(2025, 0, 1), Date.UTC(2025, 11, 31, 12))
    const length = (key: string) => {
      const index = keyIndex(table, key)
      return (table.starts[index + 1] - table.starts[index]) / HOUR
    }

    expect(length("2025-03-09")).toBe(23)
    expect(length("2025-11-02")).toBe(25)
    expect(length("2025-06-15")).toBe(24)
  })

  test("starts days at local midnight", () => {
    const table = days("Asia/Kathmandu", Date.UTC(2025, 0, 1), Date.UTC(2025, 5, 1, 12))
    const index = keyIndex(table, "2025-05-01")

    // nepal is 5:45 ahead of utc
    expect(table.starts[index]).toBe(Date.UTC(2025, 3, 30, 18, 15))
    expect(offsetIn(table, index, table.starts[index])).toBe(5.75 * HOUR)
  })

  test("finds the day an instant falls in", () => {
    const table = days("Europe/Lisbon", Date.UTC(2025, 0, 1), Date.UTC(2025, 5, 1, 12))
    const index = keyIndex(table, "2025-04-10")

    expect(dayIndex(table, table.starts[index])).toBe(index)
    expect(dayIndex(table, table.starts[index + 1] - 1)).toBe(index)
    expect(dayIndex(table, table.starts[0] - 1)).toBe(-1)
    expect(table.keys[table.today]).toBe("2025-06-01")
  })

  test("covers at least two years back, for the year comparison", () => {
    const table = days("UTC", Date.UTC(2025, 5, 1), Date.UTC(2025, 5, 1, 12))

    expect(table.today).toBeGreaterThanOrEqual(2 * 366)
  })

  test("counts months and weekdays", () => {
    expect(monthStart("2025-03-31")).toBe("2025-03-01")
    expect(monthStart("2025-03-31", 3)).toBe("2024-12-01")
    expect(monthStart("2025-03-31", -1)).toBe("2025-04-01")
    expect(weekday("2025-06-01")).toBe(0)
  })
})
