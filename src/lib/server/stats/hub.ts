import type { View } from "@/lib/stats/types";
import { snapshot } from "./snapshot";
import { entries, isLoaded, retain, status, subscribe } from "./store";

/**
 * a connected client
 */
export type Subscriber = (event: "snapshot" | "status", data: string) => void;

/**
 * subscribers sharing one view, and the last payload they got
 */
type Channel = {
  view: View;
  subscribers: Set<Subscriber>;
  payload: string | null;
};

/**
 * recompute this often even without new logs, rolls days over and refreshes "today"
 */
const TICK = 60_000;

const channels = new Map<string, Channel>();
let lastStatus = JSON.stringify(status());
let ticker: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => void) | null = null;

/**
 * stable key for a view
 *
 * @param view view
 *
 * @returns {string} key
 */
const keyOf = ({ tz, range, filter }: View): string =>
  JSON.stringify([tz, range, filter?.dimension, filter?.value]);

/**
 * recompute a channel and push it when it changed
 *
 * @param channel channel
 * @param force send even when unchanged
 */
function refresh(channel: Channel, force = false) {
  if (!isLoaded()) return;

  const payload = JSON.stringify(snapshot(channel.view, entries(), Date.now()));
  if (!force && payload === channel.payload) return;

  channel.payload = payload;
  for (const send of channel.subscribers) send("snapshot", payload);
}

/**
 * push status and data changes to every channel
 */
function broadcast() {
  const current = JSON.stringify(status());

  if (current !== lastStatus) {
    lastStatus = current;

    for (const channel of channels.values()) {
      for (const send of channel.subscribers) send("status", current);
    }
  }

  for (const channel of channels.values()) refresh(channel);
}

/**
 * subscribe a client to a view
 *
 * @param view view
 * @param send event sink
 *
 * @returns {() => void} leave
 */
export function join(view: View, send: Subscriber): () => void {
  const key = keyOf(view);
  let channel = channels.get(key);

  if (!channel) {
    channel = { view, subscribers: new Set(), payload: null };
    channels.set(key, channel);
  }

  channel.subscribers.add(send);

  unsubscribe ??= subscribe(broadcast);
  ticker ??= setInterval(broadcast, TICK);

  const release = retain();

  send("status", JSON.stringify(status()));

  if (channel.payload) send("snapshot", channel.payload);
  else refresh(channel, true);

  return () => {
    release();
    channel.subscribers.delete(send);

    if (channel.subscribers.size === 0) channels.delete(key);

    if (channels.size === 0) {
      if (ticker) clearInterval(ticker);
      unsubscribe?.();
      ticker = null;
      unsubscribe = null;
    }
  };
}
