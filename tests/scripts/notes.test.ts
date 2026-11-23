import { describe, expect, test } from "vitest"
import { classify, renderNotes, type Change } from "../../scripts/notes"

describe("release notes", () => {
  test.each([
    ["feat(auth): list sessions", "", "feature"],
    ["feat: add a guide", "", "feature"],
    ["fix(export): stop leaking listeners", "", "other"],
    ["chore(deps): bump astro", "", "other"],
    ["docs: write the readme", "", "other"],
    ["set up project", "", "other"],
    ["feat(api)!: drop the old stream", "", "breaking"],
    ["refactor: rename the store", "BREAKING CHANGE: store moved", "breaking"],
  ])("puts %s in %s", (subject, body, kind) => {
    expect(classify(subject, body)).toBe(kind)
  })

  test("groups commits into sections, oldest first, with full subjects", () => {
    const list: Change[] = [
      { hash: "a1", subject: "chore: set up", kind: "other" },
      { hash: "b2", subject: "feat(ui): add a sheet", kind: "feature" },
      { hash: "c3", subject: "feat(api)!: drop v1", kind: "breaking" },
      { hash: "d4", subject: "fix(ui): keep the sheet open", kind: "other" },
      { hash: "e5", subject: "feat: add export", kind: "feature" },
    ]

    expect(renderNotes(list)).toBe(
      [
        "## Breaking changes",
        "",
        "- feat(api)!: drop v1 (c3)",
        "",
        "## Features",
        "",
        "- feat(ui): add a sheet (b2)",
        "- feat: add export (e5)",
        "",
        "## Fixes and other changes",
        "",
        "- chore: set up (a1)",
        "- fix(ui): keep the sheet open (d4)",
        "",
      ].join("\n")
    )
  })

  test("leaves out empty sections", () => {
    expect(renderNotes([{ hash: "a1", subject: "fix: typo", kind: "other" }])).toBe(
      "## Fixes and other changes\n\n- fix: typo (a1)\n"
    )
  })
})
