import { createHash } from "node:crypto"

/**
 * a content security policy hash of inline code, so it runs without allowing every inline script
 *
 * @param code script or style text, exactly as rendered
 *
 * @returns {`sha256-${string}`} hash source
 */
export const cspHash = (code: string): `sha256-${string}` =>
  `sha256-${createHash("sha256").update(code).digest("base64")}`
