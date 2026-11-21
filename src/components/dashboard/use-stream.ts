import { useEffect, useState } from "react";
import type { Snapshot, Status, View } from "@/lib/stats/types";
import { writeFilter } from "@/lib/stats/view";

/**
 * retry delay once the browser gives up on a stream
 */
const RETRY = 3000;

/**
 * live dashboard data for a view, over server-sent events
 *
 * @param view view to subscribe to
 * @param initial snapshot and status the page was rendered with
 *
 * @returns latest snapshot, server status, whether the stream is up and whether the snapshot is for another view
 */
export function useStream(
  view: View,
  initial: { snapshot: Snapshot | null; status: Status },
) {
  const [snapshot, setSnapshot] = useState(initial.snapshot);
  const [status, setStatus] = useState(initial.status);
  const [connected, setConnected] = useState(true);

  const { tz, filter } = view;
  const dimension = filter?.dimension;
  const value = filter?.value;

  useEffect(() => {
    const params = new URLSearchParams({ tz });
    writeFilter(
      params,
      dimension && value !== undefined ? { dimension, value } : null,
    );

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
  }, [tz, dimension, value]);

  // a snapshot for a previous filter stays up until the new one lands
  const stale =
    !!snapshot &&
    (snapshot.view.tz !== tz ||
      snapshot.view.filter?.dimension !== dimension ||
      snapshot.view.filter?.value !== value);

  return { snapshot, status, connected, stale };
}
