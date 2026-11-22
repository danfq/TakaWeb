import { beforeEach, describe, expect, test, vi } from "vitest"
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings"

const actions = vi.hoisted(() => ({ settings: { update: vi.fn(), reset: vi.fn() } }))

vi.mock("astro:actions", () => ({ actions }))

// the store mirrors hidden names onto the root element
const root = { dataset: {} as Record<string, string> }
vi.stubGlobal("document", { documentElement: root })

const { createSettingsStore } = await import("@/components/settings/settings-store")

/**
 * a promise resolved from outside, to control when a save lands
 *
 * @returns deferred
 */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))

  return { promise, resolve }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("settings store", () => {
  beforeEach(() => {
    actions.settings.update.mockReset()
    actions.settings.reset.mockReset()
    root.dataset = {}
  })

  test("shows a change right away and keeps what the server stored", async () => {
    const saved = { ...DEFAULT_SETTINGS, hideNames: true }
    actions.settings.update.mockResolvedValue({ data: saved })

    const store = createSettingsStore(DEFAULT_SETTINGS)
    const heard = vi.fn()
    store.subscribe(heard)

    store.update({ hideNames: true })

    expect(store.get().hideNames).toBe(true)
    expect("private" in document.documentElement.dataset).toBe(true)
    expect(actions.settings.update).toHaveBeenCalledWith({ hideNames: true })

    await flush()
    expect(store.get()).toEqual(saved)
    expect(store.error()).toBeNull()
    expect(heard).toHaveBeenCalled()
  })

  test("falls back to the last stored settings when a save fails", async () => {
    actions.settings.update.mockResolvedValue({ error: { message: "Too many attempts" } })

    const store = createSettingsStore(DEFAULT_SETTINGS)
    store.update({ durations: "decimal" })
    await flush()

    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(store.error()).toBe("Too many attempts")

    actions.settings.update.mockRejectedValue(new Error("offline"))
    store.update({ durations: "decimal" })
    await flush()

    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(store.error()).toMatch(/Could not reach TakaWeb/)
  })

  test("ignores pushed settings while its own save is in flight", async () => {
    const pending = deferred<{ data: Settings }>()
    actions.settings.update.mockReturnValue(pending.promise)

    const store = createSettingsStore(DEFAULT_SETTINGS)
    store.update({ timeFormat: "24h" })

    // an older change from another tab arrives before ours lands
    store.receive({ ...DEFAULT_SETTINGS, timeFormat: "12h" })
    expect(store.get().timeFormat).toBe("24h")

    pending.resolve({ data: { ...DEFAULT_SETTINGS, timeFormat: "24h" } })
    await flush()
    expect(store.get().timeFormat).toBe("24h")

    // once settled, pushes from other devices apply
    store.receive({ ...DEFAULT_SETTINGS, tabTitle: true })
    expect(store.get().tabTitle).toBe(true)
  })

  test("resets everything at once", async () => {
    actions.settings.reset.mockResolvedValue({ data: DEFAULT_SETTINGS })

    const store = createSettingsStore({ ...DEFAULT_SETTINGS, hideNames: true, tabTitle: true })
    store.reset()

    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    await flush()
    expect(actions.settings.reset).toHaveBeenCalledOnce()
  })
})
