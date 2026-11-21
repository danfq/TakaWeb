import { ObjectId, type ChangeStream, type Document } from "mongodb";
import { hasMongo, logs } from "@/lib/server/mongo";
import type { Status } from "@/lib/stats/types";

/**
 * a log reduced to what the stats need, times in epoch ms
 */
export type Entry = {
  start: number;
  end: number;
  project: string;
  language: string;
  editor: string;
  os: string;
  branch: string;
  file: string;
};

type Listener = () => void;

/**
 * loaded logs, swapped as a whole on reload so readers never see a partial copy
 */
type Data = {
  entries: Entry[];
  ids: Set<string>;
  latestId: ObjectId | null;
  sorted: boolean;
};

const RETRY_INTERVAL = 10_000;

/**
 * how often to retry a server without change streams, in case it became a replica set
 */
const UNSUPPORTED_RETRY = 60_000;

/**
 * how long to keep watching after the last subscriber leaves
 */
const IDLE_GRACE = 30_000;

/**
 * re-read ids this far back, editors on skewed clocks insert slightly older ids
 */
const LOOKBACK_SECONDS = 10 * 60;

/**
 * mongo error code for change streams on a standalone server
 */
const CHANGE_STREAM_UNSUPPORTED = 40573;

const PROJECTION = {
  name: 1,
  project: 1,
  timestamp: 1,
  duration: 1,
  language: 1,
  os: 1,
  gitBranch: 1,
  editor: 1,
};

type State = {
  data: Data;
  loaded: boolean;
  status: Status;
  holders: number;
  // bumped on every stop, stale loops compare against it and bail
  epoch: number;
  running: boolean;
  stream: ChangeStream | null;
  timer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  notifyTimer: ReturnType<typeof setTimeout> | null;
  reloadTimer: ReturnType<typeof setTimeout> | null;
  queue: Promise<void>;
  listeners: Set<Listener>;
  dispose?: () => void;
};

/**
 * empty data set
 *
 * @returns {Data} data
 */
const empty = (): Data => ({
  entries: [],
  ids: new Set(),
  latestId: null,
  sorted: true,
});

// stop the watcher left behind by a previous dev reload
const globals = globalThis as typeof globalThis & { __takawebStore?: State };
globals.__takawebStore?.dispose?.();

const state: State = (globals.__takawebStore = {
  data: empty(),
  loaded: false,
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
});

state.dispose = stop;

// interned so thousands of logs share one string per project, language and so on
const strings = new Map<string, string>();

/**
 * dedupe a string against previously seen ones
 *
 * @param value raw value
 *
 * @returns {string} shared instance
 */
function intern(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  let shared = strings.get(text);

  if (shared === undefined) {
    shared = text;
    strings.set(text, shared);
  }

  return shared;
}

/**
 * convert a takatime log document, skipping malformed ones
 *
 * @param doc log document
 *
 * @returns {Entry | null} entry or null
 */
function toEntry(doc: Document): Entry | null {
  const end =
    doc.timestamp instanceof Date
      ? doc.timestamp.getTime()
      : Date.parse(doc.timestamp);
  const duration = Number(doc.duration);

  if (!Number.isFinite(end) || !Number.isFinite(duration) || duration <= 0) {
    return null;
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
  };
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
  const key = String(doc._id);

  if (data.ids.has(key)) return false;
  data.ids.add(key);

  if (
    doc._id instanceof ObjectId &&
    (!data.latestId || doc._id.getTimestamp() > data.latestId.getTimestamp())
  ) {
    data.latestId = doc._id;
  }

  // malformed logs still count towards ids so drift checks line up
  const entry = toEntry(doc);
  if (!entry) return true;

  const last = data.entries.at(-1);
  if (last && entry.start < last.start) data.sorted = false;

  data.entries.push(entry);

  return true;
}

/**
 * set the status and tell listeners
 *
 * @param status new status
 */
function setStatus(status: Status) {
  if (JSON.stringify(status) === JSON.stringify(state.status)) return;

  state.status = status;
  for (const listener of state.listeners) listener();
}

/**
 * tell listeners the data changed, batching bursts of inserts
 */
function notify() {
  if (state.notifyTimer) return;

  state.notifyTimer = setTimeout(() => {
    state.notifyTimer = null;
    for (const listener of state.listeners) listener();
  }, 150);
}

/**
 * read the whole collection into a fresh data set
 */
async function reload() {
  const data = empty();

  for await (const doc of logs().find({}, { projection: PROJECTION })) {
    add(data, doc);
  }

  state.data = data;
  state.loaded = true;
}

/**
 * fetch logs newer than the last seen one, falling back to a reload on drift
 *
 * @returns {Promise<boolean>} whether anything changed
 */
async function catchUp(): Promise<boolean> {
  if (!state.loaded) {
    await reload();
    return true;
  }

  const { data } = state;
  let changed = false;

  if (data.latestId) {
    const since = ObjectId.createFromTime(
      data.latestId.getTimestamp().getTime() / 1000 - LOOKBACK_SECONDS,
    );

    const cursor = logs().find(
      { _id: { $gt: since } },
      { projection: PROJECTION },
    );
    for await (const doc of cursor) changed = add(data, doc) || changed;
  }

  // deletes or inserts we could not see, start over
  if ((await logs().estimatedDocumentCount()) !== data.ids.size) {
    await reload();
    return true;
  }

  return changed;
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
    const changed = full ? (await reload(), true) : await catchUp();
    if (changed) notify();
  };

  state.queue = state.queue.then(run, run);

  return state.queue;
}

/**
 * reload once a burst of edits or deletes settles
 *
 * @param epoch watcher epoch
 */
function requestReload(epoch: number) {
  if (state.reloadTimer) clearTimeout(state.reloadTimer);

  state.reloadTimer = setTimeout(() => {
    state.reloadTimer = null;
    if (epoch === state.epoch) sync(true).catch((error) => fail(epoch, error));
  }, 1000);
}

/**
 * schedule the next watcher step
 *
 * @param fn step
 * @param delay delay in ms
 */
function schedule(fn: () => void, delay: number) {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(fn, delay);
}

/**
 * report a failure and try again later
 *
 * @param epoch watcher epoch
 * @param error cause
 */
function fail(epoch: number, error: unknown) {
  if (epoch !== state.epoch) return;

  const message = error instanceof Error ? error.message : String(error);
  console.error(`[takaweb] mongo watcher: ${message}`);

  setStatus({ state: "error", message: "Cannot reach the TakaTime database" });
  schedule(() => start(epoch), RETRY_INTERVAL);
}

/**
 * follow the change stream, the only way mongo pushes changes
 *
 * @param epoch watcher epoch
 */
async function stream(epoch: number) {
  const changes = logs().watch([], { fullDocument: "default" });
  state.stream = changes;

  try {
    // opens the cursor, so nothing inserted from here on is missed
    let change = await changes.tryNext();

    await sync(false);
    if (epoch === state.epoch) setStatus({ state: "ready" });

    while (epoch === state.epoch) {
      if (change?.operationType === "insert") {
        if (add(state.data, change.fullDocument)) notify();
      } else if (change) {
        requestReload(epoch);
      }

      change = await changes.next();
    }
  } catch (error) {
    if (epoch !== state.epoch) return;

    // standalone servers keep the data loaded once, but cannot go live
    if ((error as { code?: number }).code === CHANGE_STREAM_UNSUPPORTED) {
      console.error(
        "[takaweb] live updates need mongo to run as a replica set, see compose.yml",
      );

      setStatus({ state: "unsupported" });
      schedule(() => void stream(epoch), UNSUPPORTED_RETRY);
      return;
    }

    fail(epoch, error);
  } finally {
    await changes.close().catch(() => {});
    if (state.stream === changes) state.stream = null;
  }
}

/**
 * load the logs and start watching for changes
 *
 * @param epoch watcher epoch
 */
async function start(epoch: number) {
  if (epoch !== state.epoch) return;

  try {
    await sync(!state.loaded);
    void stream(epoch);
  } catch (error) {
    fail(epoch, error);
  }
}

/**
 * stop watching, keeping the loaded logs for the next subscriber
 */
function stop() {
  state.epoch++;
  state.running = false;

  for (const timer of [state.timer, state.idleTimer, state.reloadTimer]) {
    if (timer) clearTimeout(timer);
  }

  state.timer = null;
  state.idleTimer = null;
  state.reloadTimer = null;

  void state.stream?.close().catch(() => {});
  state.stream = null;
}

/**
 * keep the store live while held
 *
 * @returns {() => void} release
 */
export function retain(): () => void {
  if (!hasMongo()) return () => {};

  state.holders++;

  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }

  if (!state.running) {
    state.running = true;
    if (state.status.state !== "ready") setStatus({ state: "connecting" });
    void start(state.epoch);
  }

  let released = false;

  return () => {
    if (released) return;
    released = true;

    if (--state.holders > 0) return;
    state.idleTimer = setTimeout(stop, IDLE_GRACE);
  };
}

/**
 * listen for data or status changes
 *
 * @param listener callback
 *
 * @returns {() => void} unsubscribe
 */
export function subscribe(listener: Listener): () => void {
  state.listeners.add(listener);

  return () => state.listeners.delete(listener);
}

/**
 * all logs ordered by start
 *
 * @returns {readonly Entry[]} entries
 */
export function entries(): readonly Entry[] {
  const { data } = state;

  if (!data.sorted) {
    data.entries.sort((a, b) => a.start - b.start);
    data.sorted = true;
  }

  return data.entries;
}

/**
 * wait for the first load, or for it to fail
 *
 * @param timeout max wait in ms
 *
 * @returns {Promise<void>} settles once there is something to show
 */
export function whenReady(timeout: number): Promise<void> {
  const settled = () =>
    state.loaded || ["error", "unconfigured"].includes(state.status.state);

  if (settled()) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };

    const timer = setTimeout(done, timeout);
    const unsubscribe = subscribe(() => settled() && done());
  });
}

/**
 * whether the first load finished
 *
 * @returns {boolean} loaded
 */
export const isLoaded = (): boolean => state.loaded;

/**
 * current data source status
 *
 * @returns {Status} status
 */
export const status = (): Status => state.status;
