import { useState, type ReactNode } from "react";
import { cn } from "cn";
import {
  Moon,
  Sun,
  Sunrise,
  Sunset,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import BarChart from "@/components/dashboard/bar-chart";
import Calendar from "@/components/dashboard/calendar";
import { SectionBody, TabbedSection } from "@/components/dashboard/section";
import { change, day } from "@/lib/stats/format";
import { useDuration, useLocale } from "@/components/dashboard/locale";
import { dayPeriod, monthPeriod, samePeriod } from "@/lib/stats/period";
import type {
  Bucket,
  Period,
  PeriodRange,
  Range,
  Snapshot,
} from "@/lib/stats/types";

/**
 * the period whose details are open, and a way to open another
 */
type Selection = {
  selected: PeriodRange | null;
  onOpen: (period: PeriodRange) => void;
};

type Unit = Period["activity"]["unit"];

export const RANGE_LABELS: Record<Range, string> = {
  today: "Today",
  week: "Last 7 days",
  month: "Last 30 days",
  year: "Last 12 months",
  all: "All time",
};

const PREVIOUS_LABELS: Record<Range, string> = {
  today: "yesterday",
  week: "the 7 days before",
  month: "the 30 days before",
  year: "the 12 months before",
  all: "",
};

/**
 * takatime's coder personas, by part of the day
 */
const PARTS: {
  label: string;
  persona: string;
  from: number;
  to: number;
  icon: LucideIcon;
}[] = [
  { label: "Morning", persona: "Early Bird", from: 6, to: 12, icon: Sunrise },
  {
    label: "Afternoon",
    persona: "Afternoon Architect",
    from: 12,
    to: 18,
    icon: Sun,
  },
  {
    label: "Evening",
    persona: "Evening Engineer",
    from: 18,
    to: 24,
    icon: Sunset,
  },
  { label: "Night", persona: "Midnight Vampire", from: 0, to: 6, icon: Moon },
];

/**
 * big number with a caption, swapped for the hovered value
 */
function Readout({ value, caption }: { value: string; caption: ReactNode }) {
  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pb-3">
      <span className="font-heading text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{caption}</span>
    </div>
  );
}

/**
 * change against the previous period
 */
function Trend({ ratio, against }: { ratio: number | null; against: string }) {
  if (ratio === null) return null;

  const Icon = ratio >= 0 ? TrendingUp : TrendingDown;

  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="size-3.5" />
      <span className="text-foreground tabular-nums">
        {ratio >= 0 ? "+" : ""}
        {Math.round(ratio * 100)}%
      </span>
      vs {against}
    </span>
  );
}

/**
 * describe a timeline bucket
 *
 * @param unit bucket unit
 * @param bucket bucket
 * @param locale bcp 47 locale
 *
 * @returns {string} label
 */
function describe(unit: Unit, bucket: Bucket, locale: string): string {
  if (unit === "hour") {
    const next = String((Number(bucket.key) + 1) % 24).padStart(2, "0");
    return `Today, ${bucket.key}:00 to ${next}:00`;
  }

  if (unit === "day") return day(bucket.key, locale);

  return day(bucket.key, locale, { month: "long", year: "numeric" });
}

/**
 * axis labels, thinned out so they never collide
 *
 * @param unit bucket unit
 * @param buckets buckets
 * @param locale bcp 47 locale
 *
 * @returns tick formatter
 */
function ticks(unit: Unit, buckets: Bucket[], locale: string) {
  const last = buckets.length - 1;

  return (bucket: Bucket, index: number): string => {
    if (unit === "hour") return index % 3 === 0 ? bucket.key : "";

    if (unit === "day") {
      if (buckets.length <= 7)
        return day(bucket.key, locale, { weekday: "short" });
      return (last - index) % 5 === 0
        ? day(bucket.key, locale, { day: "numeric", month: "short" })
        : "";
    }

    // months, every one when they fit, otherwise every quarter or year, januaries show the year
    const every = buckets.length <= 13 ? 1 : buckets.length <= 36 ? 3 : 12;
    if ((last - index) % every !== 0) return "";

    return bucket.key.endsWith("-01") || every === 12
      ? bucket.key.slice(0, 4)
      : day(bucket.key, locale, { month: "short" });
  };
}

/**
 * the range as a bar chart
 */
function Timeline({
  period,
  range,
  live,
  selected,
  onOpen,
}: Selection & {
  period: Period;
  range: Range;
  live: boolean;
}) {
  const duration = useDuration();
  const [hovered, setHovered] = useState<number | null>(null);
  const { locale } = useLocale();
  const { activity } = period;
  const bucket = hovered === null ? null : activity.buckets[hovered];

  // days and months open their details, today's hours already are the details
  const toPeriod =
    activity.unit === "day"
      ? (bucket: Bucket) => dayPeriod(bucket.key)
      : activity.unit === "month"
        ? (bucket: Bucket) => monthPeriod(bucket.key)
        : null;
  const open = toPeriod
    ? activity.buckets.findIndex((bucket) =>
        samePeriod(toPeriod(bucket), selected),
      )
    : -1;

  return (
    <>
      {bucket ? (
        <Readout
          value={duration(bucket.seconds)}
          caption={describe(activity.unit, bucket, locale)}
        />
      ) : (
        <Readout
          value={duration(activity.total)}
          caption={
            <span className="inline-flex flex-wrap items-center gap-x-3">
              {RANGE_LABELS[range]}
              <Trend
                ratio={change(activity.total, activity.previous)}
                against={PREVIOUS_LABELS[range]}
              />
            </span>
          }
        />
      )}

      <SectionBody className="flex flex-col">
        <BarChart
          className="flex-1"
          buckets={activity.buckets}
          tick={ticks(activity.unit, activity.buckets, locale)}
          current={activity.current}
          hovered={hovered}
          onHover={setHovered}
          live={live}
          selected={open === -1 ? null : open}
          describe={(bucket) => describe(activity.unit, bucket, locale)}
          onSelect={
            toPeriod
              ? (index) => onOpen(toPeriod(activity.buckets[index]))
              : undefined
          }
        />
      </SectionBody>
    </>
  );
}

/**
 * a year of days, takatime's contribution graph
 */
function YearGraph({
  snapshot,
  selected,
  onOpen,
}: Selection & { snapshot: Snapshot }) {
  const duration = useDuration();
  const [hovered, setHovered] = useState<string | null>(null);
  const { locale } = useLocale();
  const { calendar, summary } = snapshot;

  const index = hovered
    ? Math.round(
        (Date.parse(hovered) - Date.parse(calendar.start)) / 86_400_000,
      )
    : -1;
  const active = calendar.days.filter((seconds) => seconds > 0).length;

  return (
    <>
      {hovered ? (
        <Readout
          value={duration(calendar.days[index] ?? 0)}
          caption={day(hovered, locale)}
        />
      ) : (
        <Readout
          value={`${active} days`}
          caption={`active in the last year, best streak ${summary.bestStreak} days`}
        />
      )}

      <SectionBody>
        <Calendar
          start={calendar.start}
          days={calendar.days}
          hovered={hovered}
          onHover={setHovered}
          selected={selected?.from === selected?.to ? selected?.from : null}
          onSelect={(key) => onOpen(dayPeriod(key))}
        />
      </SectionBody>
    </>
  );
}

/**
 * split hour of day seconds into takatime's parts of the day
 *
 * @param hours seconds per hour of day
 *
 * @returns parts with their seconds, the busiest one and the total
 */
export function dayParts(hours: number[]) {
  const total = hours.reduce((sum, seconds) => sum + seconds, 0);
  const parts = PARTS.map((part) => ({
    ...part,
    seconds: hours
      .slice(part.from, part.to)
      .reduce((sum, seconds) => sum + seconds, 0),
  }));
  const top = parts.reduce((best, part) =>
    part.seconds > best.seconds ? part : best,
  );

  return { parts, top, total };
}

/**
 * morning, afternoon, evening and night with share bars
 */
export function DayParts({
  hours,
  className,
}: {
  hours: number[];
  className?: string;
}) {
  const duration = useDuration();
  const { parts, top, total } = dayParts(hours);

  return (
    <div className={cn("grid shrink-0 grid-cols-2 gap-x-4 gap-y-3", className)}>
      {parts.map(({ label, icon: Icon, seconds }) => (
        <div key={label} className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="size-3.5" />
            {label}
          </div>
          <div className="mt-0.5 text-sm font-medium tabular-nums">
            {duration(seconds)}
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full bg-primary transition-[width] duration-500",
                label !== top.label && "opacity-55",
              )}
              style={{ width: `${total ? (seconds / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * when in the day the coding happens, with takatime's persona
 */
function Hours({ period, range }: { period: Period; range: Range }) {
  const duration = useDuration();
  const [hovered, setHovered] = useState<number | null>(null);
  const { hours } = period;
  const { top, total } = dayParts(hours);

  const buckets = hours.map((seconds, hour) => ({
    key: String(hour).padStart(2, "0"),
    seconds,
  }));

  return (
    <>
      {hovered !== null ? (
        <Readout
          value={duration(hours[hovered])}
          caption={`between ${buckets[hovered].key}:00 and ${String((hovered + 1) % 24).padStart(2, "0")}:00, ${RANGE_LABELS[range].toLowerCase()}`}
        />
      ) : (
        <Readout
          value={total ? top.persona : "Resting Developer"}
          caption={
            total
              ? `${Math.round((top.seconds / total) * 100)}% of your coding happens in the ${top.label.toLowerCase()}`
              : "No activity in this range"
          }
        />
      )}

      <SectionBody className="flex flex-col gap-4">
        <BarChart
          className="flex-1"
          buckets={buckets}
          tick={(bucket, index) => (index % 3 === 0 ? bucket.key : "")}
          current={hovered ?? undefined}
          hovered={hovered}
          onHover={setHovered}
        />

        <DayParts hours={hours} className="sm:grid-cols-4" />
      </SectionBody>
    </>
  );
}

/**
 * coded time over the range, with the year and time of day behind tabs
 */
export default function Activity({
  snapshot,
  range,
  live,
  selected,
  onOpen,
  className,
}: Selection & {
  snapshot: Snapshot;
  range: Range;
  live: boolean;
  className?: string;
}) {
  const period = snapshot.ranges[range];
  const [tab, setTab] = useState("timeline");

  return (
    <TabbedSection
      title="Activity"
      className={className}
      value={tab}
      onValueChange={setTab}
      tabs={[
        {
          value: "timeline",
          label: "Timeline",
          content: (
            <Timeline
              period={period}
              range={range}
              live={live}
              selected={selected}
              onOpen={onOpen}
            />
          ),
        },
        {
          value: "calendar",
          label: "Calendar",
          content: (
            <YearGraph
              snapshot={snapshot}
              selected={selected}
              onOpen={onOpen}
            />
          ),
        },
        {
          value: "hours",
          label: "Hours",
          content: <Hours period={period} range={range} />,
        },
      ]}
    />
  );
}
