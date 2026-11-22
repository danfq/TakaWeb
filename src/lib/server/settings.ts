import { db } from "@/lib/server/db"
import { parseSettings, pickSettings, type Settings } from "@/lib/settings"

type Listener = (userId: number, settings: Settings) => void

// survive dev reloads, so open streams keep hearing about changes
const globals = globalThis as typeof globalThis & { __takawebSettings?: Set<Listener> }

const listeners = (globals.__takawebSettings ??= new Set())

/**
 * a user's settings, defaults for anything never changed
 *
 * @param userId user id
 *
 * @returns {Settings} settings
 */
export function getSettings(userId: number): Settings {
  const row = db.prepare("SELECT data FROM setting WHERE user_id = ?").get(userId) as
    { data: string } | undefined

  if (!row) return parseSettings({})

  try {
    return parseSettings(JSON.parse(row.data))
  } catch {
    return parseSettings({})
  }
}

/**
 * store a whole settings document and tell every open dashboard
 *
 * @param userId user id
 * @param settings settings
 *
 * @returns {Settings} stored settings
 */
function store(userId: number, settings: Settings): Settings {
  db.prepare(
    `INSERT INTO setting (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(userId, JSON.stringify(settings), Date.now())

  for (const listener of listeners) listener(userId, settings)

  return settings
}

/**
 * change some settings, ignoring unknown keys and invalid values
 *
 * @param userId user id
 * @param changes settings to change
 *
 * @returns {Settings} settings after the change
 */
export const updateSettings = (userId: number, changes: unknown): Settings =>
  store(userId, { ...getSettings(userId), ...pickSettings(changes) })

/**
 * put every setting back to its default
 *
 * @param userId user id
 *
 * @returns {Settings} default settings
 */
export const resetSettings = (userId: number): Settings => store(userId, parseSettings({}))

/**
 * listen for settings changes
 *
 * @param listener callback
 *
 * @returns {() => void} unsubscribe
 */
export function onSettings(listener: Listener): () => void {
  listeners.add(listener)

  return () => listeners.delete(listener)
}
