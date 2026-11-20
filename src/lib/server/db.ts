import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TAKAWEB_DATA_DIR } from "astro:env/server";

/**
 * schema migrations, applied in order and tracked via user_version
 */
const migrations = [
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
];

/**
 * run a callback inside a write transaction
 *
 * @param database target database
 * @param fn callback to run
 *
 * @returns {T} callback result
 */
export function transaction<T>(database: DatabaseSync, fn: () => T): T {
  database.exec("BEGIN IMMEDIATE");

  try {
    const result = fn();
    database.exec("COMMIT");

    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/**
 * apply pending migrations
 *
 * @param database target database
 */
function migrate(database: DatabaseSync) {
  const { user_version: version } = database
    .prepare("PRAGMA user_version")
    .get() as { user_version: number };

  for (let index = version; index < migrations.length; index++) {
    transaction(database, () => {
      database.exec(migrations[index]);
      database.exec(`PRAGMA user_version = ${index + 1}`);
    });
  }
}

/**
 * open the embedded database and bring its schema up to date
 *
 * @returns {DatabaseSync} database
 */
function open(): DatabaseSync {
  const dir = resolve(TAKAWEB_DATA_DIR);
  mkdirSync(dir, { recursive: true });

  const database = new DatabaseSync(join(dir, "takaweb.db"));
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);

  migrate(database);

  return database;
}

// reuse the handle across dev reloads
const globals = globalThis as typeof globalThis & { __takawebDb?: DatabaseSync };

export const db = (globals.__takawebDb ??= open());
