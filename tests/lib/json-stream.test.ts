import { describe, expect, test } from "vitest"
import { JsonScanner, type JsonPath, type Visit } from "@/lib/json-stream"
import { random } from "../helpers/entries"

/**
 * scan a document in random chunks, capturing whatever the visitor asks for
 *
 * @param text document
 * @param visit visitor
 * @param seed chunking seed
 *
 * @returns {[JsonPath, unknown][]} captured values
 */
function scan(text: string, visit: (path: JsonPath) => Visit, seed = 1): [JsonPath, unknown][] {
  const captured: [JsonPath, unknown][] = []
  const scanner = new JsonScanner(visit, (path, value) => captured.push([[...path], value]))
  const next = random(seed)

  for (let index = 0; index < text.length;) {
    const size = 1 + Math.floor(next() * 40)
    scanner.write(text.slice(index, index + size))
    index += size
  }

  scanner.end()

  return captured
}

const DOCUMENT = {
  user: { name: 'quote " and \\ backslash', tags: ["a", "b"], nested: [{ deep: [1, 2, 3] }] },
  days: [
    { date: "2026-01-01", heartbeats: [{ time: 1.5, entity: "é/ü/日本.ts" }, { time: -2e-3 }] },
    { date: "2026-01-02", heartbeats: [] },
    { date: "2026-01-03", heartbeats: [{ ok: true, missing: null, escaped: " \n\t" }] },
  ],
  count: 12345.678e2,
  empty: {},
}

describe("json scanner", () => {
  test.each([0, 2])("captures values at the paths asked for, indent %i", (indent) => {
    const text = JSON.stringify(DOCUMENT, null, indent)

    for (let seed = 1; seed <= 20; seed++) {
      const captured = scan(
        text,
        (path) => {
          if (path.length === 0) return "descend"
          if (path[0] === "days" && path.length === 1) return "descend"
          if (path[0] === "days" && path.length === 2) return "capture"
          if (path[0] === "count" || path[0] === "empty") return "capture"
          return "skip"
        },
        seed
      )

      expect(captured).toEqual([
        [["days", 0], DOCUMENT.days[0]],
        [["days", 1], DOCUMENT.days[1]],
        [["days", 2], DOCUMENT.days[2]],
        [["count"], DOCUMENT.count],
        [["empty"], {}],
      ])
    }
  })

  test("walks into nested containers with the right paths", () => {
    const paths: JsonPath[] = []
    scan(JSON.stringify(DOCUMENT), (path) => {
      paths.push([...path])
      return path.length < 3 ? "descend" : "skip"
    })

    expect(paths).toContainEqual(["user", "tags", 1])
    expect(paths).toContainEqual(["days", 2, "heartbeats"])
    expect(paths).toContainEqual(["empty"])
  })

  test("captures a whole document and scalars at the root", () => {
    expect(scan(JSON.stringify(DOCUMENT), () => "capture")).toEqual([[[], DOCUMENT]])
    expect(scan("  42  ", () => "capture")).toEqual([[[], 42]])
    expect(scan('"text"', () => "capture")).toEqual([[[], "text"]])
    expect(scan("true", () => "capture")).toEqual([[[], true]])
  })

  test.each([
    ['{"a": [1, 2}', "a bracket closing a brace"],
    ['{"a" 1}', "a missing colon"],
    ['{"a": 1 "b": 2}', "a missing comma"],
    ["[1, 2", "a cut off array"],
    ['{"a": "open', "a cut off string"],
    ["{} {}", "two documents"],
    ["", "nothing at all"],
  ])("rejects %s, %s", (text) => {
    expect(() => scan(text, () => "descend")).toThrow(SyntaxError)
  })

  test("rejects a malformed captured value", () => {
    expect(() => scan('{"a": [1, tru]}', (path) => (path.length ? "capture" : "descend"))).toThrow(
      SyntaxError
    )
  })
})
