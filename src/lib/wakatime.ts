/**
 * a wakatime heartbeat turned into a takatime log, times in epoch ms
 */
export type ImportLog = {
  // wakatime heartbeat id, imports skip ids already stored
  id: string
  file: string
  project: string
  language: string
  branch: string
  editor: string
  os: string
  end: number
  // seconds
  duration: number
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
 * most logs the import sends at once
 */
export const IMPORT_BATCH = 2000

/**
 * most bytes one import request carries, well under astro's 1 MB action body limit
 */
const IMPORT_BATCH_BYTES = 512 * 1024

const encoder = new TextEncoder()

/**
 * split logs into requests bounded by both count and size, long file paths fill a request sooner
 *
 * @param logs logs
 *
 * @returns {ImportLog[][]} batches, in order
 */
export function importBatches(logs: ImportLog[]): ImportLog[][] {
  const batches: ImportLog[][] = []
  let batch: ImportLog[] = []
  let bytes = 0

  for (const log of logs) {
    // plus a comma between entries
    const size = encoder.encode(JSON.stringify(log)).length + 1

    if (batch.length && (batch.length === IMPORT_BATCH || bytes + size > IMPORT_BATCH_BYTES)) {
      batches.push(batch)
      batch = []
      bytes = 0
    }

    batch.push(log)
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

type Heartbeat = {
  id: string
  time: number
  file: string
  project: string
  language: string
  branch: string
  agent: Agent
}

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
 * resolve user agents by id, from the api lookup and from the export when it lists them
 *
 * @param raw export
 * @param looked up agents from the api
 *
 * @returns {Map<string, Agent>} agents
 */
function readAgents(raw: Record<string, unknown>, looked: Agents): Map<string, Agent> {
  const agents = new Map<string, Agent>()
  const list = raw.user_agents

  const entries = [
    ...(Array.isArray(list)
      ? list
      : list && typeof list === "object"
        ? Object.entries(list).map(([id, entry]) => ({ id, ...(entry as object) }))
        : []),
    ...Object.entries(looked).map(([id, entry]) => ({ id, ...entry })),
  ]

  for (const entry of entries as Record<string, unknown>[]) {
    const id = text(entry?.id)
    if (!id) continue

    const parsed = parseAgent(text(entry.value))
    agents.set(id, {
      editor: text(entry.editor) || parsed.editor,
      os: text(entry.os) ? system(text(entry.os)) : parsed.os,
    })
  }

  return agents
}

/**
 * turn a wakatime heartbeats export into takatime logs
 * heartbeats are joined like wakatime does: each one lasts until the next, unless the gap is a break
 *
 * @param raw parsed export json
 * @param looked user agents looked up through the api, names editors and systems
 *
 * @returns {ImportLog[]} logs, oldest first
 */
export function parseExport(raw: unknown, looked: Agents = {}): ImportLog[] {
  const data = raw as Record<string, unknown>

  if (!data || !Array.isArray(data.days)) {
    throw new Error("This is not a WakaTime heartbeats export, it has no days")
  }

  const agents = readAgents(data, looked)
  const unknown: Agent = { editor: UNKNOWN, os: UNKNOWN }
  const heartbeats: Heartbeat[] = []

  for (const day of data.days as Record<string, unknown>[]) {
    if (!Array.isArray(day?.heartbeats)) continue

    for (const beat of day.heartbeats as Record<string, unknown>[]) {
      const time = Number(beat?.time)
      const file = text(beat?.entity)

      // only editor activity, the browser extension and desktop app log domains and apps
      if (!Number.isFinite(time) || !file || (beat.type && beat.type !== "file")) continue

      const agent = text(beat.user_agent)
        ? parseAgent(text(beat.user_agent))
        : (agents.get(text(beat.user_agent_id)) ?? unknown)

      heartbeats.push({
        id: text(beat.id) || `${time}:${file}`,
        time,
        file,
        project: text(beat.project) || UNKNOWN,
        language: text(beat.language) || UNKNOWN,
        branch: text(beat.branch),
        agent,
      })
    }
  }

  if (!heartbeats.length && (data.days as unknown[]).length) {
    throw new Error("No editor heartbeats found, export heartbeats rather than daily totals")
  }

  heartbeats.sort((a, b) => a.time - b.time)

  const logs: ImportLog[] = []

  for (let index = 0; index < heartbeats.length - 1; index++) {
    const beat = heartbeats[index]
    const gap = heartbeats[index + 1].time - beat.time

    if (gap <= 0 || gap > IMPORT_TIMEOUT) continue

    logs.push({
      id: beat.id,
      file: beat.file,
      project: beat.project,
      language: beat.language,
      branch: beat.branch,
      editor: beat.agent.editor,
      os: beat.agent.os,
      end: Math.round((beat.time + gap) * 1000),
      duration: gap,
    })
  }

  return logs
}
