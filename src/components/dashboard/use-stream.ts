import { useEffect, useState } from "react";
import type { Snapshot, Status, View } from "@/lib/stats/types";

/**
 * retry delay once the browser gives up on a stream
 */
const RETRY = 3000;

/**
 * live dashboard data for a view, over server-sent events
 *
 * @param view view to subscribe to
 *
 * @returns latest snapshot, server status and whether the stream is up
 */
export function useStream(view: View) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<Status>({ state: "connecting" });
  const [connected, setConnected] = useState(true);

  const { tz, range, filter } = view;
  const dimension = filter?.dimension;
  const value = filter?.value;

  useEffect(() => {
    const params = new URLSearchParams({ tz, range });

    if (dimension && value !== undefined) {
      params.set("dimension", dimension);
      params.set("value", value);
    }

    let source: EventSource;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    /**
     * open the stream and wire its events
     */
    const open = () => {
      source = new EventSource(`/api/stream?${params}`);

      source.addEventListener("open", () => setConnected(true));
      source.addEventListener("snapshot", (event) =>
        setSnapshot(JSON.parse((event as MessageEvent<string>).data)),
      );
      source.addEventListener("status", (event) =>
        setStatus(JSON.parse((event as MessageEvent<string>).data)),
      );

      source.addEventListener("error", async () => {
        setConnected(false);

        // the browser only retries network drops, http errors close the stream for good
        if (source.readyState !== EventSource.CLOSED || disposed) return;

        const response = await fetch(location.href, {
          redirect: "manual",
        }).catch(() => null);

        // the session is gone
        if (response?.type === "opaqueredirect") {
          location.assign("/login");
          return;
        }

        if (!disposed) retry = setTimeout(open, RETRY);
      });
    };

    open();

    return () => {
      disposed = true;
      clearTimeout(retry);
      source.close();
    };
  }, [tz, range, dimension, value]);

  // a snapshot for a previous view stays up, dimmed, until the new one lands
  const stale =
    !!snapshot &&
    (snapshot.view.range !== range ||
      snapshot.view.filter?.dimension !== dimension ||
      snapshot.view.filter?.value !== value);

  return { snapshot, status, connected, stale };
}
