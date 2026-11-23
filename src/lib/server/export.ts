import { createReadStream, createWriteStream } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
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
 * every takatime log, one document per line, or null without a database
 *
 * @returns {AsyncGenerator<string>} json text
 */
async function* logLines(): AsyncGenerator<string> {
  if (!hasMongo()) {
    yield "null"
    return
  }

  yield "["
  let first = true

  for await (const doc of logs().find({}, { sort: { _id: 1 } })) {
    yield `${first ? "\n" : ",\n"}${JSON.stringify(doc)}`
    first = false
  }

  yield first ? "]" : "\n]"
}

/**
 * every imported heartbeat grouped by source
 *
 * @returns {Generator<string>} json text
 */
function* importedLines(): Generator<string> {
  const rows = db
    .prepare(
      `SELECT source, time, file, project, language, branch, editor, os, boundary
       FROM imported_heartbeat ORDER BY source, time, file`
    )
    .iterate() as Iterable<Record<string, unknown> & { source: string; boundary: number }>

  yield "{"
  let source: string | null = null

  for (const { source: from, boundary, ...beat } of rows) {
    if (from !== source) {
      yield `${source === null ? "" : "\n],"}\n${JSON.stringify(from)}: [\n`
      source = from
    } else {
      yield ",\n"
    }

    yield JSON.stringify({ ...beat, boundary: !!boundary })
  }

  yield source === null ? "}" : "\n]\n}"
}

/**
 * the whole json export, piece by piece
 *
 * @param userId account to export settings of
 * @param now export time
 *
 * @returns {AsyncGenerator<string>} json text
 */
async function* exportJson(userId: number, now: Date): AsyncGenerator<string> {
  yield `{\n"takaweb": ${JSON.stringify({ version: EXPORT_VERSION, exportedAt: now.toISOString() })},\n`
  yield `"settings": ${JSON.stringify(getSettings(userId))},\n`
  yield `"logs": `
  yield* logLines()
  yield `,\n"imported": `
  yield* importedLines()
  yield "\n}\n"
}

/**
 * write the json export to a file, nothing large is ever held in memory
 * the pipeline waits whenever the file falls behind and fails cleanly when it errors
 *
 * @param path file path
 * @param userId account to export settings of
 * @param now export time
 *
 * @returns {Promise<void>} resolves once written
 */
const writeJson = (path: string, userId: number, now: Date): Promise<void> =>
  pipeline(Readable.from(exportJson(userId, now)), createWriteStream(path))

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
