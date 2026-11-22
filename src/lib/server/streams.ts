/**
 * open event streams, so shutdown can end them instead of waiting on clients
 */
type Stream = { owner: string; close: () => void }

/**
 * most streams one session may hold open, a dashboard needs one per tab
 */
export const MAX_STREAMS_PER_OWNER = 20

// survive dev reloads, so streams opened before one still get closed
const globals = globalThis as typeof globalThis & { __takawebStreams?: Set<Stream> }

const streams = (globals.__takawebStreams ??= new Set())

/**
 * track an open stream
 *
 * @param owner session holding it
 * @param close ends the stream
 *
 * @returns {(() => void) | null} untrack, null when the owner already holds too many
 */
export function track(owner: string, close: () => void): (() => void) | null {
  let held = 0
  for (const stream of streams) if (stream.owner === owner) held++

  if (held >= MAX_STREAMS_PER_OWNER) return null

  const stream = { owner, close }
  streams.add(stream)

  return () => streams.delete(stream)
}

/**
 * end every open stream, clients reconnect to whichever server comes up next
 */
export function closeStreams() {
  for (const stream of [...streams]) stream.close()
  streams.clear()
}

/**
 * how many streams are open
 *
 * @returns {number} count
 */
export const openStreams = (): number => streams.size
