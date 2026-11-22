import { ObjectId, type ChangeStream, type ChangeStreamDocument, type Document } from "mongodb"
import { importedEntries, importedVersion, IMPORTED_MAX_DURATION } from "@/lib/server/imports"
import { hasMongo, logs } from "@/lib/server/mongo"
import type { Status } from "@/lib/stats/types"

/**
 * a log reduced to what the stats need, times in epoch ms
 */
export type Entry = {
  start: number
  end: number
  project: string
  language: string
  editor: string
  os: string
  branch: string
  file: string
}

type Listener = () => void

/**
 * loaded logs, swapped as a whole on reload so readers never see a partial copy
 */
type Data = {
  entries: Entry[]
  // every seen document by id, null for malformed ones so drift checks still line up
  byId: Map<string, Entry | null>
  latestId: ObjectId | null
  sorted: boolean
  // entries deleted or replaced in place, dropped from the list on the next read
  removed: Set<Entry>
  // longest entry seen, bounds how far back a log can reach into a day
  maxDuration: number
}

/**
 * most appends kept for caches to catch up on, past this they rebuild instead
 */
const MAX_APPENDED = 50_000

const RETRY_INTERVAL = 10_000

/**
 * how often to retry a server without change streams, in case it became a replica set
 */
const UNSUPPORTED_RETRY = 60_000

/**
 * how long to keep watching after the last subscriber leaves
 */
const IDLE_GRACE = 30_000

/**
 * re-read ids this far back, editors on skewed clocks insert slightly older ids
 */
const LOOKBACK_SECONDS = 10 * 60

/**
 * mongo error code for change streams on a standalone server
 */
const CHANGE_STREAM_UNSUPPORTED = 40573

const PROJECTION = {
  name: 1,
  project: 1,
  timestamp: 1,
  duration: 1,
  language: 1,
  os: 1,
  gitBranch: 1,
  editor: 1,
}

type State = {
  data: Data
  // bumped whenever logs change other than by being added, caches rebuild then
  structure: number
  // logs added since the last structural change, in arrival order, caches catch up on them
  appended: Entry[]
  loaded: boolean
  // logs kept from before an idle stop, not trusted until caught up
  catchingUp: boolean
  status: Status
  holders: number
  // bumped on every stop, stale loops compare against it and bail
  epoch: number
  running: boolean
  stream: ChangeStream | null
  timer: ReturnType<typeof setTimeout> | null
  idleTimer: ReturnType<typeof setTimeout> | null
  notifyTimer: ReturnType<typeof setTimeout> | null
  reloadTimer: ReturnType<typeof setTimeout> | null
  queue: Promise<void>
  listeners: Set<Listener>
  dispose?: () => void
}

/**
 * empty data set
 *
 * @returns {Data} data
 */
const empty = (): Data => ({
  entries: [],
  byId: new Map(),
  latestId: null,
  sorted: true,
  removed: new Set(),
  maxDuration: 0,
})

// stop the watcher left behind by a previous dev reload
const globals = globalThis as typeof globalThis & { __takawebStore?: State }
globals.__takawebStore?.dispose?.()

const state: State = (globals.__takawebStore = {
  data: empty(),
  structure: 0,
  appended: [],
  loaded: false,
  catchingUp: false,
  status: hasMongo() ? { state: "connecting" } : { state: "unconfigured" },
  holders: 0,
  epoch: 0,
  running: false,
  stream: null,
  timer: null,
  idleTimer: null,
  notifyTimer: null,
  reloadTimer: null,
  queue: Promise.resolve(),
  listeners: new Set(),
})

state.dispose = stop

// interned so thousands of logs share one string per project, language and so on
const strings = new Map<string, string>()

/**
 * dedupe a string against previously seen ones
 *
 * @param value raw value
 *
 * @returns {string} shared instance
 */
function intern(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : ""
  let shared = strings.get(text)

  if (shared === undefined) {
    shared = text
    strings.set(text, shared)
  }

  return shared
}

/**
 * convert a takatime log document, skipping malformed ones
 *
 * @param doc log document
 *
 * @returns {Entry | null} entry or null
 */
function toEntry(doc: Document): Entry | null {
  const end = doc.timestamp instanceof Date ? doc.timestamp.getTime() : Date.parse(doc.timestamp)
  const duration = Number(doc.duration)

  if (!Number.isFinite(end) || !Number.isFinite(duration) || duration <= 0) {
    return null
  }

  return {
    start: end - duration * 1000,
    end,
    project: intern(doc.project),
    language: intern(doc.language),
    editor: intern(doc.editor),
    os: intern(doc.os),
    branch: intern(doc.gitBranch),
    file: intern(doc.name),
  }
}

/**
 * mark a structural change, caches rebuild from scratch on their next read
 */
function restructure() {
  state.structure++
  state.appended = []
}

/**
 * track a document, ignoring ones already seen
 *
 * @param data target data
 * @param doc log document
 *
 * @returns {boolean} whether it was added
 */
function add(data: Data, doc: Document): boolean {
  const key = String(doc._id)

  if (data.byId.has(key)) return false

  if (
    doc._id instanceof ObjectId &&
    (!data.latestId || doc._id.getTimestamp() > data.latestId.getTimestamp())
  ) {
    data.latestId = doc._id
  }

  // malformed logs still count towards ids so drift checks line up
  const entry = toEntry(doc)
  data.byId.set(key, entry)

  if (!entry) return true

  const last = data.entries.at(-1)
  if (last && entry.start < last.start) data.sorted = false

  data.entries.push(entry)
  data.maxDuration = Math.max(data.maxDuration, entry.end - entry.start)

  // live data only, a reload swaps in a new set and restructures anyway
  if (data === state.data) {
    if (state.appended.length >= MAX_APPENDED) restructure()
    else state.appended.push(entry)
  }

  return true
}

/**
 * forget a document, after it was deleted or before it is replaced
 *
 * @param data target data
 * @param id document id
 *
 * @returns {boolean} whether it was known
 */
function remove(data: Data, id: unknown): boolean {
  const key = String(id)

  if (!data.byId.has(key)) return false

  const entry = data.byId.get(key)
  data.byId.delete(key)

  if (entry) data.removed.add(entry)

  return true
}

/**
 * set the status and tell listeners
 *
 * @param status new status
 */
function setStatus(status: Status) {
  if (JSON.stringify(status) === JSON.stringify(state.status)) return

  state.status = status
  for (const listener of state.listeners) listener()
}

/**
 * tell listeners the data changed, batching bursts of inserts
 */
function notify() {
  if (state.notifyTimer) return

  state.notifyTimer = setTimeout(() => {
    state.notifyTimer = null
    for (const listener of state.listeners) listener()
  }, 150)
}

/**
 * read the whole collection into a fresh data set
 */
async function reload() {
  const data = empty()

  for await (const doc of logs().find({}, { projection: PROJECTION })) {
    add(data, doc)
  }

  state.data = data
  state.loaded = true
  restructure()
}

/**
 * fetch logs newer than the last seen one, falling back to a reload on drift
 *
 * @returns {Promise<boolean>} whether anything changed
 */
async function catchUp(): Promise<boolean> {
  if (!state.loaded) {
    await reload()
    return true
  }

  const { data } = state
  let changed = false

  if (data.latestId) {
    const since = ObjectId.createFromTime(data.latestId.getTimestamp().getTime() / 1000 - LOOKBACK_SECONDS)

    const cursor = logs().find({ _id: { $gt: since } }, { projection: PROJECTION })
    for await (const doc of cursor) changed = add(data, doc) || changed
  }

  // deletes or inserts we could not see, start over
  // an exact count, collection metadata can be off after an unclean shutdown and cause endless reloads
  if ((await logs().countDocuments({})) !== data.byId.size) {
    await reload()
    return true
  }

  return changed
}

/**
 * run a sync step once the previous one finished
 *
 * @param full whether to reload everything
 *
 * @returns {Promise<void>} completion
 */
function sync(full: boolean): Promise<void> {
  const run = async () => {
    const changed = full ? (await reload(), true) : await catchUp()
    if (changed) notify()
  }

  state.queue = state.queue.then(run, run)

  return state.queue
}

/**
 * reload once a burst of edits or deletes settles
 *
 * @param epoch watcher epoch
 */
function requestReload(epoch: number) {
  if (state.reloadTimer) clearTimeout(state.reloadTimer)

  state.reloadTimer = setTimeout(() => {
    state.reloadTimer = null
    if (epoch === state.epoch) sync(true).catch((error) => fail(epoch, error))
  }, 1000)
}

/**
 * schedule the next watcher step
 *
 * @param fn step
 * @param delay delay in ms
 */
function schedule(fn: () => void, delay: number) {
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(fn, delay)
}

/**
 * report a failure and try again later
 *
 * @param epoch watcher epoch
 * @param error cause
 */
function fail(epoch: number, error: unknown) {
  if (epoch !== state.epoch) return

  const message = error instanceof Error ? error.message : String(error)
  console.error(`[takaweb] mongo watcher: ${message}`)

  setStatus({ state: "error", message: "Cannot reach the TakaTime database" })
  schedule(() => start(epoch), RETRY_INTERVAL)
}

/**
 * apply one change stream event in place, only unusual events need a reload
 *
 * @param change change event
 * @param epoch watcher epoch
 */
function apply(change: ChangeStreamDocument, epoch: number) {
  const { data } = state

  switch (change.operationType) {
    case "insert":
      if (add(data, change.fullDocument)) notify()
      return

    case "delete":
      if (remove(data, change.documentKey._id)) {
        restructure()
        notify()
      }
      return

    case "update":
    case "replace": {
      // the document as it is now, missing when it was deleted again since
      const doc = change.fullDocument
      const removed = remove(data, change.documentKey._id)
      const added = doc ? add(data, doc) : false

      if (removed || added) {
        restructure()
        notify()
      }
      return
    }

    default:
      // drops, renames and invalidations, start over
      requestReload(epoch)
  }
}

/**
 * follow the change stream, the only way mongo pushes changes
 *
 * @param epoch watcher epoch
 */
async function stream(epoch: number) {
  // updates come with the whole document, so they apply in place
  const changes = logs().watch([], { fullDocument: "updateLookup" })
  state.stream = changes

  try {
    // opens the cursor, so nothing inserted from here on is missed
    let change = await changes.tryNext()

    await sync(false)
    if (epoch === state.epoch) setStatus({ state: "ready" })

    while (epoch === state.epoch) {
      if (change) apply(change, epoch)

      change = await changes.next()
    }
  } catch (error) {
    if (epoch !== state.epoch) return

    // standalone servers keep the data loaded once, but cannot go live
    if ((error as { code?: number }).code === CHANGE_STREAM_UNSUPPORTED) {
      console.error("[takaweb] live updates need mongo to run as a replica set, see compose.yml")

      setStatus({ state: "unsupported" })
      schedule(() => void stream(epoch), UNSUPPORTED_RETRY)
      return
    }

    fail(epoch, error)
  } finally {
    await changes.close().catch(() => {})
    if (state.stream === changes) state.stream = null
  }
}

/**
 * trust kept logs again once a restart caught up, or failed to
 */
function settle() {
  if (!state.catchingUp) return

  state.catchingUp = false
  for (const listener of state.listeners) listener()
}

/**
 * load the logs and start watching for changes
 *
 * @param epoch watcher epoch
 */
async function start(epoch: number) {
  if (epoch !== state.epoch) return

  try {
    await sync(!state.loaded)

    // a newer restart owns the catch up, let it settle once it is in sync
    if (epoch !== state.epoch) return

    settle()
    void stream(epoch)
  } catch (error) {
    if (epoch !== state.epoch) return

    // the last known logs beat nothing while the database is unreachable
    settle()
    fail(epoch, error)
  }
}

/**
 * stop watching, keeping the loaded logs for the next subscriber
 */
function stop() {
  state.epoch++
  state.running = false

  for (const timer of [state.timer, state.idleTimer, state.reloadTimer]) {
    if (timer) clearTimeout(timer)
  }

  state.timer = null
  state.idleTimer = null
  state.reloadTimer = null

  void state.stream?.close().catch(() => {})
  state.stream = null
}

/**
 * keep the store live while held
 *
 * @returns {() => void} release
 */
export function retain(): () => void {
  if (!hasMongo()) return () => {}

  state.holders++

  if (state.idleTimer) {
    clearTimeout(state.idleTimer)
    state.idleTimer = null
  }

  if (!state.running) {
    state.running = true
    state.catchingUp = state.loaded
    if (state.status.state !== "ready") setStatus({ state: "connecting" })
    void start(state.epoch)
  }

  let released = false

  return () => {
    if (released) return
    released = true

    if (--state.holders > 0) return
    state.idleTimer = setTimeout(stop, IDLE_GRACE)
  }
}

/**
 * listen for data or status changes
 *
 * @param listener callback
 *
 * @returns {() => void} unsubscribe
 */
export function subscribe(listener: Listener): () => void {
  state.listeners.add(listener)

  return () => state.listeners.delete(listener)
}

// mongo and imported logs combined, rebuilt when either changes
let merged: {
  data: Data
  entries: Entry[]
  length: number
  version: number
  merged: Entry[]
} | null = null

/**
 * merge two lists ordered by start
 *
 * @param a first list
 * @param b second list
 *
 * @returns {Entry[]} merged list
 */
function mergeSorted(a: readonly Entry[], b: readonly Entry[]): Entry[] {
  const out: Entry[] = new Array(a.length + b.length)
  let i = 0
  let j = 0
  let k = 0

  while (i < a.length && j < b.length) {
    out[k++] = a[i].start <= b[j].start ? a[i++] : b[j++]
  }
  while (i < a.length) out[k++] = a[i++]
  while (j < b.length) out[k++] = b[j++]

  return out
}

/**
 * all logs ordered by start, takatime's own and imported ones
 *
 * @returns {readonly Entry[]} entries
 */
export function entries(): readonly Entry[] {
  const { data } = state

  if (data.removed.size) {
    data.entries = data.entries.filter((entry) => !data.removed.has(entry))
    data.removed.clear()
  }

  if (!data.sorted) {
    data.entries.sort((a, b) => a.start - b.start)
    data.sorted = true
  }

  const imported = importedEntries()
  if (!imported.length) return data.entries

  const version = importedVersion()

  if (
    merged?.data !== data ||
    merged.entries !== data.entries ||
    merged.length !== data.entries.length ||
    merged.version !== version
  ) {
    merged = {
      data,
      entries: data.entries,
      length: data.entries.length,
      version,
      merged: mergeSorted(data.entries, imported),
    }
  }

  return merged.merged
}

/**
 * what changed since a cache last read the logs
 * a different structure or imports version means rebuilding, otherwise only appended logs are new
 *
 * @returns {{ structure: number; imports: number; appended: readonly Entry[] }} changes
 */
export const changes = (): { structure: number; imports: number; appended: readonly Entry[] } => ({
  structure: state.structure,
  imports: importedVersion(),
  appended: state.appended,
})

/**
 * longest log, takatime's own or imported, in ms
 * logs reaching into a span start at most this long before it
 *
 * @returns {number} ms
 */
export const maxDuration = (): number =>
  Math.max(state.data.maxDuration, importedEntries().length ? IMPORTED_MAX_DURATION : 0)

/**
 * tell listeners imported logs changed, so dashboards pick them up
 */
export const importsChanged = (): void => notify()

/**
 * wait for the first load, or for it to fail
 *
 * @param timeout max wait in ms
 *
 * @returns {Promise<void>} settles once there is something to show
 */
export function whenReady(timeout: number): Promise<void> {
  const settled = () => isLoaded() || ["error", "unconfigured"].includes(state.status.state)

  if (settled()) return Promise.resolve()

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      unsubscribe()
      resolve()
    }

    const timer = setTimeout(done, timeout)
    const unsubscribe = subscribe(() => settled() && done())
  })
}

/**
 * whether the first load finished
 *
 * @returns {boolean} loaded
 */
export const isLoaded = (): boolean => state.loaded && !state.catchingUp

/**
 * current data source status
 *
 * @returns {Status} status
 */
export const status = (): Status => state.status
