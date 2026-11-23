import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { db } from "@/lib/server/db"
import { FILTERABLE, type Filter } from "@/lib/stats/types"

const KEY_LENGTH = 32
const IV_LENGTH = 12
const TAG_LENGTH = 16

/**
 * longest filter value a url may carry, as for plain filters
 */
const MAX_VALUE = 512

let cached: Buffer | null = null

/**
 * the key sealing filters, made once and kept with the database so sealed urls outlive restarts
 *
 * @returns {Buffer} key
 */
function key(): Buffer {
  if (cached) return cached

  db.prepare("INSERT OR IGNORE INTO secret (name, value) VALUES ('filter', ?)").run(randomBytes(KEY_LENGTH))

  const row = db.prepare("SELECT value FROM secret WHERE name = 'filter'").get() as { value: Uint8Array }
  cached = Buffer.from(row.value)

  return cached
}

/**
 * seal a filter into an opaque url value, so names stay out of the address bar
 *
 * @param filter filter
 *
 * @returns {string} base64url token
 */
export function sealFilter(filter: Filter): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const body = Buffer.concat([
    cipher.update(JSON.stringify([filter.dimension, filter.value])),
    cipher.final(),
  ])

  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")
}

/**
 * open a sealed filter
 *
 * @param token base64url token from sealFilter
 *
 * @returns {Filter | null} filter, null when it was tampered with or sealed by another server
 */
export function openFilter(token: string): Filter | null {
  const raw = Buffer.from(token, "base64url")
  if (raw.length <= IV_LENGTH + TAG_LENGTH || raw.length > 4096) return null

  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, IV_LENGTH))
    decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH))

    const text = Buffer.concat([decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()])
    const [dimension, value] = JSON.parse(text.toString("utf8"))

    if (!FILTERABLE.includes(dimension) || typeof value !== "string" || value.length > MAX_VALUE) return null

    return { dimension, value }
  } catch {
    return null
  }
}
