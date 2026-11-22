import { RANGES, type Dimension, type Period, type Range, type Snapshot, type View } from "@/lib/stats/types"
import { dayIndex, days, nextShift, offsetIn, weekday, type Days } from "./days"
import {
  BREAKDOWNS,
  FILE_LIMIT,
  HOUR,
  Sessions,
  activity,
  latest,
  lowerBound,
  rankTotals,
  summarize,
  trueDuration,
  window,
} from "./snapshot"
import type { Entry } from "./store"

/**
 * what one local day adds up to for a view, the building block every range sums
 * time is additive across days, so a range is the sum of its days however its logs overlap
 */
type DayStats = {
  // merged seconds
  total: number
  // merged seconds per local hour
  hours: number[]
  // merged ms per value, ms keep the sums exact until the end
  breakdown: Record<Dimension | "file", Map<string, number>>
}

/**
 * the logs a cache reads from, as the store hands them out
 */
export type Source = {
  // every entry, ordered by start
  all: readonly Entry[]
  structure: number
  imports: number
  // entries added since the last structural change
  appended: readonly Entry[]
  // longest entry in ms
  maxDuration: number
}

/**
 * clipped spans of one day, all of them and per value, ordered by start
 */
type Bucket = {
  spans: number[]
  values: Record<Dimension | "file", Map<string, number[]>>
}

/**
 * an empty bucket
 *
 * @returns {Bucket} bucket
 */
const bucket = (): Bucket => ({
  spans: [],
  values: Object.fromEntries(BREAKDOWNS.map((name) => [name, new Map<string, number[]>()])) as Bucket["values"],
})

/**
 * add a log's part within a day to its bucket
 * clipped starts stay in order, the ones clipped to midnight all came first
 *
 * @param target bucket
 * @param entry log
 * @param from day start
 * @param to day end
 */
function collect(target: Bucket, entry: Entry, from: number, to: number) {
  const start = Math.max(entry.start, from)
  const end = Math.min(entry.end, to)

  target.spans.push(start, end)

  for (const name of BREAKDOWNS) {
    const list = target.values[name].get(entry[name])

    if (list) list.push(start, end)
    else target.values[name].set(entry[name], [start, end])
  }
}

/**
 * merge a day's spans into its stats
 *
 * @param source collected spans
 * @param table day table
 * @param index day index
 *
 * @returns {DayStats} stats
 */
function finalize({ spans, values }: Bucket, table: Days, index: number): DayStats {
  const hours = new Array<number>(24).fill(0)
  let total = 0

  /**
   * add one merged interval, split at local hours and offset changes
   *
   * @param start start ms
   * @param end end ms
   */
  const spread = (start: number, end: number) => {
    let time = start

    while (time < end) {
      const offset = offsetIn(table, index, time)
      const local = Math.floor((time + offset) / HOUR)
      const stop = Math.min(end, (local + 1) * HOUR - offset, nextShift(table, index, time))
      const seconds = (stop - time) / 1000

      total += seconds
      hours[((local % 24) + 24) % 24] += seconds
      time = stop
    }
  }

  let start = spans[0]
  let end = spans[1]

  for (let position = 2; position < spans.length; position += 2) {
    if (spans[position] <= end) {
      end = Math.max(end, spans[position + 1])
    } else {
      spread(start, end)
      start = spans[position]
      end = spans[position + 1]
    }
  }

  spread(start, end)

  const breakdown = Object.fromEntries(
    BREAKDOWNS.map((name) => [
      name,
      new Map([...values[name]].map(([value, list]) => [value, trueDuration(list) * 1000])),
    ])
  ) as DayStats["breakdown"]

  return { total, hours, breakdown }
}

/**
 * whether a log belongs to a view
 *
 * @param entry log
 * @param filter view filter
 *
 * @returns {boolean} whether it matches
 */
const matches = (entry: Entry, filter: View["filter"]): boolean =>
  !filter || entry[filter.dimension] === filter.value

/**
 * stats of one day, reading only the logs that can reach it
 *
 * @param all every entry, ordered by start
 * @param table day table
 * @param index day index
 * @param maxDuration longest entry in ms
 * @param filter view filter
 *
 * @returns {DayStats | null} stats, null for a day without activity
 */
function dayStats(
  all: readonly Entry[],
  table: Days,
  index: number,
  maxDuration: number,
  filter: View["filter"]
): DayStats | null {
  const from = table.starts[index]
  const to = table.starts[index + 1]
  const target = bucket()

  // only logs starting a whole log length before the day can reach into it
  for (let position = lowerBound(all, from - maxDuration); position < all.length; position++) {
    const entry = all[position]

    if (entry.start >= to) break
    if (entry.end > from && matches(entry, filter)) collect(target, entry, from, to)
  }

  return target.spans.length ? finalize(target, table, index) : null
}

/**
 * stats of every day up to today in one pass, a day is finished once logs start after it
 *
 * @param all every entry, ordered by start
 * @param table day table
 * @param filter view filter
 *
 * @returns {Map<string, DayStats>} stats by day key
 */
function sweep(all: readonly Entry[], table: Days, filter: View["filter"]): Map<string, DayStats> {
  const { starts, keys, today } = table
  const out = new Map<string, DayStats>()
  const open = new Map<number, Bucket>()
  const end = starts[today + 1]
  // earliest open day, logs come in start order so it only moves forward
  let oldest = Infinity

  /**
   * finish every open day before a day index
   *
   * @param before day index
   */
  const close = (before: number) => {
    oldest = Infinity

    for (const [index, target] of open) {
      if (index < before) {
        out.set(keys[index], finalize(target, table, index))
        open.delete(index)
      } else {
        oldest = Math.min(oldest, index)
      }
    }
  }

  for (const entry of all) {
    if (entry.start >= end) break
    if (entry.end <= starts[0] || !matches(entry, filter)) continue

    const first = Math.max(dayIndex(table, entry.start), 0)
    const last = Math.min(dayIndex(table, Math.min(entry.end, end) - 1), today)

    // days before this log's start can no longer change
    if (oldest < first) close(first)

    for (let index = first; index <= last; index++) {
      let target = open.get(index)

      if (!target) {
        target = bucket()
        open.set(index, target)
        oldest = Math.min(oldest, index)
      }

      collect(target, entry, starts[index], starts[index + 1])
    }
  }

  close(Infinity)

  return out
}

/**
 * every day a log touches, up to today
 *
 * @param entry log
 * @param table day table
 * @param into day indexes to add to
 */
function touch(entry: Entry, table: Days, into: Set<number>) {
  const end = table.starts[table.today + 1]
  if (entry.start >= end || entry.end <= table.starts[0]) return

  const first = Math.max(dayIndex(table, entry.start), 0)
  const last = Math.min(dayIndex(table, Math.min(entry.end, end) - 1), table.today)

  for (let index = first; index <= last; index++) into.add(index)
}

/**
 * a dashboard view kept up to date as logs arrive
 * per day totals only change for the days new logs touch, and sessions only past a checkpoint,
 * so a burst of new logs costs about as much as the days it lands in, not the whole history
 */
export class ViewCache {
  private days = new Map<string, DayStats>()
  private structure = -1
  private imports = -1
  // how many appended entries were read
  private seen = 0
  // today when last updated, a new day refreshes the last two
  private today = ""

  // sessions up to the checkpoint, every log starting before it was added
  private checkpoint: { at: number; to: number; sessions: Sessions } | null = null
  private sessions = new Sessions()

  /**
   * @param view view to keep
   */
  constructor(readonly view: View) {}

  /**
   * the view's logs, filtered
   *
   * @param list entries
   *
   * @returns {Entry[]} matching entries
   */
  private matching(list: readonly Entry[]): readonly Entry[] {
    const { filter } = this.view

    return filter ? list.filter((entry) => entry[filter.dimension] === filter.value) : list
  }

  /**
   * recompute the stats of some days
   *
   * @param source logs
   * @param table day table
   * @param indexes days to recompute
   */
  private refreshDays(source: Source, table: Days, indexes: Iterable<number>) {
    for (const index of indexes) {
      const stats = dayStats(source.all, table, index, source.maxDuration, this.view.filter)
      const key = table.keys[index]

      if (stats) this.days.set(key, stats)
      else this.days.delete(key)
    }
  }

  /**
   * build sessions from scratch, keeping a checkpoint at the start of yesterday
   *
   * @param source logs
   * @param table day table
   */
  private rebuildSessions(source: Source, table: Days) {
    const to = table.starts[table.today + 1]
    const at = table.starts[Math.max(table.today - 1, 0)]
    const sessions = new Sessions()

    let position = 0
    const { all } = source

    for (; position < all.length && all[position].start < at; position++) {
      if (matches(all[position], this.view.filter)) sessions.add(all[position], to)
    }

    this.checkpoint = { at, to, sessions: sessions.clone() }
    this.continueSessions(sessions, source, position, to)
  }

  /**
   * add every log from a position on to sessions, they become the current ones
   *
   * @param sessions sessions to grow
   * @param source logs
   * @param position first entry to add
   * @param to end of today
   */
  private continueSessions(sessions: Sessions, source: Source, position: number, to: number) {
    const { all } = source

    for (; position < all.length; position++) {
      const entry = all[position]

      if (entry.start >= to) break
      if (matches(entry, this.view.filter)) sessions.add(entry, to)
    }

    this.sessions = sessions
  }

  /**
   * catch up with the logs, rebuilding only what changed
   *
   * @param source logs
   * @param table day table
   */
  update(source: Source, table: Days) {
    const today = table.keys[table.today]
    const to = table.starts[table.today + 1]

    if (source.structure !== this.structure || source.imports !== this.imports) {
      // something changed in place, or imports did, start over
      this.days = sweep(source.all, table, this.view.filter)
      this.rebuildSessions(source, table)

      this.structure = source.structure
      this.imports = source.imports
      this.seen = source.appended.length
      this.today = today

      return
    }

    const fresh = this.matching(source.appended.slice(this.seen))
    const touched = new Set<number>()

    for (const entry of fresh) touch(entry, table, touched)

    // a new day, logs dated ahead of time may now fall inside it
    if (today !== this.today) {
      touched.add(table.today)
      if (table.today > 0) touched.add(table.today - 1)
    }

    this.refreshDays(source, table, touched)

    // sessions only rebuild when a log lands before the checkpoint or the day moved on
    const checkpoint = this.checkpoint

    if (!checkpoint || checkpoint.to !== to || fresh.some((entry) => entry.start < checkpoint.at)) {
      this.rebuildSessions(source, table)
    } else if (fresh.length) {
      this.continueSessions(checkpoint.sessions.clone(), source, lowerBound(source.all, checkpoint.at), to)
    }

    this.seen = source.appended.length
    this.today = today
  }

  /**
   * everything the dashboard shows for the view
   *
   * @param source logs
   * @param now current instant
   *
   * @returns {Omit<Snapshot, "imports">} snapshot
   */
  snapshot(source: Source, now: number): Omit<Snapshot, "imports"> {
    const { all } = source
    const table = days(this.view.tz, all[0]?.start ?? now, now)

    this.update(source, table)

    const { today, keys, starts } = table
    const daily = new Float64Array(keys.length)
    let firstActive = -1

    for (let index = 0; index <= today; index++) {
      const stats = this.days.get(keys[index])
      if (!stats) continue

      daily[index] = stats.total
      if (firstActive === -1 && stats.total > 0) firstActive = index
    }

    const windows = RANGES.map((range) => window(table, range, firstActive === -1 ? today : firstActive))
    const froms = windows.map((window) => starts[Math.max(window.from, 0)])
    const todayHours = this.days.get(keys[today])?.hours ?? new Array<number>(24).fill(0)

    // ranges are nested and all end today, so one walk back from today fills them all
    const order = windows.map((window, index) => ({ index, from: Math.max(window.from, 0) }))
    order.sort((a, b) => b.from - a.from)

    const hours = new Array<number>(24).fill(0)
    const totals = Object.fromEntries(BREAKDOWNS.map((name) => [name, new Map<string, number>()])) as Record<
      Dimension | "file",
      Map<string, number>
    >
    const periods = new Array<Pick<Period, "hours" | "breakdown" | "files">>(RANGES.length)

    let day = today

    for (const { index, from } of order) {
      for (; day >= from; day--) {
        const stats = this.days.get(keys[day])
        if (!stats) continue

        for (let hour = 0; hour < 24; hour++) hours[hour] += stats.hours[hour]

        for (const name of BREAKDOWNS) {
          const target = totals[name]
          for (const [value, ms] of stats.breakdown[name]) target.set(value, (target.get(value) ?? 0) + ms)
        }
      }

      /**
       * ranked seconds for a breakdown so far
       *
       * @param name breakdown
       * @param limit max items
       *
       * @returns ranked items
       */
      const ranked = (name: Dimension | "file", limit?: number) =>
        rankTotals(
          [...totals[name]].map(([value, ms]): [string, number] => [value, ms / 1000]),
          limit
        )

      periods[index] = {
        hours: hours.map(Math.round),
        breakdown: {
          project: ranked("project"),
          language: ranked("language"),
          editor: ranked("editor"),
          os: ranked("os"),
          branch: ranked("branch"),
        },
        files: ranked("file", FILE_LIMIT),
      }
    }

    // the calendar starts on a sunday, a year back
    const yearAgo = today - 364
    const calendarStart = yearAgo - weekday(keys[yearAgo])

    const ranges = Object.fromEntries(
      windows.map((window, index) => [
        window.range,
        {
          start: froms[index],
          activity: activity(window, daily, todayHours, table, now),
          ...periods[index],
          // a session counts towards the range it started in
          sessionCount: this.sessions.countFrom(froms[index]),
        },
      ])
    ) as Record<Range, Period>

    return {
      view: this.view,
      empty: all.length === 0,
      latest: latest(all, source.maxDuration),
      summary: summarize(daily, table),
      calendar: {
        start: keys[calendarStart],
        days: Array.from(daily.subarray(calendarStart, today + 1), Math.round),
      },
      sessions: this.sessions.latest(),
      ranges,
    }
  }
}
