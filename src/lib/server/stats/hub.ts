import type { Detail, PeriodRange, Snapshot, Status, View } from "@/lib/stats/types"
import { importedVersion } from "@/lib/server/imports"
import { detail, snapshot } from "./snapshot"
import { entries, isLoaded, retain, status, subscribe, whenReady } from "./store"

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

const channels = new Map<string, Channel>()
let lastStatus = JSON.stringify(status())
let ticker: ReturnType<typeof setInterval> | null = null
let unsubscribe: (() => void) | null = null

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
 * the current snapshot for a view, stamped with the imported logs version
 *
 * @param view view
 *
 * @returns {Snapshot} snapshot
 */
const build = (view: View): Snapshot => ({
  ...snapshot(view, entries(), Date.now()),
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

  if (current !== lastStatus) {
    lastStatus = current

    for (const channel of channels.values()) {
      for (const send of channel.subscribers) send("status", current)
    }
  }

  for (const channel of channels.values()) refresh(channel)
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
  let channel = channels.get(key)

  if (!channel) {
    channel = { view, subscribers: new Set(), payload: null }
    channels.set(key, channel)
  }

  channel.subscribers.add(send)

  unsubscribe ??= subscribe(broadcast)
  ticker ??= setInterval(broadcast, TICK)

  const release = retain()

  send("status", JSON.stringify(status()))

  if (channel.payload) send("snapshot", channel.payload)
  else refresh(channel, true)

  return () => {
    release()
    channel.subscribers.delete(send)

    if (channel.subscribers.size === 0) channels.delete(key)

    if (channels.size === 0) {
      if (ticker) clearInterval(ticker)
      unsubscribe?.()
      ticker = null
      unsubscribe = null
    }
  }
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

    const cached = channels.get(keyOf(view))?.payload

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

    return isLoaded() ? detail(view, entries(), Date.now(), period) : null
  } finally {
    release()
  }
}
