import type { Detail, PeriodRange, Snapshot, Status, View } from "@/lib/stats/types"
import { importedVersion } from "@/lib/server/imports"
import { ViewCache, type Source } from "./engine"
import { detail } from "./snapshot"
import { changes, entries, isLoaded, maxDuration, retain, status, subscribe, whenReady } from "./store"

/**
 * a connected client
 */
export type Subscriber = (event: "snapshot" | "status", data: string) => void

/**
 * subscribers sharing one view, and the last payload they got
 */
type Channel = {
  view: View
  subscribers: Set<Subscriber>
  payload: string | null
}

/**
 * recompute this often even without new logs, rolls days over and refreshes "today"
 */
const TICK = 60_000

/**
 * how long a view's cache outlives its last subscriber, so reloads and quick filter switches stay instant
 */
const CACHE_TTL = 10 * 60_000

/**
 * most views kept cached at once
 */
const MAX_CACHES = 16

const hub: {
  channels: Map<string, Channel>
  caches: Map<string, { cache: ViewCache; used: number }>
  lastStatus: string
  ticker: ReturnType<typeof setInterval> | null
  unsubscribe: (() => void) | null
} = {
  channels: new Map(),
  caches: new Map(),
  lastStatus: JSON.stringify(status()),
  ticker: null,
  unsubscribe: null,
}

/**
 * stable key for a view
 *
 * @param view view
 *
 * @returns {string} key
 */
const keyOf = ({ tz, filter }: View): string => JSON.stringify([tz, filter?.dimension, filter?.value])

/**
 * how long a page render waits for the first load before rendering without data
 */
const RENDER_WAIT = 5000

/**
 * the logs as caches read them
 *
 * @returns {Source} source
 */
function source(): Source {
  const { structure, imports, appended } = changes()

  return { all: entries(), structure, imports, appended, maxDuration: maxDuration() }
}

/**
 * the cache for a view, created on first use
 *
 * @param view view
 *
 * @returns {ViewCache} cache
 */
function cacheFor(view: View): ViewCache {
  const key = keyOf(view)
  const now = Date.now()
  let held = hub.caches.get(key)

  if (!held) {
    held = { cache: new ViewCache(view), used: now }
    hub.caches.set(key, held)
    prune(now)
  }

  held.used = now

  return held.cache
}

/**
 * drop caches nobody used for a while, keeping the ones open channels need
 *
 * @param now current instant
 */
function prune(now: number) {
  const idle = [...hub.caches].filter(([key]) => !hub.channels.has(key)).sort((a, b) => a[1].used - b[1].used)

  let over = hub.caches.size - MAX_CACHES

  for (const [key, { used }] of idle) {
    if (over-- > 0 || now - used > CACHE_TTL) hub.caches.delete(key)
  }
}

/**
 * the current snapshot for a view, stamped with the imported logs version
 *
 * @param view view
 *
 * @returns {Snapshot} snapshot
 */
const build = (view: View): Snapshot => ({
  ...cacheFor(view).snapshot(source(), Date.now()),
  imports: importedVersion(),
})

/**
 * recompute a channel and push it when it changed
 *
 * @param channel channel
 * @param force send even when unchanged
 */
function refresh(channel: Channel, force = false) {
  if (!isLoaded()) return

  const payload = JSON.stringify(build(channel.view))
  if (!force && payload === channel.payload) return

  channel.payload = payload
  for (const send of channel.subscribers) send("snapshot", payload)
}

/**
 * push status and data changes to every channel
 */
function broadcast() {
  const current = JSON.stringify(status())

  if (current !== hub.lastStatus) {
    hub.lastStatus = current

    for (const channel of hub.channels.values()) {
      for (const send of channel.subscribers) send("status", current)
    }
  }

  for (const channel of hub.channels.values()) refresh(channel)

  prune(Date.now())
}

/**
 * subscribe a client to a view
 *
 * @param view view
 * @param send event sink
 *
 * @returns {() => void} leave
 */
export function join(view: View, send: Subscriber): () => void {
  const key = keyOf(view)
  let channel = hub.channels.get(key)

  if (!channel) {
    channel = { view, subscribers: new Set(), payload: null }
    hub.channels.set(key, channel)
  }

  channel.subscribers.add(send)

  hub.unsubscribe ??= subscribe(broadcast)
  hub.ticker ??= setInterval(broadcast, TICK)

  const release = retain()

  send("status", JSON.stringify(status()))

  if (channel.payload) send("snapshot", channel.payload)
  else refresh(channel, true)

  return () => {
    release()
    channel.subscribers.delete(send)

    if (channel.subscribers.size === 0) hub.channels.delete(key)

    if (hub.channels.size === 0) stopHub()
  }
}

/**
 * stop ticking and listening, once nobody is subscribed or the server shuts down
 */
export function stopHub() {
  if (hub.ticker) clearInterval(hub.ticker)
  hub.unsubscribe?.()
  hub.ticker = null
  hub.unsubscribe = null
}

/**
 * the current snapshot for a view, for rendering the page on the server
 *
 * @param view view
 *
 * @returns {Promise<{ snapshot: Snapshot | null; status: Status }>} snapshot and status
 */
export async function initial(view: View): Promise<{ snapshot: Snapshot | null; status: Status }> {
  // keeps the store warm until the page's stream connects
  const release = retain()

  try {
    await whenReady(RENDER_WAIT)

    if (!isLoaded()) return { snapshot: null, status: status() }

    const cached = hub.channels.get(keyOf(view))?.payload

    return {
      snapshot: cached ? JSON.parse(cached) : build(view),
      status: status(),
    }
  } finally {
    release()
  }
}

/**
 * detailed insights for a period, computed on request
 *
 * @param view view
 * @param period first and last day, inclusive
 *
 * @returns {Promise<Detail | null>} detail, null while the logs are unavailable
 */
export async function periodDetail(view: View, period: PeriodRange): Promise<Detail | null> {
  const release = retain()

  try {
    await whenReady(RENDER_WAIT)

    return isLoaded() ? detail(view, entries(), Date.now(), period, maxDuration()) : null
  } finally {
    release()
  }
}
