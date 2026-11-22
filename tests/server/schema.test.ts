import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, test } from "vitest"
import { SCHEMA_VERSION, migrate, openDatabase, transaction } from "@/lib/server/schema"

describe("schema", () => {
  test("creates every table on a fresh database", () => {
    const database = openDatabase(":memory:")
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name)

    expect(tables).toEqual(["imported_heartbeat", "session", "setting", "user"])
    expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
  })

  test("only applies pending migrations, so running again is safe", () => {
    const file = join(mkdtempSync(join(tmpdir(), "takaweb-schema-")), "nested", "takaweb.db")
    openDatabase(file).close()

    const database = openDatabase(file)
    migrate(database)

    expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
  })

  test("turns logs imported by older versions into heartbeats and boundaries", () => {
    const database = new DatabaseSync(":memory:")

    // a database from before imports stored heartbeats
    database.exec(`
      CREATE TABLE user (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE session (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES user (id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE imported_log (source TEXT NOT NULL, id TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, project TEXT NOT NULL, language TEXT NOT NULL, editor TEXT NOT NULL, os TEXT NOT NULL, branch TEXT NOT NULL, file TEXT NOT NULL, PRIMARY KEY (source, id)) WITHOUT ROWID;
      INSERT INTO imported_log VALUES ('wakatime', 'a', 1000, 2000, 'p', 'l', 'e', 'o', 'b', 'f');
      INSERT INTO imported_log VALUES ('wakatime', 'b', 2000, 3000, 'p', 'l', 'e', 'o', 'b', 'f');
      INSERT INTO user VALUES (1, 'admin', 'hash', 0);
      INSERT INTO session VALUES ('s', 1, 99, 0);
      PRAGMA user_version = 2;
    `)

    migrate(database)

    expect(database.prepare("SELECT time, boundary FROM imported_heartbeat ORDER BY time").all()).toEqual([
      { time: 1000, boundary: 0 },
      { time: 2000, boundary: 0 },
      // where the last log ended, so its time is kept
      { time: 3000, boundary: 1 },
    ])

    // sessions from before gain an empty origin
    expect(database.prepare("SELECT ip, user_agent FROM session").get()).toEqual({ ip: "", user_agent: "" })
  })

  test("rolls back a failed transaction", () => {
    const database = openDatabase(":memory:")

    expect(() =>
      transaction(database, () => {
        database.exec("INSERT INTO user (username, password_hash, created_at) VALUES ('a', 'h', 0)")
        throw new Error("nope")
      })
    ).toThrow("nope")

    expect(database.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 0 })
  })
})
