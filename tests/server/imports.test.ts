import { beforeEach, describe, expect, test } from "vitest"
import { db } from "@/lib/server/db"
import {
  importHeartbeats,
  importedCount,
  importedEntries,
  importedVersion,
  removeImported,
} from "@/lib/server/imports"
import { IMPORT_TIMEOUT, UNKNOWN, type ImportHeartbeat } from "@/lib/wakatime"

const T = Date.UTC(2025, 5, 1, 9)
const MINUTE = 60_000

/**
 * a heartbeat some minutes after the start
 *
 * @param minutes minutes after T
 * @param fields fields to set
 *
 * @returns {ImportHeartbeat} heartbeat
 */
const beat = (minutes: number, fields: Partial<ImportHeartbeat> = {}): ImportHeartbeat => ({
  time: T + minutes * MINUTE,
  file: "/src/a.ts",
  project: "takaweb",
  language: "TypeScript",
  branch: "main",
  editor: "vscode",
  os: "darwin",
  ...fields,
})

describe("imported heartbeats", () => {
  beforeEach(() => {
    removeImported()
  })

  test("join into logs, each lasting until the next unless the gap is a break", () => {
    importHeartbeats([beat(0), beat(5), beat(10), beat(10 + IMPORT_TIMEOUT / 60 + 1), beat(40)])

    expect(importedEntries().map((entry) => [(entry.start - T) / MINUTE, (entry.end - T) / MINUTE])).toEqual([
      [0, 5],
      [5, 10],
      // the gap after 10 is a break, the heartbeat at 26 lasts until 40
      [26, 40],
    ])
  })

  test("add up the same however exports overlap and in any order", () => {
    const all = [beat(0), beat(3), beat(7), beat(9, { file: "/src/b.ts" }), beat(12)]

    importHeartbeats(all.slice(2))
    importHeartbeats(all.slice(0, 3))
    const split = importedEntries()

    removeImported()
    importHeartbeats(all)

    expect(split).toEqual(importedEntries())
  })

  test("change nothing when imported again", () => {
    expect(importHeartbeats([beat(0), beat(1)])).toEqual({ added: 2, skipped: 0 })

    const version = importedVersion()
    expect(importHeartbeats([beat(0), beat(1)])).toEqual({ added: 0, skipped: 2 })
    expect(importedVersion()).toBe(version)
    expect(importedCount()).toBe(2)
  })

  test("fill in what a heartbeat lacked, never overwriting what it knew", () => {
    importHeartbeats([beat(0, { editor: UNKNOWN, os: UNKNOWN, project: "" }), beat(1)])

    expect(importHeartbeats([beat(0, { editor: "neovim", os: "linux", project: "site" })])).toEqual({
      added: 1,
      skipped: 0,
    })
    expect(importHeartbeats([beat(0, { editor: "zed" })])).toEqual({ added: 0, skipped: 1 })

    expect(importedEntries()[0]).toMatchObject({ editor: "neovim", os: "linux", project: "site" })
  })

  test("skip times outside the range the dashboard shows", () => {
    expect(
      importHeartbeats([beat(0, { time: 0 }), beat(0, { time: Date.now() + 7 * 86_400_000 }), beat(0)])
    ).toEqual({
      added: 1,
      skipped: 2,
    })
  })

  test("let a real heartbeat take over the boundary a migrated log left", () => {
    // a boundary marks where an old log ended, it never owns time
    db.prepare(
      `INSERT INTO imported_heartbeat (source, time, file, project, language, branch, editor, os, boundary)
       VALUES ('wakatime', ?, '/src/a.ts', 'takaweb', 'TypeScript', 'main', 'vscode', 'darwin', 1)`
    ).run(T + 5 * MINUTE)
    importHeartbeats([beat(0), beat(8)])

    expect(importedEntries().map((entry) => (entry.end - entry.start) / MINUTE)).toEqual([5])

    expect(importHeartbeats([beat(5)])).toEqual({ added: 1, skipped: 0 })
    expect(importedEntries().map((entry) => (entry.end - entry.start) / MINUTE)).toEqual([5, 3])
  })

  test("can all be removed", () => {
    importHeartbeats([beat(0), beat(1), beat(2)])

    expect(removeImported()).toBe(3)
    expect(importedCount()).toBe(0)
    expect(importedEntries()).toEqual([])
  })
})
