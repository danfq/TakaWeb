import { execFileSync } from "node:child_process"
import { changes, noreplyLogin, renderNotes, type Change } from "./notes"

/**
 * the release notes github shows for a tag, with commits and authors linked
 * the release workflow runs it, it needs the full history and the gh cli
 *
 * usage: bun scripts/release-notes.ts <tag>
 */

/**
 * run a command and return its output, null when it fails
 *
 * @param command command
 * @param args arguments
 *
 * @returns {string | null} trimmed output
 */
function run(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return null
  }
}

/**
 * the repository on github, from actions or the origin remote
 *
 * @returns {string} e.g. danfq/TakaWeb
 */
function repository(): string {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY

  const url = run("git", ["remote", "get-url", "origin"]) ?? ""
  const name = url.match(/github\.com[:/](.+?)(?:\.git)?$/)?.[1]

  if (!name) throw new Error("origin is not on github")

  return name
}

/**
 * the github username behind every author, asked once per email
 *
 * @param list commits
 * @param name repository
 *
 * @returns {Map<string, string | null>} usernames by email
 */
function logins(list: Change[], name: string): Map<string, string | null> {
  const found = new Map<string, string | null>()

  for (const change of list) {
    const { email } = change.author
    if (found.has(email)) continue

    // the api links a commit to its author's account, emails nobody claimed have none
    const login =
      noreplyLogin(email) ||
      run("gh", ["api", `repos/${name}/commits/${change.sha}`, "--jq", ".author.login"])

    found.set(email, login || null)
  }

  return found
}

const [tag] = process.argv.slice(2)

if (!tag) {
  console.error("usage: bun scripts/release-notes.ts <tag>")
  process.exit(1)
}

// the release before this one, none for the first
const previous = run("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`])
// the release commit itself only bumps the version
const list = changes(previous, tag).filter((change) => change.subject !== `chore: release ${tag}`)
const name = repository()
const server = process.env.GITHUB_SERVER_URL ?? "https://github.com"

process.stdout.write(renderNotes(list, { repository: `${server}/${name}`, logins: logins(list, name) }))
