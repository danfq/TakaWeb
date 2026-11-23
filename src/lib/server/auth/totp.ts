import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { CODE_LENGTH } from "@/lib/account"

/**
 * rfc 6238 defaults, the only ones every authenticator app supports
 */
export const TOTP_DIGITS = CODE_LENGTH
export const TOTP_PERIOD = 30

/**
 * steps either side of now a code may come from, covers clock drift and slow typing
 */
const DRIFT = 1

/**
 * secret length in bytes, what rfc 4226 recommends for sha1
 */
const SECRET_LENGTH = 20

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

/**
 * encode bytes as unpadded base32, how authenticator apps take secrets
 *
 * @param bytes raw bytes
 *
 * @returns {string} base32 text
 */
export function toBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ""

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8

    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31]

  return output
}

/**
 * decode base32, ignoring case, spaces and padding
 *
 * @param text base32 text
 *
 * @returns {Buffer | null} bytes, null when it is not base32
 */
export function fromBase32(text: string): Buffer | null {
  const clean = text.replace(/[\s=]/g, "").toUpperCase()
  const bytes: number[] = []
  let bits = 0
  let value = 0

  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index < 0) return null

    value = (value << 5) | index
    bits += 5

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}

/**
 * a fresh random secret
 *
 * @returns {string} base32 secret
 */
export const generateSecret = (): string => toBase32(randomBytes(SECRET_LENGTH))

/**
 * the time step an instant falls in
 *
 * @param now epoch ms
 *
 * @returns {number} step
 */
export const timeStep = (now = Date.now()): number => Math.floor(now / 1000 / TOTP_PERIOD)

/**
 * the code for a time step, rfc 4226 hotp over the step counter
 *
 * @param secret base32 secret
 * @param step time step
 *
 * @returns {string} zero padded code
 */
export function totpCode(secret: string, step: number): string {
  const key = fromBase32(secret)
  if (!key) throw new Error("invalid totp secret")

  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))

  const hmac = createHmac("sha1", key).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 15
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0")
}

/**
 * find the step a code belongs to, skipping steps already used
 *
 * @param secret base32 secret
 * @param code code from the app
 * @param after last step used, only later ones count
 * @param now epoch ms
 *
 * @returns {number | null} matching step, null when the code is wrong or spent
 */
export function verifyTotp(secret: string, code: string, after = 0, now = Date.now()): number | null {
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) return null

  const current = timeStep(now)
  const given = Buffer.from(code)
  let match: number | null = null

  // every step is checked, so timing never tells which one matched
  for (let step = current - DRIFT; step <= current + DRIFT; step++) {
    const expected = Buffer.from(totpCode(secret, step))

    if (timingSafeEqual(given, expected) && step > after && match === null) match = step
  }

  return match
}

/**
 * the link authenticator apps scan from a qr code
 *
 * @param secret base32 secret
 * @param account account name shown in the app
 * @param issuer service name shown in the app
 *
 * @returns {string} otpauth url
 */
export function totpUri(secret: string, account: string, issuer = "TakaWeb"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD),
  })

  return `otpauth://totp/${label}?${params}`
}
