import type { Dimension } from "@/lib/stats/types";

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/**
 * pretty names for the os values takatime records
 */
const SYSTEMS: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  windows: "Windows",
  freebsd: "FreeBSD",
};

/**
 * format seconds like takatime does
 *
 * @param seconds duration
 *
 * @returns {string} e.g. 3h 12m
 */
export function duration(seconds: number): string {
  if (seconds > 0 && seconds < MINUTE) return "<1m";

  const hours = Math.floor(seconds / HOUR);
  const minutes = Math.floor((seconds % HOUR) / MINUTE);

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * format seconds as a short axis label
 *
 * @param seconds duration
 *
 * @returns {string} e.g. 4h or 30m
 */
export function shortDuration(seconds: number): string {
  if (seconds >= HOUR) {
    const hours = seconds / HOUR;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  }

  return `${Math.round(seconds / MINUTE)}m`;
}

/**
 * format how long ago an instant was
 *
 * @param ms epoch ms
 * @param now current epoch ms
 *
 * @returns {string} e.g. 5m ago
 */
export function ago(ms: number, now: number): string {
  const seconds = Math.max(0, (now - ms) / 1000);

  if (seconds < MINUTE) return "just now";
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`;
  if (seconds < 24 * HOUR) return `${Math.floor(seconds / HOUR)}h ago`;

  return `${Math.floor(seconds / (24 * HOUR))}d ago`;
}

/**
 * display name for a dimension value
 *
 * @param dimension dimension
 * @param name raw value
 *
 * @returns {string} label
 */
export function label(dimension: Dimension | "file", name: string): string {
  if (!name || name.toLowerCase() === "unknown") return "Unknown";
  if (dimension === "os") return SYSTEMS[name.toLowerCase()] ?? name;

  return name;
}

/**
 * shorten a file path to its place inside the project
 *
 * @param path absolute path
 * @param project project name
 *
 * @returns {{ name: string; dir: string }} file name and its directory
 */
export function filePath(
  path: string,
  project?: string,
): { name: string; dir: string } {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const name = parts.pop() ?? path;

  // keep what follows the project folder, or the last couple of folders
  const at = project ? parts.lastIndexOf(project) : -1;
  const dir = at >= 0 ? parts.slice(at) : parts.slice(-2);

  return { name, dir: dir.join("/") };
}

/**
 * format a calendar day or month key, always in utc since keys are plain dates
 *
 * @param key YYYY-MM-DD or YYYY-MM
 * @param locale bcp 47 locale
 * @param options intl options
 *
 * @returns {string} formatted date
 */
export function day(
  key: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  },
): string {
  const date = new Date(`${key.length === 7 ? `${key}-01` : key}T00:00:00Z`);

  return date.toLocaleDateString(locale, { ...options, timeZone: "UTC" });
}

/**
 * format an instant as a time of day
 *
 * @param ms epoch ms
 * @param locale bcp 47 locale
 * @param tz iana timezone
 *
 * @returns {string} e.g. 14:05
 */
export const time = (ms: number, locale: string, tz: string): string =>
  new Date(ms).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });

/**
 * calendar day an instant falls on
 *
 * @param ms epoch ms
 * @param tz iana timezone
 *
 * @returns {string} YYYY-MM-DD
 */
export const dayKey = (ms: number, tz: string): string =>
  new Date(ms).toLocaleDateString("en-CA", { timeZone: tz });

/**
 * percent change between two values
 *
 * @param current current value
 * @param previous previous value
 *
 * @returns {number | null} change ratio, null when there is no baseline
 */
export const change = (
  current: number,
  previous: number | null,
): number | null => (previous ? (current - previous) / previous : null);
