type Window = { count: number; resetAt: number }

/**
 * prune expired windows once a limiter tracks this many keys
 */
const PRUNE_AT = 1000

/**
 * counts hits per key within a fixed window, kept in memory
 * takaweb runs as a single process, so one copy sees every request
 */
export class Limiter {
  private readonly windows = new Map<string, Window>()

  /**
   * @param limit hits allowed per window
   * @param window window length in ms
   */
  constructor(
    readonly limit: number,
    readonly window: number
  ) {}

  /**
   * the live window of a key
   *
   * @param key limiter key
   * @param now current instant
   *
   * @returns {Window | undefined} window, undefined once expired
   */
  private current(key: string, now: number): Window | undefined {
    const entry = this.windows.get(key)

    if (entry && now >= entry.resetAt) {
      this.windows.delete(key)
      return undefined
    }

    return entry
  }

  /**
   * how long until a key may try again
   *
   * @param key limiter key
   * @param now current instant
   *
   * @returns {number} ms to wait, 0 when allowed
   */
  wait(key: string, now = Date.now()): number {
    const entry = this.current(key, now)

    return entry && entry.count >= this.limit ? entry.resetAt - now : 0
  }

  /**
   * count a hit against a key
   *
   * @param key limiter key
   * @param now current instant
   */
  hit(key: string, now = Date.now()) {
    if (this.windows.size >= PRUNE_AT) {
      for (const [other, entry] of this.windows) if (now >= entry.resetAt) this.windows.delete(other)
    }

    const entry = this.current(key, now)

    if (entry) entry.count++
    else this.windows.set(key, { count: 1, resetAt: now + this.window })
  }

  /**
   * count a hit unless the key is out of hits, for plain request rates
   *
   * @param key limiter key
   * @param now current instant
   *
   * @returns {number} ms to wait, 0 when the hit was allowed and counted
   */
  take(key: string, now = Date.now()): number {
    const wait = this.wait(key, now)
    if (!wait) this.hit(key, now)

    return wait
  }

  /**
   * forget a key, e.g. after a successful sign in
   *
   * @param key limiter key
   */
  reset(key: string) {
    this.windows.delete(key)
  }
}

const MINUTE = 60_000

// survive dev reloads, so a reload never hands out fresh attempts
const globals = globalThis as typeof globalThis & { __takawebLimits?: ReturnType<typeof create> }

/**
 * every limiter takaweb uses, failures count wrong passwords and plain ones count requests
 *
 * @returns limiters by name
 */
const create = () => ({
  // wrong passwords or setup tokens per client address
  authFailures: new Limiter(10, 15 * MINUTE),
  // every sign in attempt per address, hashing a password is expensive
  authAttempts: new Limiter(30, 15 * MINUTE),
  // sign in attempts from everyone, caps hashing work under a distributed attack
  authGlobal: new Limiter(300, 15 * MINUTE),
  // wrong current passwords per session when changing it
  passwordFailures: new Limiter(5, 15 * MINUTE),
  // wakatime api lookups per session, each one pages through an external api
  wakatimeLookups: new Limiter(10, MINUTE),
  // import batches per session, an import retries once it may go on
  importBatches: new Limiter(600, MINUTE),
  // destructive or heavy requests per session
  heavy: new Limiter(10, MINUTE),
  // light requests per session, such as settings changes and period details
  requests: new Limiter(300, MINUTE),
})

export const limits = (globals.__takawebLimits ??= create())

/**
 * seconds to put in a retry-after header
 *
 * @param wait ms to wait
 *
 * @returns {string} whole seconds, at least 1
 */
export const retryAfter = (wait: number): string => String(Math.max(1, Math.ceil(wait / 1000)))

/**
 * a 429 response for api routes
 *
 * @param wait ms to wait
 *
 * @returns {Response} response
 */
export const tooManyRequests = (wait: number): Response =>
  Response.json(
    { error: "Too many requests, try again shortly" },
    { status: 429, headers: { "Retry-After": retryAfter(wait) } }
  )
