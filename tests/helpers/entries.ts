import type { Entry } from "@/lib/server/stats/store"

/**
 * a seeded random number generator, so failures reproduce
 *
 * @param seed seed
 *
 * @returns {() => number} next number in [0, 1)
 */
export function random(seed: number): () => number {
  let state = seed >>> 0 || 1

  return () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * pick one of a list
 *
 * @param next random source
 * @param list options
 *
 * @returns {T} option
 */
export const pick = <T>(next: () => number, list: readonly T[]): T => list[Math.floor(next() * list.length)]

const PROJECTS = ["takaweb", "takatime", "dotfiles", "site"]
const LANGUAGES = ["TypeScript", "Go", "Markdown", "CSS"]
const EDITORS = ["vscode", "neovim", "zed"]
const SYSTEMS = ["darwin", "linux"]
const BRANCHES = ["main", "feat/x", ""]

/**
 * a log, everything but its times given or picked at random
 *
 * @param start start ms
 * @param end end ms
 * @param fields fields to fix
 * @param next random source
 *
 * @returns {Entry} entry
 */
export function entry(start: number, end: number, fields: Partial<Entry> = {}, next = Math.random): Entry {
  return {
    start,
    end,
    project: pick(next, PROJECTS),
    language: pick(next, LANGUAGES),
    editor: pick(next, EDITORS),
    os: pick(next, SYSTEMS),
    branch: pick(next, BRANCHES),
    file: `src/file-${Math.floor(next() * 30)}.ts`,
    ...fields,
  }
}

/**
 * realistic coding history: bursts of short overlapping logs, breaks, the odd long one,
 * fractional milliseconds like takatime's float durations produce
 *
 * @param next random source
 * @param from first instant
 * @param to last instant
 * @param count how many logs
 *
 * @returns {Entry[]} entries ordered by start
 */
export function history(next: () => number, from: number, to: number, count: number): Entry[] {
  const list: Entry[] = []

  for (let index = 0; index < count; index++) {
    const start = from + next() * (to - from)
    const long = next() < 0.02
    const duration = long ? next() * 6 * 3_600_000 : 1000 + next() * 20 * 60_000

    list.push(entry(start, start + duration, {}, next))
  }

  return list.sort((a, b) => a.start - b.start)
}

/**
 * insert entries into an ordered list, keeping it ordered
 *
 * @param list entries ordered by start
 * @param added new entries
 *
 * @returns {Entry[]} merged list
 */
export const merge = (list: readonly Entry[], added: readonly Entry[]): Entry[] =>
  [...list, ...added].sort((a, b) => a.start - b.start)
