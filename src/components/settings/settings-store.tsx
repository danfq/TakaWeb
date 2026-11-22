import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { actions } from "astro:actions"
import {
  DEFAULT_SETTINGS,
  LEGACY_SETTINGS_KEY,
  parseSettings,
  pickSettings,
  sameSettings,
  type Settings,
} from "@/lib/settings"

/**
 * settings shown right away, saved to the server in the background
 */
export type SettingsStore = {
  get: () => Settings
  error: () => string | null
  subscribe: (listener: () => void) => () => void
  update: (changes: Partial<Settings>) => void
  reset: () => void
  // settings another tab or device saved, pushed over the dashboard stream
  receive: (settings: Settings) => void
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
 * create a settings store, starting from what the server rendered
 *
 * @param initial settings the page was rendered with
 *
 * @returns {SettingsStore} store
 */
export function createSettingsStore(initial: Settings): SettingsStore {
  const listeners = new Set<() => void>()
  let current = initial
  // the last settings the server confirmed, a failed save falls back to them
  let confirmed = initial
  let error: string | null = null
  // saves in flight, pushed settings would undo the newer local change until they land
  let pending = 0

  /**
   * show new settings and tell subscribers
   *
   * @param next settings
   * @param nextError error to show
   */
  const set = (next: Settings, nextError: string | null = null) => {
    if (sameSettings(next, current) && nextError === error) return

    current = next
    error = nextError
    apply(next)
    listeners.forEach((listener) => listener())
  }

  /**
   * send a change and settle on what the server stored
   *
   * @param request save request
   */
  const save = async (request: () => Promise<{ data?: Settings; error?: { message: string } }>) => {
    pending++

    let result: Settings | null = null
    let failure: string | null = null

    try {
      const { data, error } = await request()

      if (error) failure = error.message
      else if (data) result = parseSettings(data)
    } catch {
      failure = "Could not reach TakaWeb, your change was not saved"
    }

    pending--
    if (result) confirmed = result

    // only the last save decides what shows, earlier answers are already outdated
    if (!pending) set(failure ? confirmed : (result ?? confirmed), failure)
    else if (failure) error = failure
  }

  return {
    get: () => current,
    error: () => error,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(changes) {
      set({ ...current, ...changes })
      void save(() => actions.settings.update(changes))
    },
    reset() {
      set(DEFAULT_SETTINGS)
      void save(() => actions.settings.reset())
    },
    receive(settings) {
      confirmed = parseSettings(settings)
      if (!pending) set(confirmed)
    },
  }
}

const SettingsContext = createContext<SettingsStore | null>(null)

/**
 * carry settings this browser kept before they moved to the server over, once
 *
 * @param store settings store
 */
function migrateLegacy(store: SettingsStore) {
  let raw: string | null = null

  try {
    raw = localStorage.getItem(LEGACY_SETTINGS_KEY)
    if (raw !== null) localStorage.removeItem(LEGACY_SETTINGS_KEY)
  } catch {
    return
  }

  if (!raw || !sameSettings(store.get(), DEFAULT_SETTINGS)) return

  try {
    const legacy = pickSettings(JSON.parse(raw))
    if (Object.keys(legacy).length) store.update(legacy)
  } catch {}
}

/**
 * provide the settings store to the dashboard
 */
export function SettingsProvider({ initial, children }: { initial: Settings; children: ReactNode }) {
  const [store] = useState(() => createSettingsStore(initial))

  useEffect(() => migrateLegacy(store), [store])

  return <SettingsContext value={store}>{children}</SettingsContext>
}

/**
 * the settings store
 *
 * @returns {SettingsStore} store
 */
export function useSettingsStore(): SettingsStore {
  const store = useContext(SettingsContext)
  if (!store) throw new Error("useSettingsStore must be used inside a SettingsProvider")

  return store
}

/**
 * the current settings
 *
 * @returns {Settings} settings
 */
export function useSettings(): Settings {
  const store = useSettingsStore()

  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/**
 * why the last change could not be saved
 *
 * @returns {string | null} error
 */
export function useSettingsError(): string | null {
  const store = useSettingsStore()

  return useSyncExternalStore(store.subscribe, store.error, store.error)
}

/**
 * whether names should stay out of plain attributes such as tooltips
 *
 * @returns {boolean} whether names are hidden
 */
export const useNamesHidden = (): boolean => useSettings().hideNames
