import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stdin, stdout } from "node:process"
import { createInterface } from "node:readline/promises"
import { release } from "@danfq/nextver"

/**
 * cuts a release from main: syncs with the remote, bumps the version with nextver,
 * commits and tags it, then pushes both, the tag starts the release workflow on github
 */

const BRANCH = "main"
const REMOTE = "origin"

/**
 * the version the very first release ships as
 */
const FIRST_VERSION = "1.0.0"

/**
 * run git and return its output
 *
 * @param args git arguments
 *
 * @returns {string} trimmed output
 */
const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" }).trim()

/**
 * run git with its output shown
 *
 * @param args git arguments
 */
const gitLoud = (...args: string[]) => void execFileSync("git", args, { stdio: "inherit" })

/**
 * print a message and exit with an error
 *
 * @param message what went wrong
 *
 * @returns {never} never
 */
function fail(message: string): never {
  console.error(`\nrelease: ${message}`)
  prompt.close()
  process.exit(1)
}

// one reader for every answer, it buffers lines so piped answers are not lost between questions
const prompt = createInterface({ input: stdin, output: stdout })
const answers = prompt[Symbol.asyncIterator]()

/**
 * ask a yes or no question, no unless answered yes
 *
 * @param question question
 *
 * @returns {Promise<boolean>} whether the answer was yes
 */
async function confirm(question: string): Promise<boolean> {
  stdout.write(`${question} [y/N] `)

  const { value, done } = await answers.next()

  return !done && /^y(es)?$/i.test(String(value).trim())
}

/**
 * set the version in package.json, formatted as prettier keeps it
 *
 * @param version new version
 */
function writeVersion(version: string) {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"))

  writeFileSync("package.json", `${JSON.stringify({ ...manifest, version }, null, 2)}\n`)
}

/**
 * the repository's actions page for the release workflow, when it lives on github
 *
 * @returns {string | null} url
 */
function workflowUrl(): string | null {
  const url = git("remote", "get-url", REMOTE)
  const repository = url.match(/github\.com[:/](.+?)(?:\.git)?$/)?.[1]

  return repository ? `https://github.com/${repository}/actions/workflows/release.yml` : null
}

/**
 * bring local main and the remote in line, asking before anything changes
 */
async function sync() {
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== BRANCH) fail(`switch to ${BRANCH} first`)
  if (git("status", "--porcelain")) fail("commit or stash your changes first")

  console.log(`Fetching ${REMOTE}...`)
  git("fetch", "--quiet", "--tags", "--force", REMOTE, BRANCH)

  const upstream = `${REMOTE}/${BRANCH}`
  const ahead = Number(git("rev-list", "--count", `${upstream}..HEAD`))
  const behind = Number(git("rev-list", "--count", `HEAD..${upstream}`))

  if (!ahead && !behind) {
    console.log(`${BRANCH} matches ${upstream}.`)
    return
  }

  if (ahead && !behind) {
    if (!(await confirm(`${BRANCH} is ${ahead} commit(s) ahead of ${upstream}. Push them?`)))
      fail("cancelled")

    gitLoud("push", REMOTE, BRANCH)
    return
  }

  if (!ahead && behind) {
    if (!(await confirm(`${BRANCH} is ${behind} commit(s) behind ${upstream}. Pull them?`))) fail("cancelled")

    gitLoud("merge", "--ff-only", upstream)
    return
  }

  if (!(await confirm(`${BRANCH} and ${upstream} diverged. Rebase onto ${upstream} and push?`)))
    fail("cancelled")

  try {
    gitLoud("rebase", upstream)
  } catch {
    git("rebase", "--abort")
    fail("the rebase hit conflicts and was aborted, resolve it by hand")
  }

  gitLoud("push", REMOTE, BRANCH)
}

/**
 * bump, commit, tag and push the release
 */
async function cut() {
  const dir = mkdtempSync(join(tmpdir(), "takaweb-release-"))
  const before = git("rev-parse", "HEAD")

  try {
    // nextver works out the bump and notes, package.json is only written once confirmed
    const result = await release({ dryRun: true })

    if (result.skipped) {
      console.log(`\nNothing to release since ${result.previous ?? "the first commit"}.`)
      return
    }

    // the first release starts at 1.0.0, nextver bumps from there
    const first = result.previous === null
    const version = first ? FIRST_VERSION : result.version
    const tag = `v${version}`
    const body = result.notes.trim()

    console.log(
      `\n${result.current} -> ${version} (${first ? "first release" : result.bump}, ${result.commits} commits)\n`
    )
    console.log(body || "No features, fixes or other notable changes.")
    console.log()

    if (!(await confirm(`Release ${tag}?`))) fail("cancelled, nothing was changed")

    writeVersion(version)

    // the tag carries the notes, the release workflow publishes them from it
    const message = join(dir, "tag.md")
    writeFileSync(message, `${tag}\n\n${body}\n`)

    git("commit", "--quiet", "--message", `chore: release ${tag}`, "--", "package.json")
    git("tag", "--annotate", tag, "--file", message)

    try {
      // both or neither, a tag without its commit on main would release nothing
      gitLoud("push", "--atomic", REMOTE, BRANCH, tag)
    } catch {
      git("tag", "--delete", tag)
      git("reset", "--hard", before)
      fail("the push failed, the release commit and tag were undone locally")
    }

    const url = workflowUrl()
    console.log(`\nPushed ${tag}. GitHub is building and publishing it${url ? `:\n${url}` : "."}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

try {
  await sync()
  await cut()
} finally {
  prompt.close()
}
