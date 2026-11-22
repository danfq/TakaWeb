import {
  type Bucket,
  type Detail,
  type Dimension,
  type Item,
  type Latest,
  type Period,
  type PeriodRange,
  type Range,
  type Session,
  type Summary,
  type View,
} from "@/lib/stats/types"
import { dayIndex, days, keyIndex, monthStart, nextShift, offsetIn, type Days } from "./days"
import type { Entry } from "./store"

export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR

/**
 * the calendar day after a day key
 *
 * @param key YYYY-MM-DD
 *
 * @returns {string} next YYYY-MM-DD
 */
const nextDay = (key: string): string => new Date(Date.parse(key) + DAY).toISOString().slice(0, 10)

/**
 * a gap longer than this splits a session, matches takatime's idle cutoff in spirit
 */
export const SESSION_GAP = 15 * 60 * 1000

export const LIST_LIMIT = 100
export const FILE_LIMIT = 50
export const SESSION_LIMIT = 100

/**
 * a range as inclusive day indexes, plus the period before it
 */
export type Window = {
  range: Range
  from: number
  to: number
  previous: [number, number] | null
}

type Spans = Record<Dimension | "file", Map<string, number[]>>

/**
 * what logs are broken down by, files included
 */
export const BREAKDOWNS = ["project", "language", "editor", "os", "branch", "file"] as const

/**
 * first index whose log starts at or after an instant
 *
 * @param list entries ordered by start
 * @param ms epoch ms
 *
 * @returns {number} index, list.length when none does
 */
export function lowerBound(list: readonly Entry[], ms: number): number {
  let low = 0
  let high = list.length

  while (low < high) {
    const middle = (low + high) >> 1

    if (list[middle].start < ms) low = middle + 1
    else high = middle
  }

  return low
}

/**
 * keep only the logs a view's filter matches
 *
 * @param list entries
 * @param filter view filter
 *
 * @returns {readonly Entry[]} matching entries
 */
export const filtered = (list: readonly Entry[], filter: View["filter"]): readonly Entry[] =>
  filter ? list.filter((entry) => entry[filter.dimension] === filter.value) : list

/**
 * merge overlapping intervals and sum them, mirrors takatime's true duration
 *
 * @param spans flat start and end pairs, ordered by start
 *
 * @returns {number} seconds
 */
export function trueDuration(spans: number[]): number {
  let total = 0
  let start = spans[0]
  let end = spans[1]

  for (let index = 2; index < spans.length; index += 2) {
    if (spans[index] <= end) {
      end = Math.max(end, spans[index + 1])
    } else {
      total += end - start
      start = spans[index]
      end = spans[index + 1]
    }
  }

  return spans.length ? (total + end - start) / 1000 : 0
}

/**
 * resolve a range into day indexes
 *
 * @param table day table
 * @param range range
 * @param firstActive first day with activity
 *
 * @returns {Window} window
 */
export function window(table: Days, range: Range, firstActive: number): Window {
  const { today } = table
  const key = table.keys[today]

  switch (range) {
    case "today":
      return {
        range,
        from: today,
        to: today,
        previous: [today - 1, today - 1],
      }
    case "week":
      return {
        range,
        from: today - 6,
        to: today,
        previous: [today - 13, today - 7],
      }
    case "month":
      return {
        range,
        from: today - 29,
        to: today,
        previous: [today - 59, today - 30],
      }
    case "year": {
      const from = keyIndex(table, monthStart(key, 11))
      return {
        range,
        from,
        to: today,
        previous: [keyIndex(table, monthStart(key, 23)), from - 1],
      }
    }
    case "all":
      return {
        range,
        from: Math.min(firstActive, today),
        to: today,
        previous: null,
      }
  }
}

/**
 * sum daily seconds over a span of day indexes
 *
 * @param daily seconds per day
 * @param from first index
 * @param to last index
 *
 * @returns {number} seconds
 */
export function sum(daily: Float64Array, from: number, to: number): number {
  let total = 0
  for (let index = Math.max(from, 0); index <= to; index++) total += daily[index]

  return total
}

/**
 * local hour of day at an instant
 *
 * @param table day table
 * @param ms epoch ms
 *
 * @returns {number} 0 to 23
 */
function hourOf(table: Days, ms: number): number {
  const index = Math.min(Math.max(dayIndex(table, ms), 0), table.offsets.length - 1)
  const local = Math.floor((ms + offsetIn(table, index, ms)) / HOUR)

  return ((local % 24) + 24) % 24
}

/**
 * spread merged activity over local days and hours
 *
 * @param list entries ordered by start
 * @param table day table
 * @param bounds first and last day index of each range
 * @param focus day index to split by hour
 *
 * @returns daily seconds, hour of day seconds per range, hourly seconds of the focus day
 */
export function distribute(list: readonly Entry[], table: Days, bounds: [number, number][], focus: number) {
  const daily = new Float64Array(table.keys.length)
  const hours = bounds.map(() => new Array<number>(24).fill(0))
  const focused = new Array<number>(24).fill(0)
  const { starts } = table

  /**
   * split one merged interval at local day and hour boundaries
   *
   * @param from start ms
   * @param to end ms
   */
  const spread = (from: number, to: number) => {
    let time = Math.max(from, starts[0])
    let index = dayIndex(table, time)

    while (time < to && index < daily.length) {
      // segments never cross a dst switch, so one offset holds for each
      const offset = offsetIn(table, index, time)
      const local = Math.floor((time + offset) / HOUR)
      const end = Math.min(to, starts[index + 1], (local + 1) * HOUR - offset, nextShift(table, index, time))
      const seconds = (end - time) / 1000
      const hour = ((local % 24) + 24) % 24

      daily[index] += seconds
      if (index === focus) focused[hour] += seconds

      for (let range = 0; range < bounds.length; range++) {
        const [from, to] = bounds[range]
        if (index >= from && index <= to) hours[range][hour] += seconds
      }

      time = end
      if (time >= starts[index + 1]) index++
    }
  }

  let start = -1
  let end = -1

  for (const entry of list) {
    if (entry.start <= end) {
      end = Math.max(end, entry.end)
    } else {
      if (end > start) spread(start, end)
      start = entry.start
      end = entry.end
    }
  }

  if (end > start) spread(start, end)

  return { daily, hours, focused }
}

/**
 * headline numbers, takatime's streak and daily target logic
 *
 * @param daily seconds per day
 * @param table day table
 *
 * @returns {Summary} summary
 */
export function summarize(daily: Float64Array, table: Days): Summary {
  const { today, keys } = table

  let allTime = 0
  let activeDays = 0
  let since: string | null = null
  let bestDay: Summary["bestDay"] = null
  let bestStreak = 0
  let run = 0

  for (let index = 0; index <= today; index++) {
    const seconds = daily[index]
    allTime += seconds

    if (seconds > 0) {
      activeDays++
      since ??= keys[index]
      bestStreak = Math.max(bestStreak, ++run)

      if (!bestDay || seconds > bestDay.seconds) {
        bestDay = { date: keys[index], seconds }
      }
    } else {
      run = 0
    }
  }

  // an idle today keeps yesterday's streak alive
  let streak = 0
  let index = daily[today] > 0 ? today : today - 1
  while (index >= 0 && daily[index] > 0) {
    streak++
    index--
  }

  return {
    today: Math.round(daily[today]),
    yesterday: Math.round(daily[today - 1] ?? 0),
    average: activeDays ? Math.round(allTime / activeDays) : 0,
    streak,
    bestStreak,
    bestDay: bestDay && { ...bestDay, seconds: Math.round(bestDay.seconds) },
    allTime: Math.round(allTime),
    activeDays,
    since,
  }
}

/**
 * bucket a range for the activity chart
 *
 * @param window range window
 * @param daily seconds per day
 * @param todayHours hourly seconds today
 * @param table day table
 * @param now current instant
 *
 * @returns {Period["activity"]} activity
 */
export function activity(
  window: Window,
  daily: Float64Array,
  todayHours: number[],
  table: Days,
  now: number
): Period["activity"] {
  const total = Math.round(sum(daily, window.from, window.to))
  const previous = window.previous ? Math.round(sum(daily, window.previous[0], window.previous[1])) : null

  if (window.range === "today") {
    return {
      total,
      previous,
      unit: "hour",
      current: hourOf(table, now),
      buckets: todayHours.map((seconds, hour) => ({
        key: String(hour).padStart(2, "0"),
        seconds: Math.round(seconds),
      })),
    }
  }

  const buckets: Bucket[] = []

  if (window.range === "week" || window.range === "month") {
    for (let index = window.from; index <= window.to; index++) {
      buckets.push({
        key: table.keys[index],
        seconds: Math.round(daily[index]),
      })
    }

    return {
      total,
      previous,
      unit: "day",
      current: buckets.length - 1,
      buckets,
    }
  }

  // months, from the first one in range through the current one
  let month = monthStart(table.keys[Math.max(window.from, 0)])
  const last = monthStart(table.keys[window.to])

  for (;;) {
    const next = monthStart(month, -1)
    const seconds = sum(
      daily,
      Math.max(keyIndex(table, month), window.from),
      Math.min(keyIndex(table, next) - 1, window.to)
    )

    buckets.push({ key: month.slice(0, 7), seconds: Math.round(seconds) })

    if (month === last) break
    month = next
  }

  return {
    total,
    previous,
    unit: "month",
    current: buckets.length - 1,
    buckets,
  }
}

/**
 * rank values by time, ties by name so the order never depends on how the time was summed
 *
 * @param totals seconds per value
 * @param limit max items
 *
 * @returns {Item[]} items, shares relative to the sum of all items
 */
export function rankTotals(totals: Iterable<[string, number]>, limit = LIST_LIMIT): Item[] {
  const items: Item[] = []
  let total = 0

  for (const [name, seconds] of totals) {
    if (seconds <= 0) continue

    items.push({ name, seconds, share: 0 })
    total += seconds
  }

  items.sort((a, b) => b.seconds - a.seconds || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  return items.slice(0, limit).map((item) => ({
    name: item.name,
    seconds: Math.round(item.seconds),
    share: total ? Math.round((item.seconds / total) * 10_000) / 10_000 : 0,
  }))
}

/**
 * rank values by merged time, takatime's list stats
 *
 * @param groups spans per value
 * @param limit max items
 *
 * @returns {Item[]} items, shares relative to the sum of all items
 */
export const rank = (groups: Map<string, number[]>, limit = LIST_LIMIT): Item[] =>
  rankTotals(
    [...groups].map(([name, spans]): [string, number] => [name, trueDuration(spans)]),
    limit
  )

/**
 * pick the values with the most time
 *
 * @param tally seconds per value
 * @param count how many to keep
 *
 * @returns {string[]} top values
 */
const top = (tally: Map<string, number>, count: number): string[] =>
  [...tally]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([name]) => name)

/**
 * add time to a tally
 *
 * @param tally target
 * @param key value
 * @param seconds time
 */
const count = (tally: Map<string, number>, key: string, seconds: number) =>
  tally.set(key, (tally.get(key) ?? 0) + seconds)

/**
 * a session still being built, with time per language, editor and branch
 */
type OpenSession = Session & {
  // position in the list, so a clone can take its place
  index: number
  languageTally: Map<string, number>
  editorTally: Map<string, number>
  branchTally: Map<string, number>
}

/**
 * work sessions, built from logs in start order
 * projects worked on side by side keep their own session going
 */
export class Sessions {
  // every session in the order it started
  list: OpenSession[] = []
  // the latest session per project, the only ones a later log can extend
  private open = new Map<string, OpenSession>()

  /**
   * add a log, starting a session or extending its project's latest one
   *
   * @param entry log, starting before to
   * @param to end of today, logs are cut off there
   */
  add(entry: Entry, to: number) {
    const { start } = entry
    const end = Math.min(entry.end, to)
    let current = this.open.get(entry.project)

    if (!current || start - current.end > SESSION_GAP) {
      current = {
        project: entry.project,
        start,
        end: start,
        seconds: 0,
        languages: [],
        editor: "",
        branch: "",
        index: this.list.length,
        languageTally: new Map(),
        editorTally: new Map(),
        branchTally: new Map(),
      }
      this.list.push(current)
      this.open.set(entry.project, current)
    }

    // only the part past what the session already covers is new time
    const seconds = (end - start) / 1000

    current.seconds += Math.max(0, end - Math.max(start, current.end)) / 1000
    current.end = Math.max(current.end, end)

    count(current.languageTally, entry.language, seconds)
    count(current.editorTally, entry.editor, seconds)
    count(current.branchTally, entry.branch, seconds)
  }

  /**
   * a copy that can keep growing without touching this one
   * finished sessions are shared, only the ones a log could still extend are copied
   *
   * @returns {Sessions} copy
   */
  clone(): Sessions {
    const copy = new Sessions()
    copy.list = this.list.slice()

    for (const [project, session] of this.open) {
      const twin: OpenSession = {
        ...session,
        languageTally: new Map(session.languageTally),
        editorTally: new Map(session.editorTally),
        branchTally: new Map(session.branchTally),
      }

      copy.list[twin.index] = twin
      copy.open.set(project, twin)
    }

    return copy
  }

  /**
   * how many sessions started at or after an instant
   *
   * @param from epoch ms
   *
   * @returns {number} count
   */
  countFrom(from: number): number {
    // sessions start in order, so the first one in range splits the list
    let low = 0
    let high = this.list.length

    while (low < high) {
      const middle = (low + high) >> 1

      if (this.list[middle].start < from) low = middle + 1
      else high = middle
    }

    return this.list.length - low
  }

  /**
   * the latest sessions, newest first
   *
   * @param limit how many
   *
   * @returns {Session[]} sessions
   */
  latest(limit = SESSION_LIMIT): Session[] {
    return this.list.slice(-limit).reverse().map(Sessions.finish)
  }

  /**
   * the longest session starting at or after an instant
   * only sessions starting in the range, one carried over from before could outgrow it
   *
   * @param from epoch ms
   *
   * @returns {Session | null} session
   */
  longest(from: number): Session | null {
    let found: OpenSession | null = null

    for (const session of this.list) {
      if (session.start >= from && (!found || session.seconds > found.seconds)) {
        found = session
      }
    }

    return found && Sessions.finish(found)
  }

  /**
   * close a session for output
   *
   * @param session open session
   *
   * @returns {Session} session
   */
  static finish({ languageTally, editorTally, branchTally, index, ...session }: OpenSession): Session {
    void index

    return {
      ...session,
      start: Math.round(session.start),
      end: Math.round(session.end),
      seconds: Math.round(session.seconds),
      languages: top(languageTally, 3),
      editor: top(editorTally, 1)[0] ?? "",
      branch: top(branchTally, 1)[0] ?? "",
    }
  }
}

/**
 * per dimension rankings for every range in one pass, plus work sessions
 * ranges all end now and are nested, so each log lands in a prefix of them
 *
 * @param list entries ordered by start
 * @param froms start of each range, epoch ms
 * @param to end of today, epoch ms
 *
 * @returns rankings per range and the latest sessions
 */
export function groups(list: readonly Entry[], froms: number[], to: number) {
  const spans: Spans[] = froms.map(() => ({
    project: new Map(),
    language: new Map(),
    editor: new Map(),
    os: new Map(),
    branch: new Map(),
    file: new Map(),
  }))

  const sessions = new Sessions()

  for (const entry of list) {
    if (entry.start >= to) continue

    for (let range = 0; range < froms.length; range++) {
      if (entry.end <= froms[range]) continue

      const start = Math.max(entry.start, froms[range])
      const end = Math.min(entry.end, to)

      for (const dimension of BREAKDOWNS) {
        const map = spans[range][dimension]
        const list = map.get(entry[dimension])

        if (list) list.push(start, end)
        else map.set(entry[dimension], [start, end])
      }
    }

    sessions.add(entry, to)
  }

  return {
    rankings: spans.map((ranges, index) => ({
      breakdown: {
        project: rank(ranges.project),
        language: rank(ranges.language),
        editor: rank(ranges.editor),
        os: rank(ranges.os),
        branch: rank(ranges.branch),
      },
      files: rank(ranges.file, FILE_LIMIT),
      // a session counts towards the range it started in
      sessionCount: sessions.countFrom(froms[index]),
    })),
    sessions: sessions.latest(),
    longest: froms.map((from) => sessions.longest(from)),
  }
}

/**
 * the most recent log across everything
 *
 * @param list entries ordered by start
 * @param maxDuration longest log, lets the scan stop early
 *
 * @returns {Latest | null} latest
 */
export function latest(list: readonly Entry[], maxDuration = Infinity): Latest | null {
  let found: Entry | null = null

  // from the newest start back, a log starting too early to end later cannot win
  for (let index = list.length - 1; index >= 0; index--) {
    const entry = list[index]
    if (found && entry.start + maxDuration < found.end) break

    // ties go to the earliest start, as a forward scan would pick
    if (!found || entry.end >= found.end) found = entry
  }

  if (!found) return null

  const { project, language, editor, branch, file, end } = found

  return { project, language, editor, branch, file, end }
}

/**
 * detailed insights for a span of days, opened from the charts
 * only reads the logs that can reach the period, its comparison and the sessions starting in it
 *
 * @param view view
 * @param all every entry, ordered by start
 * @param now current instant
 * @param period first and last day, inclusive
 * @param maxDuration longest log, bounds how far back logs can reach
 *
 * @returns {Detail} detail
 */
export function detail(
  view: View,
  all: readonly Entry[],
  now: number,
  period: PeriodRange,
  maxDuration = Infinity
): Detail {
  // whole months compare against the month before, anything else against the same span
  const month = period.from.endsWith("-01") && monthStart(period.from, -1) === nextDay(period.to)
  const length = (Date.parse(period.to) - Date.parse(period.from)) / DAY + 1
  const earliest = month
    ? monthStart(period.from, 1)
    : new Date(Date.parse(period.from) - length * DAY).toISOString().slice(0, 10)

  // reach back to the compared period, logs may start later than it, a day of margin covers any offset
  const table = days(view.tz, Math.min(all[0]?.start ?? now, Date.parse(earliest) - DAY), now)

  // what happens before the comparison starts, or a session gap before the period, cannot matter
  const reach = Math.min(table.starts[Math.max(keyIndex(table, earliest), 0)], Date.parse(period.from) - DAY)
  const lower = lowerBound(all, reach - SESSION_GAP - maxDuration)
  const upper = lowerBound(all, Date.parse(period.to) + 2 * DAY)
  const list = filtered(lower === 0 && upper === all.length ? all : all.slice(lower, upper), view.filter)

  // a period in the future comes back empty
  const from = Math.min(Math.max(keyIndex(table, period.from), 0), table.today + 1)
  const to = Math.min(keyIndex(table, period.to), table.today)
  const span = Math.max(to - from + 1, 0)

  const previous: [number, number] = [keyIndex(table, earliest), from - 1]

  const { daily, hours, focused } = distribute(list, table, [[from, to]], from)

  const fromMs = table.starts[from]
  const toMs = table.starts[Math.max(to, from - 1) + 1]
  const { rankings, sessions, longest } = groups(list, [fromMs], toMs)

  let first: number | null = null
  let last: number | null = null

  for (const entry of list) {
    if (entry.end <= fromMs || entry.start >= toMs) continue

    first = Math.min(first ?? Infinity, Math.max(entry.start, fromMs))
    last = Math.max(last ?? -Infinity, Math.min(entry.end, toMs))
  }

  const single = period.from === period.to
  const buckets: Bucket[] = []

  if (single) {
    focused.forEach((seconds, hour) =>
      buckets.push({
        key: String(hour).padStart(2, "0"),
        seconds: Math.round(seconds),
      })
    )
  } else {
    for (let index = from; index <= to; index++) {
      buckets.push({
        key: table.keys[index],
        seconds: Math.round(daily[index]),
      })
    }
  }

  let activeDays = 0
  for (let index = from; index <= to; index++) if (daily[index] > 0) activeDays++

  return {
    view,
    ...period,
    unit: single ? "hour" : "day",
    total: Math.round(sum(daily, from, to)),
    previous: Math.round(sum(daily, previous[0], previous[1])),
    activeDays,
    days: span,
    buckets,
    hours: hours[0].map(Math.round),
    ...rankings[0],
    // a session belongs to the period it started in
    sessions: sessions.filter((session) => session.start >= fromMs),
    longest: longest[0],
    first: first === null ? null : Math.round(first),
    last: last === null ? null : Math.round(last),
  }
}
