import type { APIRoute } from "astro"
import { createExport } from "@/lib/server/export"
import { limits, tooManyRequests } from "@/lib/server/limiter"
import { EXPORT_FORMATS, isExportFormat } from "@/lib/export"

/**
 * download a backup, as json or an archive with a database copy
 */
export const GET: APIRoute = async ({ url, locals }) => {
  // the middleware only lets signed in requests through
  const user = locals.user!
  const session = locals.session!

  const format = url.searchParams.get("format") ?? "json"

  if (!isExportFormat(format)) {
    return Response.json({ error: "format must be json, zip or tar.gz" }, { status: 400 })
  }

  const wait = limits.heavy.take(session.id)
  if (wait) return tooManyRequests(wait)

  let result

  try {
    result = await createExport(format, user.id)
  } catch (error) {
    console.error("[takaweb] export failed:", error)

    return Response.json(
      { error: "The export failed, check that the TakaTime database is reachable" },
      { status: 500 }
    )
  }

  const type = EXPORT_FORMATS.find((option) => option.value === format)!.type

  return new Response(result.body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
