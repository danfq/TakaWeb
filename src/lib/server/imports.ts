import { db, transaction } from "@/lib/server/db"
import type { Entry } from "@/lib/server/stats/store"
import type { ImportLog } from "@/lib/wakatime"

/**
 * where imported logs came from, the only source for now
 */
const SOURCE = "wakatime"

// loaded lazily and dropped on every change
let cache: Entry[] | null = null
// bumped on every change, lets the store know its merged view is stale
let version = 0

/**
 * forget loaded entries after a change
 */
function changed() {
  cache = null
  version++
}

/**
 * every imported log, ordered by start
 *
 * @returns {readonly Entry[]} entries
 */
export function importedEntries(): readonly Entry[] {
  cache ??= db
    .prepare(
      "SELECT start, end, project, language, editor, os, branch, file FROM imported_log ORDER BY start"
    )
    .all() as Entry[]

  return cache
}

/**
 * changes whenever imported logs do
 *
 * @returns {number} version
 */
export const importedVersion = (): number => version

/**
 * how many logs were imported
 *
 * @returns {number} count
 */
export function importedCount(): number {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM imported_log").get() as { count: number }

  return count
}

/**
 * store a batch of imported logs, skipping ones already stored
 *
 * @param logs logs
 *
 * @returns {{ added: number; skipped: number }} counts
 */
export function importLogs(logs: ImportLog[]): { added: number; skipped: number } {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO imported_log (source, id, start, end, project, language, editor, os, branch, file)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const added = transaction(db, () => {
    let added = 0

    for (const log of logs) {
      const { changes } = insert.run(
        SOURCE,
        log.id,
        Math.round(log.end - log.duration * 1000),
        log.end,
        log.project,
        log.language,
        log.editor,
        log.os,
        log.branch,
        log.file
      )

      added += Number(changes)
    }

    return added
  })

  if (added) changed()

  return { added, skipped: logs.length - added }
}

/**
 * delete every imported log, takatime's own logs are untouched
 *
 * @returns {number} logs removed
 */
export function removeImported(): number {
  const { changes } = db.prepare("DELETE FROM imported_log").run()

  if (changes) changed()

  return Number(changes)
}
