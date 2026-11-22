import { closeDatabase } from "@/lib/server/db"
import { closeMongo } from "@/lib/server/mongo"
import { stopHub } from "@/lib/server/stats/hub"
import { shutdownStore } from "@/lib/server/stats/store"
import { closeStreams } from "@/lib/server/streams"

/**
 * longest a shutdown waits for requests in flight
 */
const DRAIN_TIMEOUT = 5000

type ShutdownState = {
  installed: boolean
  closing: boolean
  inflight: number
  drained: (() => void) | null
}

// survive dev reloads, so handlers are only installed once
const globals = globalThis as typeof globalThis & { __takawebShutdown?: ShutdownState }

const state = (globals.__takawebShutdown ??= {
  installed: false,
  closing: false,
  inflight: 0,
  drained: null,
})

/**
 * whether the server is shutting down, new requests are turned away then
 *
 * @returns {boolean} closing
 */
export const isClosing = (): boolean => state.closing

/**
 * count a request until its response is ready, so shutdown waits for it
 *
 * @param handle request handler
 *
 * @returns {Promise<T>} its result
 */
export async function track<T>(handle: () => Promise<T>): Promise<T> {
  state.inflight++

  try {
    return await handle()
  } finally {
    if (--state.inflight === 0) state.drained?.()
  }
}

/**
 * wait for requests in flight, giving up after a while
 *
 * @returns {Promise<void>} resolves once drained or timed out
 */
function drain(): Promise<void> {
  if (state.inflight === 0) return Promise.resolve()

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, DRAIN_TIMEOUT)

    state.drained = () => {
      clearTimeout(timer)
      resolve()
    }
  })
}

/**
 * close everything that keeps the process alive, in order: streams, the watcher, requests, mongo, sqlite
 *
 * @param signal what asked for it
 */
export async function shutdown(signal: string) {
  if (state.closing) return
  state.closing = true

  console.log(`[takaweb] ${signal} received, shutting down`)

  try {
    // live streams never finish on their own, end them so clients reconnect elsewhere
    closeStreams()
    stopHub()

    await shutdownStore()
    await drain()
    await closeMongo()

    closeDatabase()
  } catch (error) {
    console.error("[takaweb] shutdown failed:", error)
    process.exit(1)
  }

  process.exit(0)
}

/**
 * shut down cleanly on sigterm and sigint, as docker and process managers send
 */
export function installShutdown() {
  if (state.installed) return
  state.installed = true

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => void shutdown(signal))
  }
}
