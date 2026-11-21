import type {
  Bucket,
  Dimension,
  Item,
  Latest,
  Session,
  Snapshot,
  Summary,
  View,
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
  from: number;
  to: number;
  previous: [number, number] | null;
};

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
 * resolve a view range into day indexes
 *
 * @param table day table
 * @param view view
 * @param firstActive first day with activity
 *
 * @returns {Window} window
 */
function window(table: Days, view: View, firstActive: number): Window {
  const { today } = table;
  const key = table.keys[today];

  switch (view.range) {
    case "today":
      return { from: today, to: today, previous: [today - 1, today - 1] };
    case "week":
      return { from: today - 6, to: today, previous: [today - 13, today - 7] };
    case "month":
      return {
        from: today - 29,
        to: today,
        previous: [today - 59, today - 30],
      };
    case "year": {
      const from = keyIndex(table, monthStart(key, 11));
      return {
        from,
        to: today,
        previous: [keyIndex(table, monthStart(key, 23)), from - 1],
      };
    }
    case "all":
      return { from: Math.min(firstActive, today), to: today, previous: null };
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
 * spread merged activity over local days and hours
 *
 * @param list entries ordered by start
 * @param table day table
 * @param range day window
 *
 * @returns daily seconds, hour of day seconds in range, hourly seconds today
 */
function distribute(list: readonly Entry[], table: Days, range: Window) {
  const daily = new Float64Array(table.keys.length);
  const hours = new Array<number>(24).fill(0);
  const today = new Array<number>(24).fill(0);
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
      if (index >= range.from) hours[hour] += seconds;
      if (index === table.today) today[hour] += seconds;

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

  return { daily, hours, today };
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
 * bucket the range for the activity chart
 *
 * @param view view
 * @param daily seconds per day
 * @param todayHours hourly seconds today
 * @param table day table
 * @param range day window
 *
 * @returns {Snapshot["activity"]} activity
 */
function activity(
  view: View,
  daily: Float64Array,
  todayHours: number[],
  table: Days,
  range: Window,
): Snapshot["activity"] {
  const total = Math.round(sum(daily, range.from, range.to));
  const previous = range.previous
    ? Math.round(sum(daily, range.previous[0], range.previous[1]))
    : null;

  if (view.range === "today") {
    return {
      total,
      previous,
      unit: "hour",
      buckets: todayHours.map((seconds, hour) => ({
        key: String(hour).padStart(2, "0"),
        seconds: Math.round(seconds),
      })),
    };
  }

  if (view.range === "week" || view.range === "month") {
    const buckets: Bucket[] = [];
    for (let index = range.from; index <= range.to; index++) {
      buckets.push({
        key: table.keys[index],
        seconds: Math.round(daily[index]),
      });
    }

    return { total, previous, unit: "day", buckets };
  }

  // months, from the first one in range through the current one
  const buckets: Bucket[] = [];
  let month = monthStart(table.keys[Math.max(range.from, 0)]);
  const last = monthStart(table.keys[range.to]);

  for (;;) {
    const key = month.slice(0, 7);
    const from = keyIndex(table, month);
    const next = monthStart(month, -1);

    const seconds = sum(
      daily,
      Math.max(from, range.from),
      Math.min(keyIndex(table, next) - 1, range.to),
    );

    buckets.push({ key, seconds: Math.round(seconds) });

    if (month === last) break;
    month = next;
  }

  return { total, previous, unit: "month", buckets };
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
 * pick the value with the most time
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
 * group the range into per dimension rankings and work sessions
 *
 * @param list entries ordered by start
 * @param from range start ms
 * @param to range end ms
 *
 * @returns breakdowns, files and sessions
 */
function groups(list: readonly Entry[], from: number, to: number) {
  const dimensions: Record<Dimension | "file", Map<string, number[]>> = {
    project: new Map(),
    language: new Map(),
    editor: new Map(),
    os: new Map(),
    branch: new Map(),
    file: new Map(),
  };

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
    if (entry.end <= from || entry.start >= to) continue;

    const start = Math.max(entry.start, from);
    const end = Math.min(entry.end, to);

    for (const dimension of Object.keys(dimensions) as (Dimension | "file")[]) {
      const map = dimensions[dimension];
      const spans = map.get(entry[dimension]);

      if (spans) spans.push(start, end);
      else map.set(entry[dimension], [start, end]);
    }

    // sessions
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

  return {
    breakdown: {
      project: rank(dimensions.project),
      language: rank(dimensions.language),
      editor: rank(dimensions.editor),
      os: rank(dimensions.os),
      branch: rank(dimensions.branch),
    },
    files: rank(dimensions.file, FILE_LIMIT),
    sessionCount: sessions.length,
    sessions: sessions
      .slice(-SESSION_LIMIT)
      .reverse()
      .map(({ languageTally, editorTally, branchTally, ...session }) => ({
        ...session,
        start: Math.round(session.start),
        end: Math.round(session.end),
        seconds: Math.round(session.seconds),
        languages: top(languageTally, 3),
        editor: top(editorTally, 1)[0] ?? "",
        branch: top(branchTally, 1)[0] ?? "",
      })),
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
 * compute everything the dashboard shows for a view
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

  // the range only matters for the hour of day split, which "all" starts at 0 anyway
  const draft = window(table, view, 0);
  const { daily, hours, today } = distribute(list, table, draft);

  const firstActive = daily.findIndex((seconds) => seconds > 0);
  const range = window(
    table,
    view,
    firstActive === -1 ? table.today : firstActive,
  );

  // the calendar starts on a sunday, a year back
  const yearAgo = table.today - 364;
  const calendarStart = yearAgo - weekday(table.keys[yearAgo]);

  return {
    view,
    empty: all.length === 0,
    latest: latest(all),
    summary: summarize(daily, table),
    activity: activity(view, daily, today, table, range),
    calendar: {
      start: table.keys[calendarStart],
      days: Array.from(
        daily.subarray(calendarStart, table.today + 1),
        Math.round,
      ),
    },
    hours: hours.map(Math.round),
    ...groups(
      list,
      table.starts[Math.max(range.from, 0)],
      table.starts[range.to + 1],
    ),
  };
}
