import { useEffect, useRef } from "react"
import { actions } from "astro:actions"
import type { Filter } from "@/lib/stats/types"
import { sameFilter, writeFilter } from "@/lib/stats/view"

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

    actions.view
      .seal(filter)
      .then(({ data }) => {
        if (cancelled || !data) return

        show(filter, data)
        shown.current = { filter, sealed: true }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [filter, hidden])
}
