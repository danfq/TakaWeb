import type { Dimension } from "@/lib/stats/types"

const MINUTE = 60
const HOUR = 60 * MINUTE

/**
 * pretty names for the os values takatime records
 */
const SYSTEMS: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  windows: "Windows",
  freebsd: "FreeBSD",
}

/**
 * format seconds like takatime does
 *
 * @param seconds duration
 * @param decimal decimal hours instead, e.g. 3.2h
 *
 * @returns {string} e.g. 3h 12m
 */
export function duration(seconds: number, decimal = false): string {
  if (decimal) {
    if (seconds > 0 && seconds < HOUR / 10) return "<0.1h"

    return `${Number((seconds / HOUR).toFixed(1))}h`
  }

  if (seconds > 0 && seconds < MINUTE) return "<1m"

  const hours = Math.floor(seconds / HOUR)
  const minutes = Math.floor((seconds % HOUR) / MINUTE)

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
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
    const hours = seconds / HOUR
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
  }

  return `${Math.round(seconds / MINUTE)}m`
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
  const seconds = Math.max(0, (now - ms) / 1000)

  if (seconds < MINUTE) return "just now"
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`
  if (seconds < 24 * HOUR) return `${Math.floor(seconds / HOUR)}h ago`

  return `${Math.floor(seconds / (24 * HOUR))}d ago`
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
  if (!name || name.toLowerCase() === "unknown") return "Unknown"
  if (dimension === "os") return SYSTEMS[name.toLowerCase()] ?? name

  return name
}

/**
 * whether a dimension's values name private work, blurred when names are hidden
 *
 * @param dimension dimension
 *
 * @returns {true | undefined} true when sensitive, undefined so data attributes are left out
 */
export const sensitive = (dimension: Dimension | "file"): true | undefined =>
  dimension === "project" || dimension === "branch" || dimension === "file" ? true : undefined

/**
 * shorten a file path to its place inside the project
 *
 * @param path absolute path
 * @param project project name
 *
 * @returns {{ name: string; dir: string }} file name and its directory
 */
export function filePath(path: string, project?: string): { name: string; dir: string } {
  const parts = path.split(/[\\/]/).filter(Boolean)
  const name = parts.pop() ?? path

  // keep what follows the project folder, or the last couple of folders
  const at = project ? parts.lastIndexOf(project) : -1
  const dir = at >= 0 ? parts.slice(at) : parts.slice(-2)

  return { name, dir: dir.join("/") }
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
  }
): string {
  const date = new Date(`${key.length === 7 ? `${key}-01` : key}T00:00:00Z`)

  return date.toLocaleDateString(locale, { ...options, timeZone: "UTC" })
}

/**
 * format an instant as a time of day
 *
 * @param ms epoch ms
 * @param locale bcp 47 locale
 * @param tz iana timezone
 * @param hour12 12 hour clock, the locale decides when undefined
 *
 * @returns {string} e.g. 14:05
 */
export const time = (ms: number, locale: string, tz: string, hour12?: boolean): string =>
  new Date(ms).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
    hour12,
  })

/**
 * format an hour of the day, already in the dashboard's timezone
 *
 * @param key hour, 0 to 23, wraps past midnight
 * @param locale bcp 47 locale
 * @param hour12 12 hour clock, the locale decides when undefined
 * @param short hour alone, for axis ticks
 *
 * @returns {string} e.g. 14:00, or 14 when short
 */
export const hour = (key: string | number, locale: string, hour12?: boolean, short = false): string =>
  new Date(Date.UTC(2000, 0, 1, Number(key) % 24)).toLocaleTimeString(locale, {
    hour: short ? "numeric" : "2-digit",
    minute: short ? undefined : "2-digit",
    timeZone: "UTC",
    hour12,
  })

/**
 * calendar day an instant falls on
 *
 * @param ms epoch ms
 * @param tz iana timezone
 *
 * @returns {string} YYYY-MM-DD
 */
export const dayKey = (ms: number, tz: string): string =>
  new Date(ms).toLocaleDateString("en-CA", { timeZone: tz })

/**
 * percent change between two values
 *
 * @param current current value
 * @param previous previous value
 *
 * @returns {number | null} change ratio, null when there is no baseline
 */
export const change = (current: number, previous: number | null): number | null =>
  previous ? (current - previous) / previous : null
