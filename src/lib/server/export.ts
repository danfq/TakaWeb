import { createReadStream, createWriteStream, type WriteStream } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { Readable } from "node:stream"
import { createGzip } from "node:zlib"
import { tar, zip, type ArchiveFile } from "@/lib/server/archive"
import { db } from "@/lib/server/db"
import { hasMongo, logs } from "@/lib/server/mongo"
import { getSettings } from "@/lib/server/settings"
import { EXPORT_VERSION, type ExportFormat } from "@/lib/export"

/**
 * an export ready to send, its temporary files go once the body was read or cancelled
 */
export type Export = {
  body: ReadableStream<Uint8Array>
  filename: string
}

const README = `TakaWeb export
==============

takaweb-export.json
  Your data as JSON: TakaTime logs, heartbeats imported from other trackers and your settings.

takaweb.db
  A copy of TakaWeb's own SQLite database: the admin account, settings and imported heartbeats.
  Sessions are left out, everyone signs in again after a restore.

To restore the database, stop TakaWeb, replace takaweb.db in its data directory with this copy and start it again.
TakaTime logs live in your MongoDB, restore them from a MongoDB backup instead.
`

/**
 * write a chunk, waiting when the file falls behind
 *
 * @param out file stream
 * @param chunk text
 *
 * @returns {Promise<void>} resolves once accepted
 */
function write(out: WriteStream, chunk: string): Promise<void> {
  if (out.write(chunk)) return Promise.resolve()

  return new Promise((resolve, reject) => {
    out.once("drain", resolve)
    out.once("error", reject)
  })
}

/**
 * write every takatime log, one document per line, or null without a database
 *
 * @param out file stream
 */
async function writeLogs(out: WriteStream) {
  if (!hasMongo()) return write(out, "null")

  await write(out, "[")
  let first = true

  for await (const doc of logs().find({}, { sort: { _id: 1 } })) {
    await write(out, `${first ? "\n" : ",\n"}${JSON.stringify(doc)}`)
    first = false
  }

  await write(out, first ? "]" : "\n]")
}

/**
 * write every imported heartbeat grouped by source
 *
 * @param out file stream
 */
async function writeImported(out: WriteStream) {
  const rows = db
    .prepare(
      `SELECT source, time, file, project, language, branch, editor, os, boundary
       FROM imported_heartbeat ORDER BY source, time, file`
    )
    .iterate() as Iterable<Record<string, unknown> & { source: string; boundary: number }>

  await write(out, "{")
  let source: string | null = null

  for (const { source: from, boundary, ...beat } of rows) {
    if (from !== source) {
      await write(out, `${source === null ? "" : "\n],"}\n${JSON.stringify(from)}: [\n`)
      source = from
    } else {
      await write(out, ",\n")
    }

    await write(out, JSON.stringify({ ...beat, boundary: !!boundary }))
  }

  await write(out, source === null ? "}" : "\n]\n}")
}

/**
 * write the whole json export to a file, nothing large is ever held in memory
 *
 * @param path file path
 * @param userId account to export settings of
 * @param now export time
 */
async function writeJson(path: string, userId: number, now: Date) {
  const out = createWriteStream(path)
  const closed = new Promise<void>((resolve, reject) => {
    out.once("finish", resolve)
    out.once("error", reject)
  })

  try {
    await write(
      out,
      `{\n"takaweb": ${JSON.stringify({ version: EXPORT_VERSION, exportedAt: now.toISOString() })},\n`
    )
    await write(out, `"settings": ${JSON.stringify(getSettings(userId))},\n`)
    await write(out, `"logs": `)
    await writeLogs(out)
    await write(out, `,\n"imported": `)
    await writeImported(out)
    await write(out, "\n}\n")
  } finally {
    out.end()
  }

  await closed
}

/**
 * copy the database consistently, without sessions
 *
 * @param path copy path
 */
function copyDatabase(path: string) {
  // a consistent snapshot even while takaweb keeps writing
  db.prepare("VACUUM INTO ?").run(path)

  const copy = new DatabaseSync(path)

  try {
    copy.exec("DELETE FROM session")
    // clears the freed pages, so no session hash survives in the file
    copy.exec("VACUUM")
  } finally {
    copy.close()
  }
}

/**
 * a web stream that runs cleanup once it ends, fails or the client goes away
 *
 * @param stream node stream
 * @param cleanup removes temporary files
 *
 * @returns {ReadableStream<Uint8Array>} body
 */
function cleaning(stream: Readable, cleanup: () => Promise<void>): ReadableStream<Uint8Array> {
  const chunks = stream[Symbol.asyncIterator]()

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await chunks.next()

        if (done) {
          controller.close()
          await cleanup()
        } else {
          controller.enqueue(value as Uint8Array)
        }
      } catch (error) {
        controller.error(error)
        await cleanup()
      }
    },
    async cancel() {
      stream.destroy()
      await cleanup()
    },
  })
}

/**
 * build an export in a temporary directory and stream it
 *
 * @param format export format
 * @param userId account to export
 *
 * @returns {Promise<Export>} export
 */
export async function createExport(format: ExportFormat, userId: number): Promise<Export> {
  const dir = await mkdtemp(join(tmpdir(), "takaweb-export-"))
  const cleanup = () => rm(dir, { recursive: true, force: true })

  try {
    const now = new Date()
    const stamp = now.toISOString().slice(0, 10)
    const json = join(dir, "takaweb-export.json")

    await writeJson(json, userId, now)

    if (format === "json") {
      return { body: cleaning(createReadStream(json), cleanup), filename: `takaweb-export-${stamp}.json` }
    }

    const database = join(dir, "takaweb.db")
    const readme = join(dir, "README.txt")

    copyDatabase(database)
    await writeFile(readme, README)

    const files: ArchiveFile[] = [
      { name: "README.txt", path: readme, modified: now },
      { name: "takaweb-export.json", path: json, modified: now },
      { name: "takaweb.db", path: database, modified: now },
    ]

    const stream = format === "zip" ? Readable.from(zip(files)) : Readable.from(tar(files)).pipe(createGzip())

    return { body: cleaning(stream, cleanup), filename: `takaweb-export-${stamp}.${format}` }
  } catch (error) {
    await cleanup()
    throw error
  }
}
