import { TAKAWEB_URL } from "astro:env/server"

/**
 * headers every response carries
 * pages also carry astro's content security policy with script and style hashes,
 * this one adds what it cannot express
 */
const HEADERS: Record<string, string> = {
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
}

/**
 * tell browsers to stick to https for two years, only once takaweb is served over it
 */
const HSTS = "max-age=63072000"

/**
 * whether takaweb is served over https
 *
 * @param url request url
 *
 * @returns {boolean} https
 */
const isHttps = (url: URL): boolean => (TAKAWEB_URL ? new URL(TAKAWEB_URL).protocol : url.protocol) === "https:"

/**
 * add the security headers to a response
 *
 * @param response response
 * @param url request url
 *
 * @returns {Response} response with the headers
 */
export function secure(response: Response, url: URL): Response {
  let target = response

  try {
    target.headers.set("X-Content-Type-Options", "nosniff")
  } catch {
    // redirects and some fetched responses have immutable headers, copy them
    target = new Response(response.body, response)
  }

  for (const [name, value] of Object.entries(HEADERS)) {
    // pages already carry astro's policy, a second one is enforced alongside it
    if (name === "Content-Security-Policy") target.headers.append(name, value)
    else target.headers.set(name, value)
  }
  if (isHttps(url)) target.headers.set("Strict-Transport-Security", HSTS)

  return target
}
