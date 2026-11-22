import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/account"
import { hashPassword } from "@/lib/server/auth/password"
import { openDatabase, transaction } from "@/lib/server/schema"

/**
 * maintenance commands, run next to the server with the same TAKAWEB_DATA_DIR
 * the only way to recover a forgotten password, the web ui never offers one
 */

const USAGE = `Usage: takaweb <command> [options]

Commands:
  reset-password   Set a new admin password and sign out every session

Options:
  --stdin          Read the new password from the first line of stdin instead of prompting
  -h, --help       Show this help

The database is read from TAKAWEB_DATA_DIR (default: ./data).`

/**
 * print a message and exit with an error
 *
 * @param message what went wrong
 *
 * @returns {never} never
 */
function fail(message: string): never {
  console.error(`takaweb: ${message}`)
  process.exit(1)
}

/**
 * ask for a secret on the terminal without echoing it
 *
 * @param question prompt
 *
 * @returns {Promise<string>} answer
 */
function prompt(question: string): Promise<string> {
  const { stdin, stdout } = process

  stdout.write(question)
  stdin.setRawMode(true)
  stdin.setEncoding("utf8")
  stdin.resume()

  return new Promise((resolve, reject) => {
    let value = ""

    /**
     * stop listening and give the terminal back
     */
    const done = () => {
      stdin.off("data", onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write("\n")
    }

    /**
     * collect typed characters until enter
     *
     * @param chunk typed text
     */
    const onData = (chunk: string) => {
      for (const char of chunk) {
        // enter or ctrl+d
        if (char === "\r" || char === "\n" || char === "\u0004") {
          done()
          return resolve(value)
        }

        // ctrl+c
        if (char === "\u0003") {
          done()
          return reject(new Error("cancelled"))
        }

        // backspace
        if (char === "\u007f" || char === "\b") value = [...value].slice(0, -1).join("")
        else value += char
      }
    }

    stdin.on("data", onData)
  })
}

/**
 * read the first line of stdin
 *
 * @returns {Promise<string>} line
 */
async function readLine(): Promise<string> {
  let input = ""

  for await (const chunk of process.stdin) {
    input += chunk
    if (input.includes("\n")) break
  }

  return input.split(/\r?\n/)[0]
}

/**
 * get the new password, prompting twice on a terminal
 *
 * @param stdin read it from stdin instead
 *
 * @returns {Promise<string>} password
 */
async function newPassword(stdin: boolean): Promise<string> {
  if (stdin || !process.stdin.isTTY) return readLine()

  const password = await prompt("New password: ")
  const confirm = await prompt("Confirm password: ")

  if (password !== confirm) fail("passwords do not match")

  return password
}

/**
 * set a new admin password and sign out every session
 *
 * @param stdin read the password from stdin
 */
async function resetPassword(stdin: boolean) {
  const file = join(resolve(process.env.TAKAWEB_DATA_DIR || "data"), "takaweb.db")

  if (!existsSync(file)) fail(`no database at ${file}, check TAKAWEB_DATA_DIR`)

  const database = openDatabase(file)
  const admin = database.prepare("SELECT id FROM user WHERE username = 'admin'").get() as
    { id: number } | undefined

  if (!admin) fail("no admin account yet, finish the setup in the browser instead")

  const password = await newPassword(stdin).catch(() => fail("cancelled"))

  // same rules as the browser
  if (password.length < PASSWORD_MIN) fail(`use at least ${PASSWORD_MIN} characters`)
  if (password.length > PASSWORD_MAX) fail(`use at most ${PASSWORD_MAX} characters`)

  const hash = await hashPassword(password)

  const sessions = transaction(database, () => {
    database.prepare("UPDATE user SET password_hash = ? WHERE id = ?").run(hash, admin.id)

    return Number(database.prepare("DELETE FROM session WHERE user_id = ?").run(admin.id).changes)
  })

  database.close()

  console.log(`Password reset. ${sessions} session${sessions === 1 ? "" : "s"} signed out.`)
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    stdin: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
})

const [command] = positionals

if (values.help || !command) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 1)
}

switch (command) {
  case "reset-password":
    await resetPassword(values.stdin)
    break
  default:
    fail(`unknown command ${command}, see takaweb --help`)
}
