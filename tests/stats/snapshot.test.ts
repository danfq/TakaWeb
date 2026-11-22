import { describe, expect, test } from "vitest"
import { days } from "@/lib/server/stats/days"
import { Sessions, latest, rankTotals, summarize, trueDuration } from "@/lib/server/stats/snapshot"
import { entry, history, random } from "../helpers/entries"

const MINUTE = 60_000
const T = Date.UTC(2026, 2, 10, 9)

describe("stats helpers", () => {
  test("merge overlapping spans before summing them", () => {
    expect(trueDuration([0, 10_000, 5000, 15_000, 20_000, 30_000])).toBe(25)
    expect(trueDuration([0, 10_000, 10_000, 20_000])).toBe(20)
    expect(trueDuration([])).toBe(0)
  })

  test("rank by time with stable ties and shares", () => {
    const items = rankTotals([
      ["b", 60],
      ["a", 60],
      ["c", 120],
      ["zero", 0],
    ])

    expect(items.map((item) => item.name)).toEqual(["c", "a", "b"])
    expect(items[0].share).toBe(0.5)
  })

  test("find the latest log, stopping early without changing the answer", () => {
    const list = history(random(4), T - 30 * 86_400_000, T, 2000)
    const longest = list.reduce((max, item) => Math.max(max, item.end - item.start), 0)

    expect(latest(list, longest)).toEqual(latest(list))
    expect(latest([])).toBeNull()
  })
})

describe("sessions", () => {
  /**
   * a log on a project, minutes after T
   *
   * @param project project
   * @param from start minute
   * @param to end minute
   *
   * @returns entry
   */
  const log = (project: string, from: number, to: number) =>
    entry(T + from * MINUTE, T + to * MINUTE, { project, language: "Go", editor: "zed", branch: "main" })

  test("split after a gap and keep projects worked on side by side apart", () => {
    const sessions = new Sessions()
    const end = T + 86_400_000

    // logs arrive in start order, a 10 minute gap continues a session and a 20 minute one ends it
    for (const item of [
      log("a", 0, 10),
      log("b", 5, 20),
      log("a", 20, 30),
      log("b", 21, 25),
      log("a", 50, 60),
    ]) {
      sessions.add(item, end)
    }

    expect(sessions.latest().map((session) => [session.project, session.seconds / 60])).toEqual([
      ["a", 10],
      ["b", 19],
      ["a", 20],
    ])
    expect(sessions.countFrom(T + 40 * MINUTE)).toBe(1)
    expect(sessions.longest(T)?.project).toBe("a")
  })

  test("clones only what later logs can change", () => {
    const sessions = new Sessions()
    const end = T + 86_400_000
    sessions.add(log("a", 0, 10), end)

    const copy = sessions.clone()
    copy.add(log("a", 12, 20), end)

    expect(sessions.latest()[0].seconds).toBe(600)
    expect(copy.latest()[0].seconds).toBe(1080)
  })
})

describe("summary", () => {
  test("keeps yesterday's streak alive while today is idle", () => {
    const table = days("UTC", Date.UTC(2026, 0, 1), Date.UTC(2026, 2, 10, 12))
    const daily = new Float64Array(table.keys.length)

    // three days in a row up to yesterday, and a longer run earlier
    for (const back of [1, 2, 3, 10, 11, 12, 13]) daily[table.today - back] = 3600
    daily[table.today - 12] = 7200

    const summary = summarize(daily, table)

    expect(summary.today).toBe(0)
    expect(summary.streak).toBe(3)
    expect(summary.bestStreak).toBe(4)
    expect(summary.activeDays).toBe(7)
    expect(summary.bestDay).toEqual({ date: table.keys[table.today - 12], seconds: 7200 })
    expect(summary.average).toBe(Math.round((8 * 3600) / 7))
  })
})
