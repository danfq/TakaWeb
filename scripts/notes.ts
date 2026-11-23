import { execFileSync } from "node:child_process"

/**
 * release notes, grouped like the other danfq projects: breaking changes, features, then everything else
 */

/**
 * where a commit goes in the notes
 */
export type Kind = "breaking" | "feature" | "other"

/**
 * a commit in a release
 */
export type Change = { hash: string; subject: string; kind: Kind }

/**
 * sections in the order they show, empty ones are left out
 */
const SECTIONS: [Kind, string][] = [
  ["breaking", "Breaking changes"],
  ["feature", "Features"],
  ["other", "Fixes and other changes"],
]

/**
 * where a conventional commit belongs, breaking changes first, then features, everything else after
 *
 * @param subject commit subject
 * @param body commit body
 *
 * @returns {Kind} section
 */
export function classify(subject: string, body: string): Kind {
  const match = /^(\w+)(\([^)]*\))?(!)?:/.exec(subject)

  if (match?.[3] || /^BREAKING[ -]CHANGE:/m.test(body)) return "breaking"
  if (match?.[1] === "feat") return "feature"

  return "other"
}

/**
 * commits in a range, oldest first, merges left out since their commits already count
 *
 * @param since tag of the last release, null counts the whole history
 * @param until last commit to include
 *
 * @returns {Change[]} changes
 */
export function changes(since: string | null, until = "HEAD"): Change[] {
  const range = since ? `${since}..${until}` : until
  const log = execFileSync("git", ["log", range, "--reverse", "--no-merges", "--format=%h%x1f%s%x1f%b%x1e"], {
    encoding: "utf8",
  })

  return log
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash = "", subject = "", body = ""] = entry.split("\x1f")

      return { hash, subject, kind: classify(subject, body) }
    })
}

/**
 * release notes in markdown, one line per commit with its full subject and short hash
 *
 * @param list changes in the release
 *
 * @returns {string} notes
 */
export function renderNotes(list: Change[]): string {
  return `${SECTIONS.map(([kind, title]) => {
    const lines = list
      .filter((change) => change.kind === kind)
      .map((change) => `- ${change.subject} (${change.hash})`)

    return lines.length ? `## ${title}\n\n${lines.join("\n")}` : ""
  })
    .filter(Boolean)
    .join("\n\n")}\n`
}
