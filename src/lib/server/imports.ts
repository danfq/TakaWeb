import { db, transaction } from "@/lib/server/db"
import type { Entry } from "@/lib/server/stats/store"
import { IMPORT_TIMEOUT, UNKNOWN, type ImportLog } from "@/lib/wakatime"

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
 * a stored imported log
 */
type Row = Entry & { id: string }

/**
 * keep a known name over an unknown one, a re-import without the api lookup cannot name editors
 *
 * @param fresh name from the import
 * @param old stored name
 *
 * @returns {string} name
 */
const named = (fresh: string, old?: string): string => (fresh === UNKNOWN && old ? old : fresh)

/**
 * store a batch of imported logs, skipping ones already stored as they are
 * every stored row starts at a heartbeat, so rows from all exports are reconciled as one:
 * a new log ends at the first stored heartbeat inside it, and stored rows it overlaps keep what it leaves uncovered
 *
 * @param logs logs
 *
 * @returns {{ added: number; skipped: number }} counts, replaced or renamed logs count as added
 */
export function importLogs(logs: ImportLog[]): { added: number; skipped: number } {
  const existing = db.prepare("SELECT start, end, editor, os FROM imported_log WHERE source = ? AND id = ?")
  // one export's logs never overlap and last at most the timeout, which bounds the scans
  const next = db.prepare(
    "SELECT MIN(start) AS start FROM imported_log WHERE source = ? AND id != ? AND start > ? AND start < ?"
  )
  const overlapping = db.prepare(
    `SELECT id, start, end, project, language, editor, os, branch, file FROM imported_log
     WHERE source = ? AND (id = ? OR (start > ? AND start < ? AND end > ?))`
  )
  const rename = db.prepare("UPDATE imported_log SET editor = ?, os = ? WHERE source = ? AND id = ?")
  const remove = db.prepare("DELETE FROM imported_log WHERE source = ? AND id = ?")
  // a kept piece can reuse the id of a duplicate older imports left behind
  const insert = db.prepare(
    `INSERT OR REPLACE INTO imported_log (source, id, start, end, project, language, editor, os, branch, file)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  /**
   * store an entry under an id
   *
   * @param id log id
   * @param entry entry
   */
  const store = (id: string, entry: Entry) =>
    insert.run(
      SOURCE,
      id,
      entry.start,
      entry.end,
      entry.project,
      entry.language,
      entry.editor,
      entry.os,
      entry.branch,
      entry.file
    )

  const added = transaction(db, () => {
    let added = 0

    for (const log of logs) {
      const start = Math.round(log.end - log.duration * 1000)
      // a heartbeat another export knew of ends this log sooner
      const { start: known } = next.get(SOURCE, log.id, start, log.end) as { start: number | null }
      const end = known ?? log.end

      const stored = existing.get(SOURCE, log.id) as
        Pick<Entry, "start" | "end" | "editor" | "os"> | undefined
      const editor = named(log.editor, stored?.editor)
      const os = named(log.os, stored?.os)

      if (stored?.start === start && stored.end === end) {
        if (stored.editor === editor && stored.os === os) continue

        rename.run(editor, os, SOURCE, log.id)
        added++

        continue
      }

      const rows = overlapping.all(SOURCE, log.id, start - IMPORT_TIMEOUT * 1000, end, start) as Row[]

      for (const row of rows) {
        remove.run(SOURCE, row.id)

        // keep what the new log leaves uncovered on either side
        for (const [from, to] of [
          [row.start, Math.min(row.end, start)],
          [Math.max(row.start, end), row.end],
        ]) {
          if (to <= from) continue

          // a piece starting where its row did keeps the id, unless the new log takes it
          const id = from === row.start && row.id !== log.id ? row.id : `${row.id}@${from}`

          store(id, { ...row, start: from, end: to })
        }
      }

      store(log.id, { ...log, start, end, editor, os })
      added++
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
