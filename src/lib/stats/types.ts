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
 * dimensions a view can be filtered by, branches only make sense within a project
 */
export const FILTERABLE = ["project", "language", "editor", "os"] as const;

/**
 * narrows every stat down to logs matching one value
 */
export type Filter = { dimension: (typeof FILTERABLE)[number]; value: string };

/**
 * what a client subscribes to, every range comes along so switching is instant
 */
export type View = { tz: string; filter: Filter | null };

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

/**
 * everything that depends on the range
 */
export type Period = {
  // range start, epoch ms
  start: number;
  activity: {
    total: number;
    previous: number | null;
    unit: "hour" | "day" | "month";
    buckets: Bucket[];
    // bucket holding right now
    current: number;
  };
  // seconds per local hour of day
  hours: number[];
  breakdown: Record<Dimension, Item[]>;
  files: Item[];
  sessionCount: number;
};

export type Snapshot = {
  view: View;
  // no logs at all, regardless of filter
  empty: boolean;
  latest: Latest | null;
  summary: Summary;
  // daily seconds from `start` up to today, padded to whole weeks
  calendar: { start: string; days: number[] };
  // latest sessions across all time, newest first, ranges cut them by start
  sessions: Session[];
  ranges: Record<Range, Period>;
};

/**
 * connection state of the server side data source
 */
export type Status =
  | { state: "connecting" }
  | { state: "ready" }
  // the server cannot push changes, mongo has to run as a replica set
  | { state: "unsupported" }
  | { state: "error"; message: string }
  | { state: "unconfigured" };
