import { beforeAll, describe, expect, test } from "vitest"
import { createAdmin, getAdmin } from "@/lib/server/auth/admin"
import { db } from "@/lib/server/db"
import { getSettings, onSettings, resetSettings, updateSettings } from "@/lib/server/settings"
import { DEFAULT_SETTINGS } from "@/lib/settings"

describe("stored settings", () => {
  let userId: number

  beforeAll(() => {
    userId = (getAdmin() ?? { id: createAdmin("hash")! }).id
  })

  test("default until changed, then follow every change", () => {
    expect(getSettings(userId)).toEqual(DEFAULT_SETTINGS)

    const heard: unknown[] = []
    const stop = onSettings((owner, settings) => heard.push([owner, settings]))

    const changed = updateSettings(userId, { hideNames: true, timeFormat: "nope", unknown: 1 })
    expect(changed).toEqual({ ...DEFAULT_SETTINGS, hideNames: true })
    expect(getSettings(userId)).toEqual(changed)

    expect(updateSettings(userId, { durations: "decimal" })).toEqual({ ...changed, durations: "decimal" })
    expect(resetSettings(userId)).toEqual(DEFAULT_SETTINGS)

    stop()
    updateSettings(userId, { tabTitle: true })

    expect(heard).toHaveLength(3)
    expect(heard[0]).toEqual([userId, changed])
  })

  test("fall back to defaults when the stored document is broken", () => {
    db.prepare("UPDATE setting SET data = ? WHERE user_id = ?").run("{not json", userId)

    expect(getSettings(userId)).toEqual(DEFAULT_SETTINGS)
  })
})
