import { useEffect, useState } from "react"
import type { Detail, PeriodRange, View } from "@/lib/stats/types"
import { writeFilter } from "@/lib/stats/view"

/**
 * identity of a detail request
 *
 * @param view view
 * @param period period
 *
 * @returns {string} key
 */
const requestKey = (view: View, period: PeriodRange): string =>
  JSON.stringify([
    view.tz,
    view.filter?.dimension ?? null,
    view.filter?.value ?? null,
    period.from,
    period.to,
  ])

/**
 * detailed insights for a period, refetched whenever `revision` changes
 *
 * @param view view the dashboard shows
 * @param period period to load, null when closed
 * @param revision changes when the shown data should refresh, e.g. a live snapshot
 *
 * @returns the last loaded detail, whether it is the one requested, whether the request failed and a retry
 */
export function useDetail(view: View, period: PeriodRange | null, revision: unknown) {
  const [detail, setDetail] = useState<Detail | null>(null)
  // only the request that failed counts as failed, not whatever is asked next
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const { tz, filter } = view
  const dimension = filter?.dimension
  const value = filter?.value
  const from = period?.from
  const to = period?.to

  const key = period ? requestKey(view, period) : null

  useEffect(() => {
    // closed, start clean next time so another period never flashes in
    if (!from || !to || !key) {
      setDetail(null)
      setFailedKey(null)
      return
    }

    const params = new URLSearchParams({ tz, from, to })
    writeFilter(params, dimension && value !== undefined ? { dimension, value } : null)

    const controller = new AbortController()
    setFailedKey(null)

    fetch(`/api/detail?${params}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((next: Detail) => setDetail(next))
      .catch(() => {
        if (!controller.signal.aborted) setFailedKey(key)
      })

    return () => controller.abort()
  }, [tz, dimension, value, from, to, key, revision, attempt])

  return {
    detail,
    // the loaded detail answers the current request
    current: !!detail && !!period && requestKey(detail.view, detail) === key,
    failed: !!key && failedKey === key,
    retry: () => setAttempt((count) => count + 1),
  }
}
