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
export type Change = {
  sha: string
  hash: string
  subject: string
  kind: Kind
  author: { name: string; email: string }
}

/**
 * what linking commits and authors on github needs
 */
export type Links = {
  // e.g. https://github.com/danfq/TakaWeb
  repository: string
  // github username per author email, null when the email belongs to no account
  logins: Map<string, string | null>
}

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
  const log = execFileSync(
    "git",
    ["log", range, "--reverse", "--no-merges", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%b%x1e"],
    { encoding: "utf8" }
  )

  return log
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha = "", hash = "", subject = "", name = "", email = "", body = ""] = entry.split("\x1f")

      return { sha, hash, subject, kind: classify(subject, body), author: { name, email } }
    })
}

/**
 * the github username in a noreply address, such as 12345+danfq@users.noreply.github.com
 *
 * @param email author email
 *
 * @returns {string | null} username
 */
export const noreplyLogin = (email: string): string | null =>
  /^(?:\d+\+)?([\w-]+)@users\.noreply\.github\.com$/i.exec(email)?.[1] ?? null

/**
 * one line of the notes, with the commit and its author linked when links are given
 *
 * @param change commit
 * @param links where commits and authors live on github
 *
 * @returns {string} markdown line
 */
function line(change: Change, links?: Links): string {
  if (!links) return `- ${change.subject} (${change.hash})`

  const login = links.logins.get(change.author.email)
  const author = login ? `[@${login}](https://github.com/${login})` : change.author.name

  return `- ${change.subject} ([${change.hash}](${links.repository}/commit/${change.sha})) by ${author}`
}

/**
 * release notes in markdown, one line per commit with its full subject and short hash
 * plain for the terminal and the tag, linked to commits and authors for github
 *
 * @param list changes in the release
 * @param links where commits and authors live on github
 *
 * @returns {string} notes
 */
export function renderNotes(list: Change[], links?: Links): string {
  return `${SECTIONS.map(([kind, title]) => {
    const lines = list.filter((change) => change.kind === kind).map((change) => line(change, links))

    return lines.length ? `## ${title}\n\n${lines.join("\n")}` : ""
  })
    .filter(Boolean)
    .join("\n\n")}\n`
}
