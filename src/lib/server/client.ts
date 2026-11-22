import { isIP } from "node:net"
import { TAKAWEB_TRUSTED_PROXIES } from "astro:env/server"

type RequestContext = { request: Request; clientAddress: string }

/**
 * longest user agent kept, real ones are far shorter
 */
const MAX_USER_AGENT = 512

/**
 * drop the ipv4-mapped ipv6 prefix, so one client always has one address
 *
 * @param address raw address
 *
 * @returns {string} address
 */
const normalize = (address: string): string => address.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "")

/**
 * the address a request came from
 * behind trusted proxies it is read from x-forwarded-for, counting proxies from the right,
 * since anything left of what they appended is up to the client and cannot be trusted
 *
 * @param context request and socket address
 * @param proxies how many proxies sit in front of takaweb
 *
 * @returns {string} client address
 */
export function clientIp({ request, clientAddress }: RequestContext, proxies = TAKAWEB_TRUSTED_PROXIES): string {
  const socket = normalize(clientAddress ?? "")

  if (proxies <= 0) return socket

  const forwarded = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map(normalize)
    .filter(Boolean)

  // the entry the outermost trusted proxy appended, it saw the client connect
  const candidate = forwarded[forwarded.length - proxies]

  return candidate && isIP(candidate) ? candidate : socket
}

/**
 * the browser's user agent, capped
 *
 * @param context request
 *
 * @returns {string} user agent
 */
export const userAgent = ({ request }: { request: Request }): string =>
  (request.headers.get("user-agent") ?? "").slice(0, MAX_USER_AGENT)
