/**
 * a signed in session, as the session list shows it
 */
export type SessionInfo = {
  id: string
  ip: string
  userAgent: string
  createdAt: number
  // the session viewing the list, it cannot revoke itself
  current: boolean
}

/**
 * what the settings sheet shows about the account, rendered with the page
 */
export type Account = {
  sessions: SessionInfo[]
  // heartbeats imported from wakatime
  imported: number
  // whether signing in takes a code from an authenticator app
  twoFactor: boolean
}

/**
 * password policy, capped to keep hashing cheap
 */
export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 128

/**
 * digits in an authenticator app code
 */
export const CODE_LENGTH = 6

/**
 * read a code as typed or pasted, e.g. 123 456
 *
 * @param input raw input
 *
 * @returns {string} digits only
 */
export const normalizeCode = (input: string): string => input.replace(/[\s-]/g, "")

/**
 * browsers, most specific first since most also claim to be chrome or safari
 */
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\b(?:OPR|Opera)\//, "Opera"],
  [/\bVivaldi\//, "Vivaldi"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/(?:\b|Headless)(?:Chrome|Chromium)\/|\bCriOS\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
  [/\bcurl\//, "curl"],
]

/**
 * systems, most specific first since android also claims to be linux
 */
const SYSTEMS: [RegExp, string][] = [
  [/\b(?:iPhone|iPad|iPod)\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bWindows\b/, "Windows"],
  [/\bLinux\b/, "Linux"],
]

/**
 * a short name for the browser and system behind a user agent
 *
 * @param userAgent raw user agent
 *
 * @returns {string} e.g. Firefox on macOS
 */
export function describeAgent(userAgent: string): string {
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1]
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1]

  if (browser && system) return `${browser} on ${system}`

  return browser ?? system ?? "Unknown device"
}
