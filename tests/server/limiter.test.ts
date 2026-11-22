import { describe, expect, test } from "vitest"
import { Limiter, retryAfter, tooManyRequests } from "@/lib/server/limiter"

describe("limiter", () => {
  test("allows hits up to the limit within a window", () => {
    const limiter = new Limiter(3, 1000)

    expect([0, 0, 0].map((_, index) => limiter.take("a", 100 + index))).toEqual([0, 0, 0])
    expect(limiter.take("a", 200)).toBe(900)
    // other keys are counted apart
    expect(limiter.take("b", 200)).toBe(0)
  })

  test("starts over once the window ends", () => {
    const limiter = new Limiter(1, 1000)

    limiter.hit("a", 0)
    expect(limiter.wait("a", 999)).toBe(1)
    expect(limiter.wait("a", 1000)).toBe(0)
    expect(limiter.take("a", 1000)).toBe(0)
  })

  test("only counts when asked, failures are recorded apart from checks", () => {
    const limiter = new Limiter(2, 1000)

    expect(limiter.wait("a", 0)).toBe(0)
    expect(limiter.wait("a", 0)).toBe(0)
    limiter.hit("a", 0)
    limiter.hit("a", 0)
    expect(limiter.wait("a", 10)).toBe(990)

    limiter.reset("a")
    expect(limiter.wait("a", 10)).toBe(0)
  })

  test("drops expired keys once it tracks many", () => {
    const limiter = new Limiter(1, 10)

    for (let index = 0; index < 1500; index++) limiter.hit(`key-${index}`, 0)
    limiter.hit("fresh", 100)

    expect(limiter.wait("key-1", 100)).toBe(0)
    expect(limiter.wait("fresh", 100)).toBe(10)
  })

  test("answers with retry-after in whole seconds", async () => {
    expect(retryAfter(1)).toBe("1")
    expect(retryAfter(1500)).toBe("2")

    const response = tooManyRequests(30_000)
    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("30")
    expect(await response.json()).toHaveProperty("error")
  })
})
