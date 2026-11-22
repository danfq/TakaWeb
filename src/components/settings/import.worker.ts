/// <reference lib="webworker" />
import { JsonScanner } from "@/lib/json-stream"
import { ExportReader, UNKNOWN, importBatches, type Agents, type ImportHeartbeat } from "@/lib/wakatime"

/**
 * runs a wakatime import off the main thread: reads the export as a stream, then sends it in batches
 * the tab stays responsive however large the export is
 */

declare const self: DedicatedWorkerGlobalScope

export type ImportRequest = { file: File; agents: Agents }

export type ImportMessage =
  | { type: "reading"; read: number; size: number }
  | { type: "sending"; sent: number; total: number }
  | { type: "done"; added: number; skipped: number; unnamed: number; total: number }
  | { type: "failed"; message: string; added: number }

const ENDPOINT = "/api/import/wakatime"

/**
 * longest wait between attempts when the server is busy or unreachable
 */
const MAX_BACKOFF = 30_000

/**
 * how often a batch is retried before the import gives up
 */
const MAX_ATTEMPTS = 8

/**
 * a failure worth telling the user about as is
 */
class ImportFailure extends Error {}

/**
 * tell the page how it is going
 *
 * @param message progress
 */
const post = (message: ImportMessage) => self.postMessage(message)

/**
 * wait a while
 *
 * @param ms delay
 *
 * @returns {Promise<void>} resolves after the delay
 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * stream the export through the json scanner, never holding the whole file as text
 *
 * @param file export
 * @param agents looked up user agents
 *
 * @returns {Promise<ImportHeartbeat[]>} heartbeats
 */
async function read(file: File, agents: Agents): Promise<ImportHeartbeat[]> {
  const reader = new ExportReader(agents)
  const scanner = new JsonScanner(reader.visit, reader.value)
  const decoder = new TextDecoder()
  const stream = file.stream().getReader()

  let read = 0
  let reported = 0

  for (;;) {
    const { done, value } = await stream.read()

    if (done) break

    scanner.write(decoder.decode(value, { stream: true }))
    read += value.byteLength

    // a few updates per percent are plenty
    if (read - reported > file.size / 200) {
      reported = read
      post({ type: "reading", read, size: file.size })
    }
  }

  scanner.write(decoder.decode())
  scanner.end()

  return reader.finish()
}

/**
 * send one batch, waiting out rate limits and brief outages
 *
 * @param batch heartbeats
 *
 * @returns {Promise<{ added: number; skipped: number }>} counts
 */
async function send(batch: ImportHeartbeat[]): Promise<{ added: number; skipped: number }> {
  for (let attempt = 1; ; attempt++) {
    let response: Response | null = null

    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heartbeats: batch }),
      })
    } catch {
      // unreachable, retried below
    }

    if (response?.ok) return response.json()

    if (response?.status === 401) throw new ImportFailure("Your session ended, sign in again")

    // anything but a busy or unreachable server will not get better by retrying
    const retryable = !response || response.status === 429 || response.status >= 500

    if (!retryable || attempt === MAX_ATTEMPTS) {
      const body = await response?.json().catch(() => null)

      throw new ImportFailure(
        (body as { error?: string } | null)?.error ??
          (response ? `TakaWeb answered with an error (${response.status})` : "Could not reach TakaWeb")
      )
    }

    const after = Number(response?.headers.get("Retry-After"))
    const backoff = Math.min(MAX_BACKOFF, 500 * 2 ** attempt)

    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : backoff)
  }
}

self.onmessage = async ({ data }: MessageEvent<ImportRequest>) => {
  let added = 0

  try {
    post({ type: "reading", read: 0, size: data.file.size })

    let heartbeats: ImportHeartbeat[]

    try {
      heartbeats = await read(data.file, data.agents)
    } catch (error) {
      throw new ImportFailure(
        error instanceof SyntaxError ? "This file is not valid JSON" : (error as Error).message
      )
    }

    const total = heartbeats.length
    const unnamed = heartbeats.reduce((count, beat) => count + Number(beat.editor === UNKNOWN), 0)

    let skipped = 0
    let sent = 0

    for (const batch of importBatches(heartbeats)) {
      post({ type: "sending", sent, total })

      const result = await send(batch)

      added += result.added
      skipped += result.skipped
      sent += batch.length
    }

    post({ type: "done", added, skipped, unnamed, total })
  } catch (error) {
    post({
      type: "failed",
      message: error instanceof ImportFailure ? error.message : "Something went wrong while importing",
      added,
    })
  }
}
