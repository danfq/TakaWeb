import type { APIRoute } from "astro"
import { tooManyRequests } from "@/lib/server/limiter"
import { getSettings, onSettings } from "@/lib/server/settings"
import { isTimeZone } from "@/lib/server/stats/days"
import { join } from "@/lib/server/stats/hub"
import { track } from "@/lib/server/streams"
import type { View } from "@/lib/stats/types"
import { readFilter } from "@/lib/stats/view"

/**
 * keep proxies from closing an idle stream
 */
const HEARTBEAT = 15_000

/**
 * read the view from the query string, falling back to safe defaults
 *
 * @param params query string
 *
 * @returns {View} view
 */
function parseView(params: URLSearchParams): View {
  const tz = params.get("tz") ?? ""

  return {
    tz: isTimeZone(tz) ? tz : "UTC",
    filter: readFilter(params),
  }
}

/**
 * live dashboard snapshots and settings over server-sent events
 */
export const GET: APIRoute = ({ url, request, locals }) => {
  // the middleware only lets signed in requests through
  const user = locals.user!
  const session = locals.session!

  const view = parseView(url.searchParams)
  const encoder = new TextEncoder()

  let cleanup = () => {}

  // checked before the stream starts, start runs right away
  const untrack = track(session.id, () => cleanup())
  if (!untrack) return tooManyRequests(60_000)

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false

      /**
       * write a raw chunk, tearing down once the client is gone
       *
       * @param chunk sse text
       */
      const write = (chunk: string) => {
        if (closed) return

        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }

      /**
       * write one event
       *
       * @param event event name
       * @param data json payload
       */
      const send = (event: string, data: string) => write(`event: ${event}\ndata: ${data}\n\n`)

      // reconnect quickly after a drop
      write("retry: 3000\n\n")

      // settings first, a reconnect may have missed changes
      send("settings", JSON.stringify(getSettings(user.id)))

      const leave = join(view, send)
      const unsubscribe = onSettings((owner, settings) => {
        if (owner === user.id) send("settings", JSON.stringify(settings))
      })
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT)

      cleanup = () => {
        if (closed) return
        closed = true

        clearInterval(heartbeat)
        leave()
        unsubscribe()
        untrack()

        try {
          controller.close()
        } catch {}
      }

      request.signal.addEventListener("abort", cleanup, { once: true })
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
