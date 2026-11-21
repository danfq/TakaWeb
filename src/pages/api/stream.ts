import type { APIRoute } from "astro";
import { isTimeZone } from "@/lib/server/stats/days";
import { join } from "@/lib/server/stats/hub";
import { RANGES, type Filter, type Range, type View } from "@/lib/stats/types";

/**
 * dimensions a view can be filtered by, branches only make sense within a project
 */
const FILTERABLE = ["project", "language", "editor", "os"] as const;

/**
 * keep proxies from closing an idle stream
 */
const HEARTBEAT = 15_000;

/**
 * read the view from the query string, falling back to safe defaults
 *
 * @param params query string
 *
 * @returns {View} view
 */
function parseView(params: URLSearchParams): View {
  const tz = params.get("tz") ?? "";
  const range = params.get("range") as Range;
  const dimension = params.get("dimension") as Filter["dimension"];
  const value = params.get("value");

  return {
    tz: isTimeZone(tz) ? tz : "UTC",
    range: RANGES.includes(range) ? range : "week",
    filter:
      FILTERABLE.includes(dimension as (typeof FILTERABLE)[number]) &&
      value !== null &&
      value.length <= 512
        ? { dimension, value }
        : null,
  };
}

/**
 * live dashboard snapshots over server-sent events
 */
export const GET: APIRoute = ({ url, request }) => {
  const view = parseView(url.searchParams);
  const encoder = new TextEncoder();

  let cleanup = () => {};

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      /**
       * write a raw chunk, tearing down once the client is gone
       *
       * @param chunk sse text
       */
      const write = (chunk: string) => {
        if (closed) return;

        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      // reconnect quickly after a drop
      write("retry: 3000\n\n");

      const leave = join(view, (event, data) =>
        write(`event: ${event}\ndata: ${data}\n\n`),
      );
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT);

      cleanup = () => {
        if (closed) return;
        closed = true;

        clearInterval(heartbeat);
        leave();

        try {
          controller.close();
        } catch {}
      };

      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
};
