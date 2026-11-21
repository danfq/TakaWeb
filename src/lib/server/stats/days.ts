/**
 * local calendar days in a timezone, as epoch boundaries
 */
export type Days = {
  // YYYY-MM-DD per day
  keys: string[];
  // local midnight per day, plus the end of the last day
  starts: number[];
  // local minus utc at each midnight, in ms
  offsets: number[];
  // days whose offset changes, such as dst switches, with when and to what
  shifts: Map<number, { at: number; offset: number }>;
  // index of the current day
  today: number;
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * always cover this many days back, enough for a year plus the year before it
 */
const MIN_SPAN = 2 * 366 + 7;

const formatters = new Map<string, Intl.DateTimeFormat>();
const cache = new Map<string, Days>();

/**
 * check a timezone name is known to the runtime
 *
 * @param tz iana timezone
 *
 * @returns {boolean} whether it is valid
 */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * wall clock fields of an instant in a timezone
 *
 * @param tz iana timezone
 * @param ms epoch ms
 *
 * @returns {number[]} year, month, day, hour, minute, second
 */
function wallClock(tz: string, ms: number): number[] {
  let formatter = formatters.get(tz);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, formatter);
  }

  const fields: Record<string, number> = {};

  for (const part of formatter.formatToParts(ms)) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }

  return [
    fields.year,
    fields.month,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  ];
}

/**
 * offset of a timezone at an instant
 *
 * @param tz iana timezone
 * @param ms epoch ms
 *
 * @returns {number} local minus utc, in ms
 */
function offsetAt(tz: string, ms: number): number {
  const [year, month, day, hour, minute, second] = wallClock(tz, ms);
  const local = Date.UTC(year, month - 1, day, hour, minute, second);

  return local - (ms - (((ms % 1000) + 1000) % 1000));
}

/**
 * format a utc date as a day key
 *
 * @param date utc date
 *
 * @returns {string} YYYY-MM-DD
 */
const toKey = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * build the day table for a timezone
 *
 * @param tz iana timezone
 * @param from earliest instant to cover
 * @param now current instant
 *
 * @returns {Days} days
 */
function build(tz: string, from: number, now: number): Days {
  const [year, month, day] = wallClock(tz, now);
  const [fromYear, fromMonth, fromDay] = wallClock(tz, from);

  // count calendar days through utc dates, which have no dst
  const todayUtc = Date.UTC(year, month - 1, day);
  const firstUtc = Math.min(
    Date.UTC(fromYear, fromMonth - 1, fromDay),
    todayUtc - (MIN_SPAN - 1) * DAY,
  );
  const count = Math.round((todayUtc - firstUtc) / DAY) + 1;

  const keys: string[] = [];
  const starts: number[] = [];
  const offsets: number[] = [];
  const shifts: Days["shifts"] = new Map();

  for (let index = 0; index <= count; index++) {
    const utc = firstUtc + index * DAY;

    // refine twice so midnights next to a dst switch land right
    let start = utc - offsetAt(tz, utc);
    start = utc - offsetAt(tz, start);

    starts.push(start);

    if (index < count) {
      keys.push(toKey(new Date(utc)));
      offsets.push(utc - start);
    }
  }

  // find the exact instant of every offset change, to the second
  for (let index = 0; index < count; index++) {
    const after = offsetAt(tz, starts[index + 1] - 1000);
    if (after === offsets[index]) continue;

    let low = starts[index];
    let high = starts[index + 1] - 1000;

    while (high - low > 1000) {
      const middle = low + Math.floor((high - low) / 2000) * 1000;

      if (offsetAt(tz, middle) === offsets[index]) low = middle;
      else high = middle;
    }

    shifts.set(index, { at: high, offset: after });
  }

  return { keys, starts, offsets, shifts, today: count - 1 };
}

/**
 * offset in effect at an instant within a day
 *
 * @param table day table
 * @param index day index
 * @param ms epoch ms within that day
 *
 * @returns {number} local minus utc, in ms
 */
export function offsetIn(table: Days, index: number, ms: number): number {
  const shift = table.shifts.get(index);

  return shift && ms >= shift.at ? shift.offset : table.offsets[index];
}

/**
 * next offset change within a day after an instant
 *
 * @param table day table
 * @param index day index
 * @param ms epoch ms within that day
 *
 * @returns {number} epoch ms of the change, infinity when there is none
 */
export function nextShift(table: Days, index: number, ms: number): number {
  const shift = table.shifts.get(index);

  return shift && ms < shift.at ? shift.at : Infinity;
}

/**
 * get the day table for a timezone, rebuilt when the day rolls over
 *
 * @param tz iana timezone
 * @param from earliest instant to cover
 * @param now current instant
 *
 * @returns {Days} days
 */
export function days(tz: string, from: number, now: number): Days {
  const cached = cache.get(tz);

  if (
    cached &&
    now >= cached.starts[cached.today] &&
    now < cached.starts[cached.today + 1] &&
    from >= cached.starts[0]
  ) {
    return cached;
  }

  const table = build(tz, from, now);
  cache.set(tz, table);

  return table;
}

/**
 * find the day an instant falls in
 *
 * @param table day table
 * @param ms epoch ms
 *
 * @returns {number} day index, -1 before the table, keys.length after it
 */
export function dayIndex(table: Days, ms: number): number {
  const { starts } = table;

  if (ms < starts[0]) return -1;
  if (ms >= starts[starts.length - 1]) return starts.length - 1;

  let low = 0;
  let high = starts.length - 2;

  while (low < high) {
    const middle = (low + high + 1) >> 1;

    if (starts[middle] <= ms) low = middle;
    else high = middle - 1;
  }

  return low;
}

/**
 * find a day by its key
 *
 * @param table day table
 * @param key YYYY-MM-DD
 *
 * @returns {number} day index, may fall outside the table
 */
export const keyIndex = (table: Days, key: string): number =>
  Math.round((Date.parse(key) - Date.parse(table.keys[0])) / DAY);

/**
 * key of the first day of a month, counted back from another day
 *
 * @param key YYYY-MM-DD
 * @param back months to go back
 *
 * @returns {string} YYYY-MM-01
 */
export function monthStart(key: string, back = 0): string {
  const date = new Date(`${key.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - back);

  return toKey(date);
}

/**
 * weekday of a day key, sunday first
 *
 * @param key YYYY-MM-DD
 *
 * @returns {number} 0 to 6
 */
export const weekday = (key: string): number =>
  new Date(`${key}T00:00:00Z`).getUTCDay();
