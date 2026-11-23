import { useEffect, useRef } from "react"
import { actions } from "astro:actions"
import type { Filter } from "@/lib/stats/types"
import { sameFilter, writeFilter } from "@/lib/stats/view"

/**
 * tries at sealing a filter before the address bar is left without it
 */
const SEAL_ATTEMPTS = 3

/**
 * wait between sealing tries, grows with each one
 */
const SEAL_BACKOFF = 1_000

/**
 * put a filter in the address bar without adding to history
 *
 * @param filter filter or null
 * @param sealed sealed token to show instead of the plain filter
 */
function show(filter: Filter | null, sealed?: string) {
  const url = new URL(location.href)
  writeFilter(url.searchParams, filter, sealed)

  history.replaceState(history.state, "", url)
}

/**
 * seal a filter, retrying a few times when the server fails or sends nothing back
 *
 * @param filter filter to seal
 * @param cancelled whether the result is no longer wanted
 *
 * @returns {Promise<string | null>} sealed token, null when every try failed or it was cancelled
 */
async function seal(filter: Filter, cancelled: () => boolean): Promise<string | null> {
  for (let attempt = 0; attempt < SEAL_ATTEMPTS; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, attempt * SEAL_BACKOFF))
    if (cancelled()) return null

    try {
      const { data } = await actions.view.seal(filter)
      if (data) return data
    } catch {
      // network error, try again
    }
  }

  return null
}

/**
 * mirror the filter in the url, sealed while names are hidden so they never show in the address bar
 *
 * @param filter current filter
 * @param hidden whether names are hidden
 * @param initial filter the page was rendered with, the server already put it in the url as hidden asks
 */
export function useFilterUrl(filter: Filter | null, hidden: boolean, initial: Filter | null) {
  // what the address bar holds right now
  const shown = useRef({ filter: initial, sealed: hidden && !!initial })

  useEffect(() => {
    const sealed = hidden && !!filter

    if (sameFilter(shown.current.filter, filter) && shown.current.sealed === sealed) return

    if (!sealed || !filter) {
      show(filter)
      shown.current = { filter, sealed: false }
      return
    }

    // the name leaves the address bar right away, its sealed form follows once the server made it
    show(null)
    shown.current = { filter: null, sealed: false }

    let cancelled = false

    void seal(filter, () => cancelled).then((token) => {
      // the plain filter stays out of the url even when sealing never succeeds
      if (cancelled || !token) return

      show(filter, token)
      shown.current = { filter, sealed: true }
    })

    return () => {
      cancelled = true
    }
  }, [filter, hidden])
}
