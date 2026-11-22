import { db, transaction } from "@/lib/server/db"
import type { Entry } from "@/lib/server/stats/store"
import { IMPORT_TIMEOUT, UNKNOWN, inRange, type ImportHeartbeat } from "@/lib/wakatime"

/**
 * where imported heartbeats came from, the only source for now
 */
const SOURCE = "wakatime"

/**
 * what a heartbeat says besides when and where, in column order
 */
const FIELDS = ["project", "language", "branch", "editor", "os"] as const

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
 * heartbeats are joined like wakatime does: each one lasts until the next, unless the gap is a break,
 * so the logs only depend on which heartbeats are stored, never on the order exports came in
 *
 * @returns {readonly Entry[]} entries
 */
export function importedEntries(): readonly Entry[] {
  if (cache) return cache

  // at a shared instant only the last heartbeat owns what follows, so boundaries go first and real ones win
  const beats = db
    .prepare(
      `SELECT time, file, ${FIELDS.join(", ")}, boundary FROM imported_heartbeat
       WHERE source = ? ORDER BY time, boundary DESC, file`
    )
    .all(SOURCE) as (Omit<Entry, "start" | "end"> & { time: number; boundary: number })[]

  const entries: Entry[] = []

  for (let index = 0; index < beats.length - 1; index++) {
    const { time, boundary, ...beat } = beats[index]
    const end = beats[index + 1].time

    // a boundary only ends the log before it, it never owns time itself
    if (boundary) continue

    // a heartbeat sharing its instant with the next adds nothing, a long gap is a break
    if (end === time || end - time > IMPORT_TIMEOUT * 1000) continue

    entries.push({ start: time, end, ...beat })
  }

  cache = entries

  return cache
}

/**
 * changes whenever imported heartbeats do
 *
 * @returns {number} version
 */
export const importedVersion = (): number => version

/**
 * how many heartbeats were imported
 *
 * @returns {number} count
 */
export function importedCount(): number {
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM imported_heartbeat WHERE source = ?")
    .get(SOURCE) as { count: number }

  return count
}

/**
 * sql for whether an incoming field replaces the stored one: it knows something,
 * and the stored one is blank, unknown or only borrowed by a boundary
 *
 * @param field column
 *
 * @returns {string} condition
 */
const takes = (field: string): string =>
  `(boundary = 1 OR ${field} IN ('', '${UNKNOWN}')) AND excluded.${field} NOT IN ('', '${UNKNOWN}')`

/**
 * store a batch of imported heartbeats, a heartbeat is its time and file
 * one already stored only fills in what it lacked, e.g. editors a token looked up, and is never rewritten,
 * so importing any export again changes nothing
 * a boundary left by the migration becomes the real heartbeat once one arrives at its time and file
 *
 * @param heartbeats heartbeats
 *
 * @returns {{ added: number; skipped: number }} counts, filled in heartbeats count as added
 */
export function importHeartbeats(heartbeats: ImportHeartbeat[]): { added: number; skipped: number } {
  // the update only runs, and only counts as a change, when something gets filled in or a boundary becomes real
  const upsert = db.prepare(
    `INSERT INTO imported_heartbeat (source, time, file, ${FIELDS.join(", ")})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (source, time, file) DO UPDATE SET
       ${FIELDS.map((field) => `${field} = IIF(${takes(field)}, excluded.${field}, ${field})`).join(", ")},
       boundary = 0
     WHERE boundary = 1 OR ${FIELDS.map((field) => `(${takes(field)})`).join(" OR ")}`
  )

  const added = transaction(db, () => {
    let added = 0

    for (const beat of heartbeats) {
      // the browser filters these too, its clock can disagree with the server's
      if (!inRange(beat.time)) continue

      const { changes } = upsert.run(SOURCE, beat.time, beat.file, ...FIELDS.map((field) => beat[field]))

      added += Number(changes)
    }

    return added
  })

  if (added) changed()

  return { added, skipped: heartbeats.length - added }
}

/**
 * delete every imported heartbeat, takatime's own logs are untouched
 *
 * @returns {number} heartbeats removed
 */
export function removeImported(): number {
  const { changes } = db.prepare("DELETE FROM imported_heartbeat").run()

  if (changes) changed()

  return Number(changes)
}
