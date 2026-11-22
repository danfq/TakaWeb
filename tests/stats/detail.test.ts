import { describe, expect, test } from "vitest"
import { detail } from "@/lib/server/stats/snapshot"
import type { PeriodRange, View } from "@/lib/stats/types"
import { history, random } from "../helpers/entries"
import { referenceDetail } from "./reference"

const DAY = 86_400_000
const NOW = Date.UTC(2026, 2, 10, 15, 30)

const PERIODS: PeriodRange[] = [
  // a single day, a week, a whole month, one across the dst switch, one in the future
  { from: "2026-03-09", to: "2026-03-09" },
  { from: "2026-03-02", to: "2026-03-08" },
  { from: "2026-02-01", to: "2026-02-28" },
  { from: "2025-10-20", to: "2025-11-05" },
  { from: "2026-03-11", to: "2026-03-12" },
]

describe("period detail", () => {
  test.each(["UTC", "America/New_York", "Asia/Kathmandu"])("only reads the logs it needs in %s", (tz) => {
    const next = random(3)
    const all = history(next, NOW - 200 * DAY, NOW, 3000)
    const maxDuration = all.reduce((max, entry) => Math.max(max, entry.end - entry.start), 0)

    for (const filter of [null, { dimension: "project", value: "site" }] as View["filter"][]) {
      for (const period of PERIODS) {
        const view: View = { tz, filter }

        expect(detail(view, all, NOW, period, maxDuration)).toEqual(referenceDetail(view, all, NOW, period))
      }
    }
  })

  test("compares a whole month with the month before", () => {
    const all = history(random(5), NOW - 90 * DAY, NOW, 500)
    const result = detail({ tz: "UTC", filter: null }, all, NOW, { from: "2026-02-01", to: "2026-02-28" })

    expect(result.days).toBe(28)
    expect(result.unit).toBe("day")
    expect(result.buckets).toHaveLength(28)
    expect(result.previous).toBeGreaterThan(0)
  })

  test("splits a single day by hour", () => {
    const all = history(random(6), NOW - 10 * DAY, NOW, 500)
    const result = detail({ tz: "UTC", filter: null }, all, NOW, { from: "2026-03-09", to: "2026-03-09" })

    expect(result.unit).toBe("hour")
    expect(result.buckets.map((bucket) => bucket.key)).toEqual(
      Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"))
    )
    expect(result.buckets.reduce((sum, bucket) => sum + bucket.seconds, 0)).toBeCloseTo(result.total, -1)
  })
})
