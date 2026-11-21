import { useEffect, useState } from "react";
import type { Detail, PeriodRange, View } from "@/lib/stats/types";
import { writeFilter } from "@/lib/stats/view";

/**
 * detailed insights for a period, refetched whenever `revision` changes
 *
 * @param view view the dashboard shows
 * @param period period to load, null when closed
 * @param revision changes when the shown data should refresh, e.g. a live snapshot
 *
 * @returns latest detail and whether loading it failed
 */
export function useDetail(
  view: View,
  period: PeriodRange | null,
  revision: unknown,
) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);

  const { tz, filter } = view;
  const dimension = filter?.dimension;
  const value = filter?.value;
  const from = period?.from;
  const to = period?.to;

  useEffect(() => {
    // closed, start clean next time so another period never flashes in
    if (!from || !to) {
      setDetail(null);
      return;
    }

    const params = new URLSearchParams({ tz, from, to });
    writeFilter(
      params,
      dimension && value !== undefined ? { dimension, value } : null,
    );

    const controller = new AbortController();

    fetch(`/api/detail?${params}`, { signal: controller.signal })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(response.status),
      )
      .then((next: Detail) => {
        setDetail(next);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });

    return () => controller.abort();
  }, [tz, dimension, value, from, to, revision]);

  return { detail, failed };
}
