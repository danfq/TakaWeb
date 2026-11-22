import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createWriteStream } from "node:fs"
import { createGzip } from "node:zlib"
import { describe, expect, test } from "vitest"
import { tar, zip } from "@/lib/server/archive"

const dir = mkdtempSync(join(tmpdir(), "takaweb-archive-"))

// text that compresses, bytes that do not, and an empty file
const files = [
  {
    name: "text.json",
    path: join(dir, "text.json"),
    body: Buffer.from(JSON.stringify({ hello: "wörld" }).repeat(5000)),
  },
  {
    name: "random.bin",
    path: join(dir, "random.bin"),
    body: Buffer.from(Array.from({ length: 70_001 }, (_, index) => (index * 7919) % 251)),
  },
  { name: "empty.txt", path: join(dir, "empty.txt"), body: Buffer.alloc(0) },
]

for (const file of files) writeFileSync(file.path, file.body)

/**
 * run a tool and fail with its output when it fails
 *
 * @param command command
 * @param args arguments
 * @param cwd working directory
 *
 * @returns {string} output
 */
function run(command: string, args: string[], cwd = dir): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`)

  return result.stdout
}

describe("archives", () => {
  test("zip files that unzip tests and extracts intact", async () => {
    const archive = join(dir, "out.zip")
    await pipeline(Readable.from(zip(files)), createWriteStream(archive))

    expect(run("unzip", ["-t", archive])).toMatch(/No errors detected/)

    const target = mkdtempSync(join(dir, "zip-"))
    run("unzip", ["-q", archive, "-d", target])

    for (const file of files) expect(readFileSync(join(target, file.name)).equals(file.body)).toBe(true)
  })

  test("gzipped tarballs that tar lists and extracts intact", async () => {
    const archive = join(dir, "out.tar.gz")
    await pipeline(Readable.from(tar(files)), createGzip(), createWriteStream(archive))

    expect(run("tar", ["-tzf", archive]).trim().split("\n")).toEqual(files.map((file) => file.name))

    const target = mkdtempSync(join(dir, "tar-"))
    run("tar", ["-xzf", archive, "-C", target])

    for (const file of files) expect(readFileSync(join(target, file.name)).equals(file.body)).toBe(true)
  })

  test("refuse tar names longer than the header holds", async () => {
    const long = [{ name: "x".repeat(101), path: files[0].path }]

    await expect(async () => {
      for await (const chunk of tar(long)) void chunk
    }).rejects.toThrow(/too long/)
  })
})
