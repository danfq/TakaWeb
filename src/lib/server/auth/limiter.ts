/**
 * failed attempts allowed per key within the window
 */
const MAX_ATTEMPTS = 10
const WINDOW = 15 * 60 * 1000

type Attempts = { count: number; resetAt: number }

const globals = globalThis as typeof globalThis & {
  __takawebAttempts?: Map<string, Attempts>
}

const attempts = (globals.__takawebAttempts ??= new Map())

/**
 * check whether a key ran out of attempts
 *
 * @param key limiter key, e.g. action and client address
 *
 * @returns {boolean} whether it is limited
 */
export function isLimited(key: string): boolean {
  const entry = attempts.get(key)
  if (!entry) return false

  if (Date.now() >= entry.resetAt) {
    attempts.delete(key)
    return false
  }

  return entry.count >= MAX_ATTEMPTS
}

/**
 * record a failed attempt
 *
 * @param key limiter key
 */
export function recordFailure(key: string) {
  const now = Date.now()
  const entry = attempts.get(key)

  // keep the map from growing unbounded
  if (attempts.size > 1000) {
    for (const [k, v] of attempts) if (now >= v.resetAt) attempts.delete(k)
  }

  if (!entry || now >= entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW })
    return
  }

  entry.count++
}

/**
 * reset attempts after a success
 *
 * @param key limiter key
 */
export function clearFailures(key: string) {
  attempts.delete(key)
}
