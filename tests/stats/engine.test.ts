import { describe, expect, test } from "vitest"
import { ViewCache, type Source } from "@/lib/server/stats/engine"
import type { Entry } from "@/lib/server/stats/store"
import type { Item, Snapshot, View } from "@/lib/stats/types"
import { entry, history, merge, random } from "../helpers/entries"
import { referenceSnapshot } from "./reference"

const HOUR = 3_600_000
const DAY = 24 * HOUR

// a tuesday afternoon in march, close to the us and eu dst switches
const NOW = Date.UTC(2026, 2, 10, 15, 30)

const ZONES = ["UTC", "America/New_York", "Europe/Lisbon", "Australia/Lord_Howe", "Asia/Kathmandu"]

/**
 * a source with no structural changes beyond the first
 *
 * @param all entries ordered by start
 * @param appended entries added since
 * @param structure structure version
 *
 * @returns {Source} source
 */
const source = (all: readonly Entry[], appended: readonly Entry[] = [], structure = 1): Source => ({
  all,
  appended,
  structure,
  imports: 0,
  maxDuration: all.reduce((max, entry) => Math.max(max, entry.end - entry.start), 0),
})

/**
 * compare ranked items, rounding can move a second either way when time is summed per day
 *
 * @param actual engine items
 * @param expected reference items
 */
function expectItems(actual: Item[], expected: Item[]) {
  expect(actual.map((item) => item.name).sort()).toEqual(expected.map((item) => item.name).sort())

  const byName = new Map(expected.map((item) => [item.name, item]))

  for (const item of actual) {
    const other = byName.get(item.name)!
    expect(Math.abs(item.seconds - other.seconds)).toBeLessThanOrEqual(1)
    expect(Math.abs(item.share - other.share)).toBeLessThanOrEqual(0.001)
  }
}

/**
 * compare numbers summed in a different order
 *
 * @param actual engine numbers
 * @param expected reference numbers
 */
const expectClose = (actual: number[], expected: number[]) => {
  expect(actual.length).toBe(expected.length)
  actual.forEach((value, index) => expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(1))
}

/**
 * compare an engine snapshot with the reference
 *
 * @param actual engine snapshot
 * @param expected reference snapshot
 */
function expectSnapshot(actual: Omit<Snapshot, "imports">, expected: Omit<Snapshot, "imports">) {
  // per day sums happen in the same order, so these match exactly
  expect(actual.summary).toEqual(expected.summary)
  expect(actual.calendar).toEqual(expected.calendar)
  expect(actual.latest).toEqual(expected.latest)
  expect(actual.empty).toBe(expected.empty)
  expect(actual.sessions).toEqual(expected.sessions)

  for (const range of Object.keys(expected.ranges) as (keyof Snapshot["ranges"])[]) {
    const a = actual.ranges[range]
    const b = expected.ranges[range]

    expect(a.start).toBe(b.start)
    expect(a.activity).toEqual(b.activity)
    expect(a.sessionCount).toBe(b.sessionCount)
    expectClose(a.hours, b.hours)
    expectItems(a.files, b.files)

    for (const dimension of Object.keys(b.breakdown) as (keyof typeof b.breakdown)[]) {
      expectItems(a.breakdown[dimension], b.breakdown[dimension])
    }
  }
}

describe("view cache", () => {
  test.each(ZONES)("matches the direct computation in %s", (tz) => {
    for (let seed = 1; seed <= 6; seed++) {
      const next = random(seed)
      const all = history(next, NOW - 420 * DAY, NOW + HOUR, 1500)
      const views: View[] = [
        { tz, filter: null },
        { tz, filter: { dimension: "project", value: "takaweb" } },
        { tz, filter: { dimension: "language", value: "Go" } },
      ]

      for (const view of views) {
        const actual = new ViewCache(view).snapshot(source(all), NOW)
        expectSnapshot(actual, referenceSnapshot(view, all, NOW))
      }
    }
  })

  test.each(ZONES)("keeps matching as logs arrive in %s", (tz) => {
    const next = random(42)
    let all = history(next, NOW - 60 * DAY, NOW - 2 * HOUR, 600)
    let appended: Entry[] = []

    const cache = new ViewCache({ tz, filter: null })
    cache.snapshot(source(all), NOW - 2 * HOUR)

    for (let step = 0; step < 25; step++) {
      const now = NOW - 2 * HOUR + step * 5 * 60_000

      // recent logs, some out of order, the odd one far in the past
      const added = Array.from({ length: 1 + Math.floor(next() * 4) }, () => {
        const start = next() < 0.1 ? now - next() * 30 * DAY : now - next() * 20 * 60_000
        return entry(start, start + 1000 + next() * 10 * 60_000, {}, next)
      })

      all = merge(all, added)
      appended = [...appended, ...added]

      const view: View = { tz, filter: null }
      expectSnapshot(cache.snapshot(source(all, appended), now), referenceSnapshot(view, all, now))
    }
  })

  test("rolls over to a new day", () => {
    const next = random(7)
    const all = history(next, NOW - 30 * DAY, NOW, 400)
    // a log dated ahead, it only counts once its day arrives
    const ahead = entry(NOW + 6 * HOUR + 12 * HOUR, NOW + 6 * HOUR + 13 * HOUR, {}, next)
    const list = merge(all, [ahead])
    const view: View = { tz: "UTC", filter: null }

    const cache = new ViewCache(view)
    cache.snapshot(source(all), NOW)

    const later = NOW + DAY
    expectSnapshot(cache.snapshot(source(list, [ahead]), later), referenceSnapshot(view, list, later))
  })

  test("rebuilds after a structural change", () => {
    const next = random(9)
    const all = history(next, NOW - 30 * DAY, NOW, 400)
    const view: View = { tz: "Europe/Lisbon", filter: null }

    const cache = new ViewCache(view)
    cache.snapshot(source(all), NOW)

    // a deletion, the store bumps its structure
    const fewer = all.filter((_, index) => index % 3)
    expectSnapshot(cache.snapshot(source(fewer, [], 2), NOW), referenceSnapshot(view, fewer, NOW))
  })

  test("handles an empty history", () => {
    const view: View = { tz: "UTC", filter: null }

    expectSnapshot(new ViewCache(view).snapshot(source([]), NOW), referenceSnapshot(view, [], NOW))
  })
})
