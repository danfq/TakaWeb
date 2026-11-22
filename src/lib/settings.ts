import { useSyncExternalStore } from "react"
import { RANGES, type Range } from "@/lib/stats/types"

/**
 * values each choice setting accepts, the first is its default
 */
const CHOICES = {
  timeFormat: ["auto", "12h", "24h"],
  durations: ["short", "decimal"],
  // last opens wherever the dashboard was left
  defaultRange: ["last", ...RANGES],
} as const

/**
 * switch settings and their defaults
 */
const SWITCHES = {
  hideNames: false,
  tabTitle: false,
} as const

export type TimeFormat = (typeof CHOICES.timeFormat)[number]
export type DurationStyle = (typeof CHOICES.durations)[number]

/**
 * preferences kept in this browser
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

export const SETTINGS_STORAGE_KEY = "takaweb-settings"

/**
 * styles the page from settings before first paint, so hidden names never flash
 * kept dependency free since it is inlined into the head
 */
export const SETTINGS_SCRIPT = `(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_STORAGE_KEY)}) ?? "{}");
    if (stored?.hideNames === true) document.documentElement.dataset.private = "";
  } catch {}
})();`

const listeners = new Set<() => void>()

// raw value the cached settings were parsed from, keeps snapshots stable
let raw: string | null = null
let cached: Settings = DEFAULT_SETTINGS

/**
 * read the stored settings, falling back to defaults for anything missing or invalid
 *
 * @returns {Settings} settings
 */
function read(): Settings {
  let next: string | null = null

  try {
    next = localStorage.getItem(SETTINGS_STORAGE_KEY)
  } catch {}

  if (next === raw) return cached

  let stored: Record<string, unknown> = {}

  try {
    stored = JSON.parse(next ?? "{}") ?? {}
  } catch {}

  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS }

  for (const [key, values] of Object.entries(CHOICES)) {
    if ((values as readonly unknown[]).includes(stored[key])) settings[key] = stored[key]
  }

  for (const key of Object.keys(SWITCHES)) {
    if (typeof stored[key] === "boolean") settings[key] = stored[key]
  }

  raw = next
  cached = settings as Settings

  return cached
}

/**
 * mirror settings that style the whole page onto the root
 *
 * @param settings settings
 */
function apply(settings: Settings) {
  const root = document.documentElement

  if (settings.hideNames) root.dataset.private = ""
  else delete root.dataset.private
}

/**
 * apply and notify subscribers, after another tab or this one changed the settings
 */
function emit() {
  apply(read())
  listeners.forEach((listener) => listener())
}

/**
 * pick up changes made in another tab
 *
 * @param event storage event
 */
function onStorage(event: StorageEvent) {
  if (event.key === SETTINGS_STORAGE_KEY || event.key === null) emit()
}

/**
 * watch the settings, including changes from other tabs
 *
 * @param callback change handler
 *
 * @returns {() => void} unsubscribe
 */
function subscribe(callback: () => void): () => void {
  if (!listeners.size) addEventListener("storage", onStorage)
  listeners.add(callback)

  return () => {
    listeners.delete(callback)
    if (!listeners.size) removeEventListener("storage", onStorage)
  }
}

/**
 * store some settings and apply them right away
 *
 * @param changes settings to change
 */
export function updateSettings(changes: Partial<Settings>) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...read(), ...changes }))
  } catch {
    // storage is blocked, keep the change for this page only
    raw = null
    cached = { ...cached, ...changes }
    apply(cached)
    listeners.forEach((listener) => listener())
    return
  }

  emit()
}

/**
 * put every setting back to its default
 */
export function resetSettings() {
  try {
    localStorage.removeItem(SETTINGS_STORAGE_KEY)
  } catch {}

  // also covers blocked storage, which always reads as nothing stored
  raw = null
  cached = DEFAULT_SETTINGS
  emit()
}

/**
 * the current settings, defaults while rendering on the server
 *
 * @returns {Settings} settings
 */
export const useSettings = (): Settings => useSyncExternalStore(subscribe, read, () => DEFAULT_SETTINGS)

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
