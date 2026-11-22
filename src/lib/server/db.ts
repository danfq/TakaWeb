import { join, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { TAKAWEB_DATA_DIR } from "astro:env/server"
import { migrate, openDatabase } from "@/lib/server/schema"

export { transaction } from "@/lib/server/schema"

/**
 * where the embedded database lives
 *
 * @param dir data directory
 *
 * @returns {string} database path
 */
export const databasePath = (dir: string = TAKAWEB_DATA_DIR): string => join(resolve(dir), "takaweb.db")

// reuse the handle across dev reloads
const globals = globalThis as typeof globalThis & { __takawebDb?: DatabaseSync }

export const db = (globals.__takawebDb ??= openDatabase(databasePath()))

// a reused handle still picks up migrations added since it opened
migrate(db)


/**
 * flush the write-ahead log and close the database, for shutdown
 */
export function closeDatabase() {
  if (!db.isOpen) return

  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  } finally {
    db.close()
    delete globals.__takawebDb
  }
}
