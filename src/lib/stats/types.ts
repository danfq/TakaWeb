/**
 * time window the dashboard panels cover
 */
export const RANGES = ["today", "week", "month", "year", "all"] as const;

export type Range = (typeof RANGES)[number];

/**
 * log fields the dashboard can break time down by
 */
export const DIMENSIONS = [
  "project",
  "language",
  "editor",
  "os",
  "branch",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

/**
 * narrows every stat down to logs matching one value
 */
export type Filter = { dimension: Dimension; value: string };

/**
 * what a client subscribes to
 */
export type View = { tz: string; range: Range; filter: Filter | null };

/**
 * a named share of coded time
 */
export type Item = { name: string; seconds: number; share: number };

/**
 * a timeline bucket, keyed by its local date or hour
 */
export type Bucket = { key: string; seconds: number };

/**
 * a stretch of continuous work on one project
 */
export type Session = {
  project: string;
  start: number;
  end: number;
  seconds: number;
  languages: string[];
  editor: string;
  branch: string;
};

/**
 * the most recent log, drives the live indicator
 */
export type Latest = {
  project: string;
  language: string;
  editor: string;
  branch: string;
  file: string;
  end: number;
};

export type Summary = {
  today: number;
  yesterday: number;
  // all-time average over active days, takatime's daily target
  average: number;
  streak: number;
  bestStreak: number;
  bestDay: { date: string; seconds: number } | null;
  allTime: number;
  activeDays: number;
  since: string | null;
};

export type Snapshot = {
  view: View;
  // no logs at all, regardless of filter
  empty: boolean;
  latest: Latest | null;
  summary: Summary;
  activity: {
    total: number;
    previous: number | null;
    unit: "hour" | "day" | "month";
    buckets: Bucket[];
  };
  // daily seconds from `start` up to today, padded to whole weeks
  calendar: { start: string; days: number[] };
  // seconds per local hour of day, within the range
  hours: number[];
  breakdown: Record<Dimension, Item[]>;
  files: Item[];
  // newest first, capped, sessionCount has the full number
  sessions: Session[];
  sessionCount: number;
};

/**
 * connection state of the server side data source
 */
export type Status =
  | { state: "connecting" }
  | { state: "ready"; mode: "stream" | "poll" }
  | { state: "error"; message: string }
  | { state: "unconfigured" };
