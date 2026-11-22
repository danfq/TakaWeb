import { days, weekday } from "@/lib/server/stats/days"
import {
  activity,
  detail,
  distribute,
  groups,
  latest,
  summarize,
  window,
} from "@/lib/server/stats/snapshot"
import type { Entry } from "@/lib/server/stats/store"
import { RANGES, type Detail, type PeriodRange, type Period, type Range, type Snapshot, type View } from "@/lib/stats/types"

/**
 * the dashboard snapshot computed directly from every log, the way takaweb did before caching
 * the cached engine has to produce the same thing
 *
 * @param view view
 * @param all every entry, ordered by start
 * @param now current instant
 *
 * @returns {Omit<Snapshot, "imports">} snapshot
 */
export function referenceSnapshot(view: View, all: readonly Entry[], now: number): Omit<Snapshot, "imports"> {
  const { filter } = view
  const list = filter ? all.filter((entry) => entry[filter.dimension] === filter.value) : all

  const table = days(view.tz, all[0]?.start ?? now, now)

  const drafts = RANGES.map((range) => window(table, range, 0))
  const { daily, hours, focused } = distribute(
    list,
    table,
    drafts.map((draft) => [draft.from, table.today]),
    table.today
  )

  const firstActive = daily.findIndex((seconds) => seconds > 0)
  const windows = RANGES.map((range) => window(table, range, firstActive === -1 ? table.today : firstActive))

  const end = table.starts[table.today + 1]
  const froms = windows.map((window) => table.starts[Math.max(window.from, 0)])
  const { rankings, sessions } = groups(list, froms, end)

  const yearAgo = table.today - 364
  const calendarStart = yearAgo - weekday(table.keys[yearAgo])

  const ranges = Object.fromEntries(
    windows.map((window, index) => [
      window.range,
      {
        start: froms[index],
        activity: activity(window, daily, focused, table, now),
        hours: hours[index].map(Math.round),
        ...rankings[index],
      },
    ])
  ) as Record<Range, Period>

  return {
    view,
    empty: all.length === 0,
    latest: latest(all),
    summary: summarize(daily, table),
    calendar: {
      start: table.keys[calendarStart],
      days: Array.from(daily.subarray(calendarStart, table.today + 1), Math.round),
    },
    sessions,
    ranges,
  }
}

/**
 * period details computed from every log, without narrowing to the logs that matter
 *
 * @param view view
 * @param all every entry, ordered by start
 * @param now current instant
 * @param period period
 *
 * @returns {Detail} detail
 */
export const referenceDetail = (view: View, all: readonly Entry[], now: number, period: PeriodRange): Detail =>
  detail(view, all, now, period, Infinity)
