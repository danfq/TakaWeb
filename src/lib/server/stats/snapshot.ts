import {
  RANGES,
  type Bucket,
  type Detail,
  type Dimension,
  type Item,
  type Latest,
  type Period,
  type PeriodRange,
  type Range,
  type Session,
  type Snapshot,
  type Summary,
  type View,
} from "@/lib/stats/types";
import {
  dayIndex,
  days,
  keyIndex,
  monthStart,
  weekday,
  type Days,
} from "./days";
import type { Entry } from "./store";

const HOUR = 60 * 60 * 1000;

/**
 * a gap longer than this splits a session, matches takatime's idle cutoff in spirit
 */
const SESSION_GAP = 15 * 60 * 1000;

const LIST_LIMIT = 100;
const FILE_LIMIT = 50;
const SESSION_LIMIT = 100;

/**
 * a range as inclusive day indexes, plus the period before it
 */
type Window = {
  range: Range;
  from: number;
  to: number;
  previous: [number, number] | null;
};

type Spans = Record<Dimension | "file", Map<string, number[]>>;

/**
 * merge overlapping intervals and sum them, mirrors takatime's true duration
 *
 * @param spans flat start and end pairs, ordered by start
 *
 * @returns {number} seconds
 */
function trueDuration(spans: number[]): number {
  let total = 0;
  let start = spans[0];
  let end = spans[1];

  for (let index = 2; index < spans.length; index += 2) {
    if (spans[index] <= end) {
      end = Math.max(end, spans[index + 1]);
    } else {
      total += end - start;
      start = spans[index];
      end = spans[index + 1];
    }
  }

  return spans.length ? (total + end - start) / 1000 : 0;
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
function window(table: Days, range: Range, firstActive: number): Window {
  const { today } = table;
  const key = table.keys[today];

  switch (range) {
    case "today":
      return {
        range,
        from: today,
        to: today,
        previous: [today - 1, today - 1],
      };
    case "week":
      return {
        range,
        from: today - 6,
        to: today,
        previous: [today - 13, today - 7],
      };
    case "month":
      return {
        range,
        from: today - 29,
        to: today,
        previous: [today - 59, today - 30],
      };
    case "year": {
      const from = keyIndex(table, monthStart(key, 11));
      return {
        range,
        from,
        to: today,
        previous: [keyIndex(table, monthStart(key, 23)), from - 1],
      };
    }
    case "all":
      return {
        range,
        from: Math.min(firstActive, today),
        to: today,
        previous: null,
      };
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
function sum(daily: Float64Array, from: number, to: number): number {
  let total = 0;
  for (let index = Math.max(from, 0); index <= to; index++)
    total += daily[index];

  return total;
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
  const index = Math.min(
    Math.max(dayIndex(table, ms), 0),
    table.offsets.length - 1,
  );
  const local = Math.floor((ms + table.offsets[index]) / HOUR);

  return ((local % 24) + 24) % 24;
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
function distribute(
  list: readonly Entry[],
  table: Days,
  bounds: [number, number][],
  focus: number,
) {
  const daily = new Float64Array(table.keys.length);
  const hours = bounds.map(() => new Array<number>(24).fill(0));
  const focused = new Array<number>(24).fill(0);
  const { starts, offsets } = table;

  /**
   * split one merged interval at local day and hour boundaries
   *
   * @param from start ms
   * @param to end ms
   */
  const spread = (from: number, to: number) => {
    let time = Math.max(from, starts[0]);
    let index = dayIndex(table, time);

    while (time < to && index < daily.length) {
      const offset = offsets[index];
      const local = Math.floor((time + offset) / HOUR);
      const end = Math.min(to, starts[index + 1], (local + 1) * HOUR - offset);
      const seconds = (end - time) / 1000;
      const hour = ((local % 24) + 24) % 24;

      daily[index] += seconds;
      if (index === focus) focused[hour] += seconds;

      for (let range = 0; range < bounds.length; range++) {
        const [from, to] = bounds[range];
        if (index >= from && index <= to) hours[range][hour] += seconds;
      }

      time = end;
      if (time >= starts[index + 1]) index++;
    }
  };

  let start = -1;
  let end = -1;

  for (const entry of list) {
    if (entry.start <= end) {
      end = Math.max(end, entry.end);
    } else {
      if (end > start) spread(start, end);
      start = entry.start;
      end = entry.end;
    }
  }

  if (end > start) spread(start, end);

  return { daily, hours, focused };
}

/**
 * headline numbers, takatime's streak and daily target logic
 *
 * @param daily seconds per day
 * @param table day table
 *
 * @returns {Summary} summary
 */
function summarize(daily: Float64Array, table: Days): Summary {
  const { today, keys } = table;

  let allTime = 0;
  let activeDays = 0;
  let since: string | null = null;
  let bestDay: Summary["bestDay"] = null;
  let bestStreak = 0;
  let run = 0;

  for (let index = 0; index <= today; index++) {
    const seconds = daily[index];
    allTime += seconds;

    if (seconds > 0) {
      activeDays++;
      since ??= keys[index];
      bestStreak = Math.max(bestStreak, ++run);

      if (!bestDay || seconds > bestDay.seconds) {
        bestDay = { date: keys[index], seconds };
      }
    } else {
      run = 0;
    }
  }

  // an idle today keeps yesterday's streak alive
  let streak = 0;
  let index = daily[today] > 0 ? today : today - 1;
  while (index >= 0 && daily[index] > 0) {
    streak++;
    index--;
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
  };
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
function activity(
  window: Window,
  daily: Float64Array,
  todayHours: number[],
  table: Days,
  now: number,
): Period["activity"] {
  const total = Math.round(sum(daily, window.from, window.to));
  const previous = window.previous
    ? Math.round(sum(daily, window.previous[0], window.previous[1]))
    : null;

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
    };
  }

  const buckets: Bucket[] = [];

  if (window.range === "week" || window.range === "month") {
    for (let index = window.from; index <= window.to; index++) {
      buckets.push({
        key: table.keys[index],
        seconds: Math.round(daily[index]),
      });
    }

    return {
      total,
      previous,
      unit: "day",
      current: buckets.length - 1,
      buckets,
    };
  }

  // months, from the first one in range through the current one
  let month = monthStart(table.keys[Math.max(window.from, 0)]);
  const last = monthStart(table.keys[window.to]);

  for (;;) {
    const next = monthStart(month, -1);
    const seconds = sum(
      daily,
      Math.max(keyIndex(table, month), window.from),
      Math.min(keyIndex(table, next) - 1, window.to),
    );

    buckets.push({ key: month.slice(0, 7), seconds: Math.round(seconds) });

    if (month === last) break;
    month = next;
  }

  return {
    total,
    previous,
    unit: "month",
    current: buckets.length - 1,
    buckets,
  };
}

/**
 * rank values by merged time, takatime's list stats
 *
 * @param groups spans per value
 * @param limit max items
 *
 * @returns {Item[]} items, shares relative to the sum of all items
 */
function rank(groups: Map<string, number[]>, limit = LIST_LIMIT): Item[] {
  const items: Item[] = [];
  let total = 0;

  for (const [name, spans] of groups) {
    const seconds = trueDuration(spans);
    if (seconds <= 0) continue;

    items.push({ name, seconds, share: 0 });
    total += seconds;
  }

  items.sort((a, b) => b.seconds - a.seconds);

  return items.slice(0, limit).map((item) => ({
    name: item.name,
    seconds: Math.round(item.seconds),
    share: total ? Math.round((item.seconds / total) * 10_000) / 10_000 : 0,
  }));
}

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
    .map(([name]) => name);

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
function groups(list: readonly Entry[], froms: number[], to: number) {
  const spans: Spans[] = froms.map(() => ({
    project: new Map(),
    language: new Map(),
    editor: new Map(),
    os: new Map(),
    branch: new Map(),
    file: new Map(),
  }));
  const dimensions = Object.keys(spans[0]) as (Dimension | "file")[];

  type Open = Session & {
    languageTally: Map<string, number>;
    editorTally: Map<string, number>;
    branchTally: Map<string, number>;
  };

  const sessions: Open[] = [];
  // projects worked on side by side keep their own session going
  const open = new Map<string, Open>();

  /**
   * add time to a tally
   *
   * @param tally target
   * @param key value
   * @param seconds time
   */
  const count = (tally: Map<string, number>, key: string, seconds: number) =>
    tally.set(key, (tally.get(key) ?? 0) + seconds);

  for (const entry of list) {
    if (entry.start >= to) continue;

    for (let range = 0; range < froms.length; range++) {
      if (entry.end <= froms[range]) continue;

      const start = Math.max(entry.start, froms[range]);
      const end = Math.min(entry.end, to);

      for (const dimension of dimensions) {
        const map = spans[range][dimension];
        const list = map.get(entry[dimension]);

        if (list) list.push(start, end);
        else map.set(entry[dimension], [start, end]);
      }
    }

    // sessions
    const { start } = entry;
    const end = Math.min(entry.end, to);
    let current = open.get(entry.project);

    if (!current || start - current.end > SESSION_GAP) {
      current = {
        project: entry.project,
        start,
        end: start,
        seconds: 0,
        languages: [],
        editor: "",
        branch: "",
        languageTally: new Map(),
        editorTally: new Map(),
        branchTally: new Map(),
      };
      sessions.push(current);
      open.set(entry.project, current);
    }

    // only the part past what the session already covers is new time
    const seconds = (end - start) / 1000;

    current.seconds += Math.max(0, end - Math.max(start, current.end)) / 1000;
    current.end = Math.max(current.end, end);

    count(current.languageTally, entry.language, seconds);
    count(current.editorTally, entry.editor, seconds);
    count(current.branchTally, entry.branch, seconds);
  }

  /**
   * close an open session for output
   *
   * @param session open session
   *
   * @returns {Session} session
   */
  const finish = ({
    languageTally,
    editorTally,
    branchTally,
    ...session
  }: Open): Session => ({
    ...session,
    start: Math.round(session.start),
    end: Math.round(session.end),
    seconds: Math.round(session.seconds),
    languages: top(languageTally, 3),
    editor: top(editorTally, 1)[0] ?? "",
    branch: top(branchTally, 1)[0] ?? "",
  });

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
      sessionCount: sessions.filter((session) => session.start >= froms[index])
        .length,
    })),
    sessions: sessions.slice(-SESSION_LIMIT).reverse().map(finish),
    // only sessions starting in the range, one carried over from before could outgrow it
    longest: froms.map((from) => {
      let found: Open | null = null;

      for (const session of sessions) {
        if (
          session.start >= from &&
          (!found || session.seconds > found.seconds)
        ) {
          found = session;
        }
      }

      return found && finish(found);
    }),
  };
}

/**
 * the most recent log across everything
 *
 * @param list entries
 *
 * @returns {Latest | null} latest
 */
function latest(list: readonly Entry[]): Latest | null {
  let found: Entry | null = null;

  for (const entry of list) {
    if (!found || entry.end > found.end) found = entry;
  }

  if (!found) return null;

  const { project, language, editor, branch, file, end } = found;

  return { project, language, editor, branch, file, end };
}

/**
 * compute everything the dashboard shows for a view, across every range
 *
 * @param view view
 * @param all every entry, ordered by start
 * @param now current instant
 *
 * @returns {Snapshot} snapshot
 */
export function snapshot(
  view: View,
  all: readonly Entry[],
  now: number,
): Snapshot {
  const { filter } = view;
  const list = filter
    ? all.filter((entry) => entry[filter.dimension] === filter.value)
    : all;

  const table = days(view.tz, all[0]?.start ?? now, now);

  // "all" covers the whole table for the hour of day split, its real start needs the totals
  const drafts = RANGES.map((range) => window(table, range, 0));
  const { daily, hours, focused } = distribute(
    list,
    table,
    drafts.map((draft) => [draft.from, table.today]),
    table.today,
  );

  const firstActive = daily.findIndex((seconds) => seconds > 0);
  const windows = RANGES.map((range) =>
    window(table, range, firstActive === -1 ? table.today : firstActive),
  );

  const end = table.starts[table.today + 1];
  const froms = windows.map((window) => table.starts[Math.max(window.from, 0)]);
  const { rankings, sessions } = groups(list, froms, end);

  // the calendar starts on a sunday, a year back
  const yearAgo = table.today - 364;
  const calendarStart = yearAgo - weekday(table.keys[yearAgo]);

  const ranges = Object.fromEntries(
    windows.map((window, index) => [
      window.range,
      {
        start: froms[index],
        activity: activity(window, daily, focused, table, now),
        hours: hours[index].map(Math.round),
        ...rankings[index],
      },
    ]),
  ) as Record<Range, Period>;

  return {
    view,
    empty: all.length === 0,
    latest: latest(all),
    summary: summarize(daily, table),
    calendar: {
      start: table.keys[calendarStart],
      days: Array.from(
        daily.subarray(calendarStart, table.today + 1),
        Math.round,
      ),
    },
    sessions,
    ranges,
  };
}

/**
 * detailed insights for a span of days, opened from the charts
 *
 * @param view view
 * @param all every entry, ordered by start
 * @param now current instant
 * @param period first and last day, inclusive
 *
 * @returns {Detail} detail
 */
export function detail(
  view: View,
  all: readonly Entry[],
  now: number,
  period: PeriodRange,
): Detail {
  const { filter } = view;
  const list = filter
    ? all.filter((entry) => entry[filter.dimension] === filter.value)
    : all;

  const table = days(view.tz, all[0]?.start ?? now, now);
  // a period in the future comes back empty
  const from = Math.min(
    Math.max(keyIndex(table, period.from), 0),
    table.today + 1,
  );
  const to = Math.min(keyIndex(table, period.to), table.today);
  const span = Math.max(to - from + 1, 0);

  // whole months compare against the month before, anything else against the same span
  const month =
    period.from.endsWith("-01") &&
    keyIndex(table, monthStart(period.from, -1)) - 1 ===
      keyIndex(table, period.to);
  const previous: [number, number] = month
    ? [keyIndex(table, monthStart(period.from, 1)), from - 1]
    : [from - span, from - 1];

  const { daily, hours, focused } = distribute(list, table, [[from, to]], from);

  const fromMs = table.starts[from];
  const toMs = table.starts[Math.max(to, from - 1) + 1];
  const { rankings, sessions, longest } = groups(list, [fromMs], toMs);

  let first: number | null = null;
  let last: number | null = null;

  for (const entry of list) {
    if (entry.end <= fromMs || entry.start >= toMs) continue;

    first = Math.min(first ?? Infinity, Math.max(entry.start, fromMs));
    last = Math.max(last ?? -Infinity, Math.min(entry.end, toMs));
  }

  const single = period.from === period.to;
  const buckets: Bucket[] = [];

  if (single) {
    focused.forEach((seconds, hour) =>
      buckets.push({
        key: String(hour).padStart(2, "0"),
        seconds: Math.round(seconds),
      }),
    );
  } else {
    for (let index = from; index <= to; index++) {
      buckets.push({
        key: table.keys[index],
        seconds: Math.round(daily[index]),
      });
    }
  }

  let activeDays = 0;
  for (let index = from; index <= to; index++)
    if (daily[index] > 0) activeDays++;

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
  };
}
