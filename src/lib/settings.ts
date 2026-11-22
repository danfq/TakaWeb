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
// changes storage refused to keep, they win over what it holds until a write succeeds
let override: Settings | null = null

/**
 * read the stored settings, falling back to defaults for anything missing or invalid
 *
 * @returns {Settings} settings
 */
function read(): Settings {
  if (override) return override

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
  if (!listeners.size) {
    addEventListener("storage", onStorage)
    // another tab may have changed settings after the head script ran, before anything listened
    apply(read())
  }

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
  const next = { ...read(), ...changes }

  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next))
    override = null
  } catch {
    // storage refused the write, keep the change for this page only
    override = next
  }

  emit()
}

/**
 * put every setting back to its default
 */
export function resetSettings() {
  try {
    localStorage.removeItem(SETTINGS_STORAGE_KEY)
    override = null
  } catch {
    override = DEFAULT_SETTINGS
  }

  emit()
}

/**
 * the current settings, defaults while rendering on the server
 *
 * @returns {Settings} settings
 */
export const useSettings = (): Settings => useSyncExternalStore(subscribe, read, () => DEFAULT_SETTINGS)

// the stored settings are only readable once hydrated
const hydrated = () => true
const rendering = () => false
const unchanging = () => () => {}

/**
 * whether names should stay out of plain attributes such as tooltips
 * assumed while server rendering and hydrating, since the stored setting is unknown until then
 *
 * @returns {boolean} whether names are hidden
 */
export function useNamesHidden(): boolean {
  const { hideNames } = useSettings()
  const ready = useSyncExternalStore(unchanging, hydrated, rendering)

  return !ready || hideNames
}

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
