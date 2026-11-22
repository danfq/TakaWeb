import { FILTERABLE, RANGES, type Filter, type Range } from "@/lib/stats/types";

/**
 * cookies that let the server render the dashboard as the browser would
 */
export const TZ_COOKIE = "takaweb_tz";
export const RANGE_COOKIE = "takaweb_range";

export const DEFAULT_RANGE: Range = "week";

/**
 * range names, short ones for tight spaces
 */
export const RANGE_OPTIONS: { value: Range; label: string; short: string }[] = [
  { value: "today", label: "Today", short: "1D" },
  { value: "week", label: "7 days", short: "7D" },
  { value: "month", label: "30 days", short: "30D" },
  { value: "year", label: "Year", short: "1Y" },
  { value: "all", label: "All time", short: "All" },
];

/**
 * keeps the timezone cookie current, inlined into every page head
 */
export const TZ_SCRIPT = `document.cookie=${JSON.stringify(`${TZ_COOKIE}=`)}+encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)+";path=/;max-age=31536000;samesite=lax"`;

/**
 * store the range the next server render opens on
 *
 * @param range range
 */
export function rememberRange(range: Range) {
  document.cookie = `${RANGE_COOKIE}=${range};path=/;max-age=31536000;samesite=lax`;
}

/**
 * check a value is a known range
 *
 * @param value raw value
 *
 * @returns {boolean} whether it is a range
 */
export const isRange = (value: unknown): value is Range =>
  RANGES.includes(value as Range);

/**
 * read a filter from a query string, e.g. ?project=TakaWeb
 *
 * @param params query string
 *
 * @returns {Filter | null} filter
 */
export function readFilter(params: URLSearchParams): Filter | null {
  for (const dimension of FILTERABLE) {
    const value = params.get(dimension);
    if (value !== null && value.length <= 512) return { dimension, value };
  }

  return null;
}

/**
 * write a filter into a query string, replacing any other
 *
 * @param params query string
 * @param filter filter or null
 */
export function writeFilter(params: URLSearchParams, filter: Filter | null) {
  for (const dimension of FILTERABLE) params.delete(dimension);
  if (filter) params.set(filter.dimension, filter.value);
}
