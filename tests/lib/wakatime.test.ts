import { describe, expect, test } from "vitest"
import { JsonScanner } from "@/lib/json-stream"
import {
  ExportReader,
  IMPORT_BATCH,
  IMPORT_LIMITS,
  UNKNOWN,
  importBatches,
  inRange,
  parseExport,
  type ImportHeartbeat,
} from "@/lib/wakatime"

const T = Date.UTC(2025, 5, 1) / 1000

/**
 * a heartbeat as wakatime exports it
 *
 * @param fields fields to set
 *
 * @returns {Record<string, unknown>} heartbeat
 */
const beat = (fields: Record<string, unknown> = {}) => ({
  time: T,
  entity: "/repo/src/index.ts",
  type: "file",
  project: "takaweb",
  language: "TypeScript",
  branch: "main",
  user_agent_id: "agent-1",
  ...fields,
})

/**
 * an export with one day of heartbeats
 *
 * @param heartbeats heartbeats
 * @param extra other top level fields
 *
 * @returns {Record<string, unknown>} export
 */
const exported = (heartbeats: unknown[], extra: Record<string, unknown> = {}) => ({
  days: [{ date: "2025-06-01", heartbeats }],
  ...extra,
})

describe("wakatime export", () => {
  test("reads heartbeats in ms, sorted and keyed by time and file", () => {
    const result = parseExport(
      exported([
        beat({ time: T + 2 }),
        beat({ time: T + 1 }),
        beat({ time: T + 1 }),
        beat({ time: T + 1.0004 }),
      ])
    )

    expect(result.map((heartbeat) => heartbeat.time)).toEqual([T * 1000 + 1000, T * 1000 + 2000])
    expect(result[0]).toMatchObject({ file: "/repo/src/index.ts", project: "takaweb", branch: "main" })
  })

  test("keeps editor activity only", () => {
    const result = parseExport(
      exported([
        beat(),
        beat({ time: T + 1, type: "domain" }),
        beat({ time: T + 2, type: "app" }),
        beat({ time: T + 3, entity: "" }),
      ])
    )

    expect(result).toHaveLength(1)
  })

  test("skips times the dashboard cannot show", () => {
    expect(parseExport(exported([beat({ time: 0 }), beat({ time: 4e9 }), beat()]))).toHaveLength(1)
    expect(inRange(Date.UTC(1999, 0, 1))).toBe(false)
    expect(inRange(Date.now())).toBe(true)
    expect(inRange(1.5)).toBe(false)
  })

  test("names editors and systems from user agent strings", () => {
    const [heartbeat] = parseExport(
      exported([
        beat({
          user_agent: "wakatime/v1.90.0 (darwin-24.1.0-arm64) go1.23.1 vscode/1.95.0 vscode-wakatime/24.6.0",
        }),
      ])
    )

    expect(heartbeat).toMatchObject({ editor: "vscode", os: "darwin" })
  })

  test("resolves user agent ids from the export, an object or a lookup", () => {
    const list = parseExport(
      exported([beat()], { user_agents: [{ id: "agent-1", value: "wakatime/v1 (linux-6) neovim/0.10" }] })
    )
    const keyed = parseExport(
      exported([beat()], { user_agents: { "agent-1": { editor: "zed", os: "Mac" } } })
    )
    const looked = parseExport(exported([beat()], { user_agents: [{ id: "agent-1", editor: "zed" }] }), {
      "agent-1": { editor: "Neovim", os: "Windows", value: "" },
    })

    expect(list[0]).toMatchObject({ editor: "neovim", os: "linux" })
    expect(keyed[0]).toMatchObject({ editor: "zed", os: "darwin" })
    // looked up agents win over the export's own list
    expect(looked[0]).toMatchObject({ editor: "Neovim", os: "windows" })
  })

  test("falls back to unknown names", () => {
    const [heartbeat] = parseExport(exported([beat({ project: "", language: "" })]))

    expect(heartbeat).toMatchObject({ editor: UNKNOWN, os: UNKNOWN, project: UNKNOWN, language: UNKNOWN })
  })

  test("clips long fields to what the server takes", () => {
    const [heartbeat] = parseExport(
      exported([beat({ entity: "x".repeat(10_000), branch: "b".repeat(1000) })])
    )

    expect(heartbeat.file).toHaveLength(IMPORT_LIMITS.file)
    expect(heartbeat.branch).toHaveLength(IMPORT_LIMITS.branch)
  })

  test("explains exports it cannot use", () => {
    expect(() => parseExport({ data: [] })).toThrow(/no days/)
    expect(() => parseExport(null)).toThrow(/no days/)
    expect(() => parseExport({ days: [{ date: "2025-06-01", grand_total: {} }] })).toThrow(/daily totals/)
    expect(parseExport({ days: [] })).toEqual([])
  })

  test("reads the same streamed, with user agents listed after the days", () => {
    const document = exported(
      Array.from({ length: 200 }, (_, index) =>
        beat({ time: T + index * 7.5, entity: `/src/${index % 9}.ts` })
      ),
      { user_agents: [{ id: "agent-1", value: "wakatime/v1 (linux-6) neovim/0.10" }] }
    )
    const text = JSON.stringify(document)
    const reader = new ExportReader()
    const scanner = new JsonScanner(reader.visit, reader.value)

    for (let index = 0; index < text.length; index += 97) scanner.write(text.slice(index, index + 97))
    scanner.end()

    expect(reader.finish()).toEqual(parseExport(document))
  })
})

describe("import batches", () => {
  /**
   * heartbeats with a given file path length
   *
   * @param count how many
   * @param length path length
   *
   * @returns {ImportHeartbeat[]} heartbeats
   */
  const many = (count: number, length = 10): ImportHeartbeat[] =>
    Array.from({ length: count }, (_, index) => ({
      time: index,
      file: "f".repeat(length),
      project: "p",
      language: "l",
      branch: "",
      editor: "e",
      os: "o",
    }))

  test("caps batches by count", () => {
    const batches = importBatches(many(IMPORT_BATCH * 2 + 1))

    expect(batches.map((batch) => batch.length)).toEqual([IMPORT_BATCH, IMPORT_BATCH, 1])
  })

  test("caps batches by size, long paths fill them sooner", () => {
    const batches = importBatches(many(1000, 4000))

    for (const batch of batches) expect(JSON.stringify(batch).length).toBeLessThan(600 * 1024)
    expect(batches.flat()).toHaveLength(1000)
  })

  test("sends nothing for nothing", () => {
    expect(importBatches([])).toEqual([])
  })
})
