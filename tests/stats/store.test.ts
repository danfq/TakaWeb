import { ObjectId } from "mongodb"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

/**
 * a change stream the test pushes events into
 */
class FakeStream {
  private queue: unknown[] = []
  private waiting: ((change: unknown) => void) | null = null
  closed = false

  push(change: unknown) {
    if (this.waiting) {
      this.waiting(change)
      this.waiting = null
    } else {
      this.queue.push(change)
    }
  }

  async tryNext() {
    return this.queue.shift() ?? null
  }

  next() {
    const queued = this.queue.shift()
    if (queued) return Promise.resolve(queued)

    return new Promise((resolve) => (this.waiting = resolve))
  }

  async close() {
    this.closed = true
  }
}

/**
 * the takatime logs collection, in memory
 */
const fake = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  streams: [] as unknown[],
}))

vi.mock("@/lib/server/mongo", () => ({
  hasMongo: () => true,
  logs: () => ({
    find: (query: { _id?: { $gt: ObjectId } }) => {
      const docs = [...fake.docs.values()].filter(
        (doc) => !query._id || String(doc._id) > String(query._id.$gt)
      )
      return (async function* () {
        yield* docs
      })()
    },
    countDocuments: async () => fake.docs.size,
    watch: () => {
      const stream = new FakeStream()
      fake.streams.push(stream)
      return stream
    },
  }),
  closeMongo: async () => {},
}))

const { changes, entries, isLoaded, retain, shutdownStore, status, whenReady } =
  await import("@/lib/server/stats/store")

const NOW = Date.now()

/**
 * a takatime log document
 *
 * @param minutesAgo when it ended
 * @param project project
 *
 * @returns document
 */
function doc(minutesAgo: number, project = "takaweb") {
  const _id = new ObjectId()

  return {
    _id,
    name: "/src/a.ts",
    project,
    timestamp: new Date(NOW - minutesAgo * 60_000),
    duration: 60,
    language: "Go",
    os: "linux",
    gitBranch: "main",
    editor: "zed",
  }
}

/**
 * the stream the store currently follows
 *
 * @returns {FakeStream} stream
 */
const stream = () => fake.streams.at(-1) as FakeStream

/**
 * let the store handle what was pushed
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe("log store", () => {
  let release: () => void

  beforeAll(async () => {
    for (const item of [doc(30), doc(20), doc(10, "site"), { _id: new ObjectId(), timestamp: "nonsense" }]) {
      fake.docs.set(String(item._id), item)
    }

    release = retain()
    await whenReady(2000)
    await settle()
  })

  afterAll(async () => {
    release()
    await shutdownStore()
  })

  test("loads every well formed log and goes live", () => {
    expect(isLoaded()).toBe(true)
    expect(status()).toEqual({ state: "ready" })
    expect(entries().map((entry) => entry.project)).toEqual(["takaweb", "takaweb", "site"])
  })

  test("appends inserts without a structural change", async () => {
    const { structure } = changes()
    const added = doc(1, "new")

    fake.docs.set(String(added._id), added)
    stream().push({ operationType: "insert", fullDocument: added, documentKey: { _id: added._id } })
    await settle()

    expect(changes().structure).toBe(structure)
    expect(changes().appended.map((entry) => entry.project)).toContain("new")
    expect(entries().at(-1)?.project).toBe("new")
  })

  test("applies updates and deletes in place", async () => {
    const [target] = [...fake.docs.values()].filter((item) => item.project === "site")
    const updated = { ...target, project: "renamed" }
    const { structure } = changes()

    stream().push({ operationType: "update", fullDocument: updated, documentKey: { _id: target._id } })
    await settle()

    expect(changes().structure).toBeGreaterThan(structure)
    expect(entries().map((entry) => entry.project)).toContain("renamed")
    expect(entries().map((entry) => entry.project)).not.toContain("site")

    stream().push({ operationType: "delete", documentKey: { _id: target._id } })
    await settle()

    expect(entries().map((entry) => entry.project)).not.toContain("renamed")
  })

  test("closes its change stream on shutdown", async () => {
    const current = stream()
    await shutdownStore()

    expect(current.closed).toBe(true)
  })
})
