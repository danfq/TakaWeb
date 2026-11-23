import { describe, expect, test } from "vitest"
import { classify, noreplyLogin, renderNotes, type Change } from "../../scripts/notes"

/**
 * a commit in a release
 *
 * @param hash short hash
 * @param subject subject
 * @param kind section
 * @param email author email
 *
 * @returns {Change} change
 */
const change = (hash: string, subject: string, kind: Change["kind"], email = "dan@danfq.dev"): Change => ({
  sha: hash.padEnd(40, "0"),
  hash,
  subject,
  kind,
  author: { name: "Dan", email },
})

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
      change("a1", "chore: set up", "other"),
      change("b2", "feat(ui): add a sheet", "feature"),
      change("c3", "feat(api)!: drop v1", "breaking"),
      change("d4", "fix(ui): keep the sheet open", "other"),
      change("e5", "feat: add export", "feature"),
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
    expect(renderNotes([change("a1", "fix: typo", "other")])).toBe(
      "## Fixes and other changes\n\n- fix: typo (a1)\n"
    )
  })

  test("links commits and authors for github, naming authors without an account", () => {
    const notes = renderNotes(
      [
        change("a1", "feat: add export", "feature"),
        change("b2", "fix: typo", "other", "someone@example.com"),
      ],
      {
        repository: "https://github.com/danfq/TakaWeb",
        logins: new Map([
          ["dan@danfq.dev", "danfq"],
          ["someone@example.com", null],
        ]),
      }
    )

    expect(notes).toContain(
      `- feat: add export ([a1](https://github.com/danfq/TakaWeb/commit/${"a1".padEnd(40, "0")})) by [@danfq](https://github.com/danfq)`
    )
    expect(notes).toContain(
      `- fix: typo ([b2](https://github.com/danfq/TakaWeb/commit/${"b2".padEnd(40, "0")})) by Dan`
    )
  })

  test("reads usernames from github noreply addresses", () => {
    expect(noreplyLogin("62481705+danfq@users.noreply.github.com")).toBe("danfq")
    expect(noreplyLogin("danfq@users.noreply.github.com")).toBe("danfq")
    expect(noreplyLogin("dan@danfq.dev")).toBeNull()
  })
})
