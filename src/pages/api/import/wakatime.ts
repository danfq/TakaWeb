import type { APIRoute } from "astro"
import { z } from "astro/zod"
import { importHeartbeats } from "@/lib/server/imports"
import { limits, tooManyRequests } from "@/lib/server/limiter"
import { importsChanged } from "@/lib/server/stats/store"
import { IMPORT_BATCH, IMPORT_LIMITS } from "@/lib/wakatime"

/**
 * largest request accepted, a batch is capped well below it
 */
const MAX_BODY = 1024 * 1024

/**
 * a wakatime heartbeat as sent by the import, see ImportHeartbeat
 * times outside the range are skipped rather than rejected, so clock skew never stalls a whole batch
 */
const heartbeat = z.object({
  time: z.number().int(),
  file: z.string().min(1).max(IMPORT_LIMITS.file),
  project: z.string().max(IMPORT_LIMITS.project),
  language: z.string().max(IMPORT_LIMITS.language),
  branch: z.string().max(IMPORT_LIMITS.branch),
  editor: z.string().max(IMPORT_LIMITS.editor),
  os: z.string().max(IMPORT_LIMITS.os),
})

const body = z.object({ heartbeats: z.array(heartbeat).max(IMPORT_BATCH) })

/**
 * an error response
 *
 * @param status http status
 * @param error message safe to show
 *
 * @returns {Response} response
 */
const failure = (status: number, error: string): Response => Response.json({ error }, { status })

/**
 * store a batch of heartbeats read from a wakatime export, sent by the import worker
 */
export const POST: APIRoute = async ({ request, locals }) => {
  // the middleware only lets signed in requests through
  const session = locals.session!

  const wait = limits.importBatches.take(session.id)
  if (wait) return tooManyRequests(wait)

  // json only, so a cross-site form can never post here
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return failure(415, "Send the batch as JSON")
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
    return failure(413, "The batch is too large")
  }

  const text = await request.text()
  if (text.length > MAX_BODY) return failure(413, "The batch is too large")

  let input: unknown

  try {
    input = JSON.parse(text)
  } catch {
    return failure(400, "The batch is not valid JSON")
  }

  const parsed = body.safeParse(input)
  if (!parsed.success) return failure(400, "The batch holds invalid heartbeats")

  const result = importHeartbeats(parsed.data.heartbeats)
  if (result.added) importsChanged()

  return Response.json(result, { headers: { "Cache-Control": "no-store" } })
}
