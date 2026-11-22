import { RANGES, type Range } from "@/lib/stats/types"

/**
 * values each choice setting accepts, the first is its default
 */
export const CHOICES = {
  timeFormat: ["auto", "12h", "24h"],
  durations: ["short", "decimal"],
  // last opens wherever the dashboard was left
  defaultRange: ["last", ...RANGES],
} as const

/**
 * switch settings and their defaults
 */
export const SWITCHES = {
  hideNames: false,
  tabTitle: false,
} as const

export type TimeFormat = (typeof CHOICES.timeFormat)[number]
export type DurationStyle = (typeof CHOICES.durations)[number]

/**
 * preferences kept with the account, so they follow it across devices
 */
export type Settings = { [K in keyof typeof CHOICES]: (typeof CHOICES)[K][number] } & {
  [K in keyof typeof SWITCHES]: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  timeFormat: "auto",
  durations: "short",
  defaultRange: "last",
  ...SWITCHES,
}

/**
 * where settings lived before they moved to the server, read once to carry them over
 */
export const LEGACY_SETTINGS_KEY = "takaweb-settings"

/**
 * read settings from untrusted input, keeping only known keys with valid values
 *
 * @param raw stored or received value
 *
 * @returns {Partial<Settings>} valid settings
 */
export function pickSettings(raw: unknown): Partial<Settings> {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const settings: Record<string, unknown> = {}

  for (const [key, values] of Object.entries(CHOICES)) {
    if ((values as readonly unknown[]).includes(input[key])) settings[key] = input[key]
  }

  for (const key of Object.keys(SWITCHES)) {
    if (typeof input[key] === "boolean") settings[key] = input[key]
  }

  return settings as Partial<Settings>
}

/**
 * read full settings, falling back to defaults for anything missing or invalid
 *
 * @param raw stored or received value
 *
 * @returns {Settings} settings
 */
export const parseSettings = (raw: unknown): Settings => ({ ...DEFAULT_SETTINGS, ...pickSettings(raw) })

/**
 * whether two settings objects match
 *
 * @param a first settings
 * @param b second settings
 *
 * @returns {boolean} whether every value is the same
 */
export const sameSettings = (a: Settings, b: Settings): boolean =>
  (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).every((key) => a[key] === b[key])

/**
 * hour12 option for a time format, undefined lets the locale decide
 *
 * @param format time format
 *
 * @returns {boolean | undefined} hour12
 */
export const hour12 = (format: TimeFormat): boolean | undefined =>
  format === "auto" ? undefined : format === "12h"

/**
 * the range to open on, null when the last used one is kept
 *
 * @param settings settings
 *
 * @returns {Range | null} range
 */
export const fixedRange = (settings: Settings): Range | null =>
  settings.defaultRange === "last" ? null : settings.defaultRange
