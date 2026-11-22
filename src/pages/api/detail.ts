import type { APIRoute } from "astro"
import { isTimeZone } from "@/lib/server/stats/days"
import { periodDetail } from "@/lib/server/stats/hub"
import { readFilter } from "@/lib/stats/view"

const DAY = 24 * 60 * 60 * 1000

/**
 * longest period a detail can cover, a little over a year
 */
const MAX_DAYS = 400

/**
 * check a value is a real calendar day key
 *
 * @param value raw value
 *
 * @returns {boolean} whether it is YYYY-MM-DD
 */
const isDayKey = (value: string | null): value is string =>
  !!value &&
  // keeps the day table a sane size, takatime logs are far younger than 2000
  value >= "2000-01-01" &&
  value < "2100-01-01" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

/**
 * detailed insights for a span of days
 */
export const GET: APIRoute = async ({ url }) => {
  const params = url.searchParams
  const tz = params.get("tz") ?? ""
  const from = params.get("from")
  const to = params.get("to")

  if (!isDayKey(from) || !isDayKey(to)) {
    return Response.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 })
  }

  const span = (Date.parse(to) - Date.parse(from)) / DAY

  if (span < 0 || span >= MAX_DAYS) {
    return Response.json({ error: "invalid period" }, { status: 400 })
  }

  const detail = await periodDetail(
    { tz: isTimeZone(tz) ? tz : "UTC", filter: readFilter(params) },
    { from, to }
  )

  if (!detail) {
    return Response.json({ error: "logs are unavailable" }, { status: 503 })
  }

  return Response.json(detail, { headers: { "Cache-Control": "no-store" } })
}
