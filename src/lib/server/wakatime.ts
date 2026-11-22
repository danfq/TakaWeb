import type { Agents } from "@/lib/wakatime"

const API = "https://api.wakatime.com/api/v1/users/current/user_agents"

/**
 * stop paging here, nobody runs this many editor plugins
 */
const MAX_PAGES = 20

/**
 * why a lookup failed, the message is safe to show
 */
export class LookupError extends Error {
  constructor(
    message: string,
    readonly rejected = false
  ) {
    super(message)
  }
}

/**
 * auth headers to try for a token, oauth tokens are bearer tokens and older api keys use basic auth
 *
 * @param token token or api key
 *
 * @returns {string[]} header values, most likely first
 */
function authorizations(token: string): string[] {
  const bearer = `Bearer ${token}`
  const basic = `Basic ${Buffer.from(token).toString("base64")}`

  return token.startsWith("waka_tok_") ? [bearer, basic] : [basic, bearer]
}

/**
 * fetch one page of user agents
 *
 * @param page page number
 * @param authorization auth header
 *
 * @returns {Promise<Response>} response
 */
async function request(page: number, authorization: string): Promise<Response> {
  try {
    return await fetch(`${API}?page=${page}`, {
      headers: { Authorization: authorization, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new LookupError("Could not reach WakaTime, try again or import without editor names")
  }
}

/**
 * look up the editor and os behind each of the account's wakatime user agents
 * the token is only used for these requests and never stored
 *
 * @param token wakatime token
 *
 * @returns {Promise<Agents>} agents keyed by id
 */
export async function lookupAgents(token: string): Promise<Agents> {
  const agents: Agents = {}
  const candidates = authorizations(token)
  let authorization = candidates[0]

  for (let page = 1; page <= MAX_PAGES; page++) {
    let response = await request(page, authorization)

    // the first page settles which auth scheme the token takes
    if (page === 1 && (response.status === 401 || response.status === 403)) {
      authorization = candidates[1]
      response = await request(page, authorization)
    }

    if (response.status === 401 || response.status === 403) {
      throw new LookupError(
        "WakaTime did not accept this token. Copy the one from wakatime.com/oauth, plugin API keys can only send data",
        true
      )
    }

    if (response.status === 429) {
      throw new LookupError("WakaTime is rate limiting requests, wait a minute and try again")
    }

    if (!response.ok) {
      throw new LookupError(`WakaTime answered with an error (${response.status}), try again later`)
    }

    const body = (await response.json()) as { data?: unknown; total_pages?: number }
    const list = Array.isArray(body.data) ? body.data : body.data ? [body.data] : []

    for (const entry of list as Record<string, unknown>[]) {
      if (typeof entry?.id !== "string") continue

      agents[entry.id] = {
        editor: typeof entry.editor === "string" ? entry.editor : "",
        os: typeof entry.os === "string" ? entry.os : "",
        value: typeof entry.value === "string" ? entry.value : "",
      }
    }

    if (!body.total_pages || page >= body.total_pages) break
  }

  return agents
}
