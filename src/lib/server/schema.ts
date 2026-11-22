import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

/**
 * schema migrations, applied in order and tracked via user_version
 * plain sql, or a function for steps that depend on what the database already has
 */
const migrations: (string | ((database: DatabaseSync) => void))[] = [
  `
  CREATE TABLE user (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES user (id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX session_user_id ON session (user_id);
  `,
  // coding time imported from other trackers, kept here so the takatime mongo stays read-only
  `
  CREATE TABLE imported_log (
    source TEXT NOT NULL,
    id TEXT NOT NULL,
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    project TEXT NOT NULL,
    language TEXT NOT NULL,
    editor TEXT NOT NULL,
    os TEXT NOT NULL,
    branch TEXT NOT NULL,
    file TEXT NOT NULL,
    PRIMARY KEY (source, id)
  ) WITHOUT ROWID;
  `,
  // finds imported logs a re-import overlaps
  `
  CREATE INDEX imported_log_start ON imported_log (source, start);
  `,
  // imports keep heartbeats and join them on read, so overlapping exports add up the same in any order
  // each stored log becomes the heartbeat it started at, plus a boundary where it ended so its time is kept
  // a boundary is no real activity: a heartbeat at the same instant owns what follows instead
  `
  CREATE TABLE imported_heartbeat (
    source TEXT NOT NULL,
    time INTEGER NOT NULL,
    file TEXT NOT NULL,
    project TEXT NOT NULL,
    language TEXT NOT NULL,
    branch TEXT NOT NULL,
    editor TEXT NOT NULL,
    os TEXT NOT NULL,
    boundary INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source, time, file)
  ) WITHOUT ROWID;

  INSERT OR IGNORE INTO imported_heartbeat (source, time, file, project, language, branch, editor, os)
  SELECT source, start, file, project, language, branch, editor, os FROM imported_log;

  INSERT OR IGNORE INTO imported_heartbeat (source, time, file, project, language, branch, editor, os, boundary)
  SELECT source, end, file, project, language, branch, editor, os, 1 FROM imported_log AS log
  WHERE NOT EXISTS (
    SELECT 1 FROM imported_heartbeat AS beat WHERE beat.source = log.source AND beat.time = log.end
  );

  DROP TABLE imported_log;
  `,
  // databases that ran the step above before it marked boundaries lack the column,
  // theirs can no longer be told apart, so they stay plain heartbeats
  (database) => {
    const columns = database.prepare("SELECT name FROM pragma_table_info('imported_heartbeat')").all()

    if (!columns.some((column) => column.name === "boundary")) {
      database.exec("ALTER TABLE imported_heartbeat ADD COLUMN boundary INTEGER NOT NULL DEFAULT 0")
    }
  },
]

/**
 * how many migrations exist, the user_version of an up to date database
 */
export const SCHEMA_VERSION = migrations.length

/**
 * run a callback inside a write transaction
 *
 * @param database target database
 * @param fn callback to run
 *
 * @returns {T} callback result
 */
export function transaction<T>(database: DatabaseSync, fn: () => T): T {
  database.exec("BEGIN IMMEDIATE")

  try {
    const result = fn()
    database.exec("COMMIT")

    return result
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
}

/**
 * apply pending migrations
 *
 * @param database target database
 */
export function migrate(database: DatabaseSync) {
  const { user_version: version } = database.prepare("PRAGMA user_version").get() as { user_version: number }

  for (let index = version; index < migrations.length; index++) {
    const migration = migrations[index]

    transaction(database, () => {
      if (typeof migration === "string") database.exec(migration)
      else migration(database)

      database.exec(`PRAGMA user_version = ${index + 1}`)
    })
  }
}

/**
 * open a database file and bring its schema up to date
 *
 * @param file database path, or :memory:
 *
 * @returns {DatabaseSync} database
 */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true })

  const database = new DatabaseSync(file)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `)

  migrate(database)

  return database
}
