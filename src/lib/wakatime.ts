import type { JsonKind, JsonPath, Visit } from "@/lib/json-stream"

/**
 * a wakatime heartbeat as the import sends it, time in epoch ms
 * the server joins every heartbeat it holds into logs, so exports overlapping in any order add up the same
 */
export type ImportHeartbeat = {
  time: number
  file: string
  project: string
  language: string
  branch: string
  editor: string
  os: string
}

/**
 * wakatime user agents keyed by id, as looked up through its api
 */
export type Agents = Record<string, { editor: string; os: string; value: string }>

/**
 * wakatime's default keystroke timeout in seconds, longer gaps between heartbeats are breaks
 */
export const IMPORT_TIMEOUT = 15 * 60

/**
 * most heartbeats the import sends at once
 */
export const IMPORT_BATCH = 2000

/**
 * longest text the server takes per heartbeat field, the parser clips to these so a batch is never rejected
 */
export const IMPORT_LIMITS = {
  file: 4096,
  project: 512,
  language: 256,
  branch: 512,
  editor: 256,
  os: 64,
} as const

/**
 * earliest heartbeat the import takes, epoch ms
 */
export const IMPORT_SINCE = Date.UTC(2000, 0, 1)

/**
 * whether a heartbeat time is a real date the dashboard can show, a day of clock skew is fine
 *
 * @param time epoch ms
 *
 * @returns {boolean} in range
 */
export const inRange = (time: number): boolean =>
  Number.isSafeInteger(time) && time >= IMPORT_SINCE && time <= Date.now() + 86_400_000

/**
 * cut text down to a length
 *
 * @param value text
 * @param max longest length
 *
 * @returns {string} text, at most max long
 */
const clip = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value)

/**
 * most bytes one import request carries, well under astro's 1 MB action body limit
 */
const IMPORT_BATCH_BYTES = 512 * 1024

const encoder = new TextEncoder()

/**
 * split heartbeats into requests bounded by both count and size, long file paths fill a request sooner
 *
 * @param heartbeats heartbeats
 *
 * @returns {ImportHeartbeat[][]} batches, in order
 */
export function importBatches(heartbeats: ImportHeartbeat[]): ImportHeartbeat[][] {
  const batches: ImportHeartbeat[][] = []
  let batch: ImportHeartbeat[] = []
  let bytes = 0

  for (const beat of heartbeats) {
    // plus a comma between entries
    const size = encoder.encode(JSON.stringify(beat)).length + 1

    if (batch.length && (batch.length === IMPORT_BATCH || bytes + size > IMPORT_BATCH_BYTES)) {
      batches.push(batch)
      batch = []
      bytes = 0
    }

    batch.push(beat)
    bytes += size
  }

  if (batch.length) batches.push(batch)

  return batches
}

/**
 * what logs get when the export cannot name their editor or os
 */
export const UNKNOWN = "unknown"

/**
 * wakatime os names mapped to takatime's, which records go's GOOS
 */
const SYSTEMS: Record<string, string> = {
  mac: "darwin",
  macos: "darwin",
  darwin: "darwin",
  linux: "linux",
  windows: "windows",
  freebsd: "freebsd",
}

type Agent = { editor: string; os: string }

/**
 * read a string field
 *
 * @param value raw value
 *
 * @returns {string} trimmed string, empty when missing
 */
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

/**
 * takatime's name for an os
 *
 * @param os wakatime os
 *
 * @returns {string} os
 */
const system = (os: string): string => SYSTEMS[os.toLowerCase()] ?? (os.toLowerCase() || UNKNOWN)

/**
 * pull the editor and os out of a wakatime user agent string
 * e.g. wakatime/v1.90.0 (darwin-24.1.0-arm64) go1.23.1 vscode/1.95.0 vscode-wakatime/24.6.0
 *
 * @param value user agent
 *
 * @returns {Agent} editor and os
 */
function parseAgent(value: string): Agent {
  const os = value.match(/\(([a-z]+)[-)]/i)?.[1] ?? ""
  const editor =
    value
      .replace(/^.*?\)\s*/, "")
      .split(/\s+/)
      .find((token) => token && !/^go\d/.test(token))
      ?.split("/")[0] ?? ""

  return { editor: editor || UNKNOWN, os: system(os) }
}

/**
 * read user agents keyed by id, from an export's list or an api lookup
 *
 * @param list user agents, an array or an object keyed by id
 * @param agents where to put them
 */
function readAgents(list: unknown, agents: Map<string, Agent>) {
  const entries = Array.isArray(list)
    ? list
    : list && typeof list === "object"
      ? Object.entries(list).map(([id, entry]) => ({ id, ...(entry as object) }))
      : []

  for (const entry of entries as Record<string, unknown>[]) {
    const id = text(entry?.id)
    if (!id) continue

    const parsed = parseAgent(text(entry.value))
    agents.set(id, {
      editor: text(entry.editor) || parsed.editor,
      os: text(entry.os) ? system(text(entry.os)) : parsed.os,
    })
  }
}

/**
 * a heartbeat read from the export, its editor and os resolved once every user agent is known
 */
type Pending = Omit<ImportHeartbeat, "editor" | "os"> & { agent: Agent | string }

/**
 * reads a wakatime heartbeats export one day at a time, so huge exports never sit in memory whole
 * the server joins heartbeats into logs, so isolated ones are kept too: another export can fill the gap around them
 */
export class ExportReader {
  // user agents listed by the export, it may list them after the days
  private readonly listed = new Map<string, Agent>()
  private readonly looked = new Map<string, Agent>()
  // keyed like the server stores them, a repeated heartbeat is sent once
  private readonly heartbeats = new Map<string, Pending>()
  private sawDays = false
  private days = 0

  /**
   * @param looked user agents looked up through the api, names editors and systems
   */
  constructor(looked: Agents = {}) {
    readAgents(
      Object.entries(looked).map(([id, entry]) => ({ id, ...entry })),
      this.looked
    )
  }

  /**
   * what to do with each part of the export, for a streaming parser
   *
   * @param path where the value sits
   * @param kind what the value is
   *
   * @returns {Visit} capture days and user agents, skip everything else
   */
  visit = (path: JsonPath, kind: JsonKind): Visit => {
    if (path.length === 0) return kind === "object" ? "descend" : "skip"

    if (path.length === 1 && path[0] === "days") {
      this.sawDays = kind === "array"
      return this.sawDays ? "descend" : "skip"
    }

    if (path.length === 2 && path[0] === "days") return "capture"
    if (path.length === 1 && path[0] === "user_agents") return "capture"

    return "skip"
  }

  /**
   * take a value a streaming parser captured
   *
   * @param path where it sat
   * @param value parsed value
   */
  value = (path: JsonPath, value: unknown) => {
    if (path[0] === "days") this.day(value)
    else if (path[0] === "user_agents") readAgents(value, this.listed)
  }

  /**
   * take a whole parsed export
   *
   * @param raw parsed export json
   */
  document(raw: unknown) {
    const data = raw as Record<string, unknown>
    if (!data || typeof data !== "object") return

    if (Array.isArray(data.days)) {
      this.sawDays = true
      for (const day of data.days) this.day(day)
    }

    readAgents(data.user_agents, this.listed)
  }

  /**
   * take one day of the export
   *
   * @param raw day
   */
  private day(raw: unknown) {
    this.days++

    const day = raw as Record<string, unknown>
    if (!Array.isArray(day?.heartbeats)) return

    for (const beat of day.heartbeats as Record<string, unknown>[]) {
      const time = Number(beat?.time)
      const file = text(beat?.entity)

      // only editor activity, the browser extension and desktop app log domains and apps
      if (!Number.isFinite(time) || !file || (beat.type && beat.type !== "file")) continue

      const heartbeat: Pending = {
        time: Math.round(time * 1000),
        file: clip(file, IMPORT_LIMITS.file),
        project: clip(text(beat.project) || UNKNOWN, IMPORT_LIMITS.project),
        language: clip(text(beat.language) || UNKNOWN, IMPORT_LIMITS.language),
        branch: clip(text(beat.branch), IMPORT_LIMITS.branch),
        // a user agent string names it right away, an id waits for the list
        agent: text(beat.user_agent) ? parseAgent(text(beat.user_agent)) : text(beat.user_agent_id),
      }

      // the server rejects a whole batch over one bad date, so they never leave the browser
      if (!inRange(heartbeat.time)) continue

      this.heartbeats.set(`${heartbeat.time}:${heartbeat.file}`, heartbeat)
    }
  }

  /**
   * every heartbeat read, with editors and systems named
   *
   * @returns {ImportHeartbeat[]} heartbeats, oldest first, one per file and millisecond
   */
  finish(): ImportHeartbeat[] {
    if (!this.sawDays) throw new Error("This is not a WakaTime heartbeats export, it has no days")

    if (!this.heartbeats.size && this.days) {
      throw new Error("No editor heartbeats found, export heartbeats rather than daily totals")
    }

    const unknown: Agent = { editor: UNKNOWN, os: UNKNOWN }
    const out: ImportHeartbeat[] = []

    for (const { agent, ...beat } of this.heartbeats.values()) {
      // looked up agents win, the export's own list may be stale
      const resolved =
        typeof agent === "string" ? (this.looked.get(agent) ?? this.listed.get(agent) ?? unknown) : agent

      out.push({
        ...beat,
        editor: clip(resolved.editor, IMPORT_LIMITS.editor),
        os: clip(resolved.os, IMPORT_LIMITS.os),
      })
    }

    this.heartbeats.clear()

    return out.sort((a, b) => a.time - b.time || (a.file < b.file ? -1 : 1))
  }
}

/**
 * read the editor heartbeats out of a parsed wakatime heartbeats export
 *
 * @param raw parsed export json
 * @param looked user agents looked up through the api, names editors and systems
 *
 * @returns {ImportHeartbeat[]} heartbeats, oldest first, one per file and millisecond
 */
export function parseExport(raw: unknown, looked: Agents = {}): ImportHeartbeat[] {
  const reader = new ExportReader(looked)
  reader.document(raw)

  return reader.finish()
}
