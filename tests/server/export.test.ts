import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, test } from "vitest"
import { createAdmin } from "@/lib/server/auth/admin"
import { createSession } from "@/lib/server/auth/session"
import { createExport } from "@/lib/server/export"
import { importHeartbeats } from "@/lib/server/imports"
import { updateSettings } from "@/lib/server/settings"

const userId = createAdmin("hash")!
createSession(userId, { ip: "192.0.2.1", userAgent: "Firefox" })
updateSettings(userId, { hideNames: true })
importHeartbeats([
  {
    time: Date.UTC(2025, 0, 1),
    file: "/a.ts",
    project: "p",
    language: "l",
    branch: "",
    editor: "e",
    os: "o",
  },
  {
    time: Date.UTC(2025, 0, 1, 0, 5),
    file: "/a.ts",
    project: "p",
    language: "l",
    branch: "",
    editor: "e",
    os: "o",
  },
])

/**
 * read a whole body
 *
 * @param body stream
 *
 * @returns {Promise<Buffer>} bytes
 */
async function read(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  for await (const chunk of body) chunks.push(chunk)

  return Buffer.concat(chunks)
}

describe("export", () => {
  test("writes everything as one json document", async () => {
    const { body, filename } = await createExport("json", userId)
    const data = JSON.parse((await read(body)).toString("utf8"))

    expect(filename).toMatch(/^takaweb-export-\d{4}-\d{2}-\d{2}\.json$/)
    expect(data.takaweb).toMatchObject({ version: 1 })
    expect(data.settings.hideNames).toBe(true)
    // no takatime database is configured in tests
    expect(data.logs).toBeNull()
    expect(data.imported.wakatime).toHaveLength(2)
    expect(data.imported.wakatime[0]).toMatchObject({ file: "/a.ts", boundary: false })
  })

  test("archives the json with a database copy that has no sessions", async () => {
    const { body, filename } = await createExport("zip", userId)
    const dir = mkdtempSync(join(tmpdir(), "takaweb-export-test-"))
    const archive = join(dir, filename)

    writeFileSync(archive, await read(body))
    expect(spawnSync("unzip", ["-q", archive, "-d", dir]).status).toBe(0)

    expect(JSON.parse(readFileSync(join(dir, "takaweb-export.json"), "utf8")).settings.hideNames).toBe(true)
    expect(readFileSync(join(dir, "README.txt"), "utf8")).toMatch(/restore/)

    const copy = new DatabaseSync(join(dir, "takaweb.db"))
    expect(copy.prepare("SELECT COUNT(*) AS count FROM session").get()).toEqual({ count: 0 })
    expect(copy.prepare("SELECT COUNT(*) AS count FROM imported_heartbeat").get()).toEqual({ count: 2 })
    expect(copy.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 1 })
    copy.close()
  })

  test("archives as a gzipped tarball", async () => {
    const { body, filename } = await createExport("tar.gz", userId)
    const dir = mkdtempSync(join(tmpdir(), "takaweb-export-test-"))
    const archive = join(dir, filename)

    writeFileSync(archive, await read(body))

    const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" })
    expect(listing.stdout.trim().split("\n")).toEqual(["README.txt", "takaweb-export.json", "takaweb.db"])
  })
})
