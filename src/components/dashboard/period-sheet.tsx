import { useState, type ReactNode } from "react";
import { ChevronLeft, TrendingDown, TrendingUp } from "lucide-react";
import { DayParts } from "@/components/dashboard/activity";
import BarChart from "@/components/dashboard/bar-chart";
import { useLocale } from "@/components/dashboard/locale";
import Ranking, { rankColor } from "@/components/dashboard/ranking";
import { SessionRow } from "@/components/dashboard/sessions";
import { useDetail } from "@/components/dashboard/use-detail";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { change, day, duration, label, time } from "@/lib/stats/format";
import { dayPeriod, isMonth } from "@/lib/stats/period";
import type {
  Bucket,
  Detail,
  Item,
  PeriodRange,
  View,
} from "@/lib/stats/types";

/**
 * rows a list shows before "show all"
 */
const LIST_PREVIEW = 6;

/**
 * a log this recent means the editor is still sending, matches the dashboard
 */
const LIVE_WINDOW = 3 * 60 * 1000;

/**
 * name a period
 *
 * @param period period
 * @param locale bcp 47 locale
 *
 * @returns {string} title
 */
function title(period: PeriodRange, locale: string): string {
  if (period.from === period.to) {
    return day(period.from, locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  if (isMonth(period)) {
    return day(period.from.slice(0, 7), locale, {
      month: "long",
      year: "numeric",
    });
  }

  return `${day(period.from, locale)} to ${day(period.to, locale)}`;
}

/**
 * name the period a detail compares against
 *
 * @param period period
 * @param locale bcp 47 locale
 *
 * @returns {string} label
 */
function previousLabel(period: PeriodRange, locale: string): string {
  if (period.from === period.to) return "the day before";

  if (isMonth(period)) {
    const date = new Date(`${period.from}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - 1);

    return day(date.toISOString().slice(0, 7), locale, { month: "long" });
  }

  return "the period before";
}

/**
 * one headline number
 */
function Stat({
  title,
  value,
  children,
}: {
  title: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-2xl bg-muted/50 px-3.5 py-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="mt-0.5 truncate font-heading text-lg font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      {children && (
        <div className="truncate text-xs text-muted-foreground">{children}</div>
      )}
    </div>
  );
}

/**
 * a titled block of the sheet
 */
function Block({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {aside && (
          <span className="text-xs text-muted-foreground">{aside}</span>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * a ranking that starts short and can expand
 */
function RankingBlock({
  title,
  items,
  dimension,
  view,
  project,
}: {
  title: string;
  items: Item[];
  dimension: Parameters<typeof Ranking>[0]["dimension"];
  view: View;
  project?: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, LIST_PREVIEW);

  return (
    <Block
      title={title}
      aside={
        items.length > LIST_PREVIEW && (
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => setAll(!all)}
          >
            {all ? "Show less" : `Show all ${items.length}`}
          </button>
        )
      }
    >
      <Ranking
        items={shown}
        dimension={dimension}
        filter={view.filter}
        project={project}
      />
    </Block>
  );
}

/**
 * placeholder while the first detail loads
 */
function Loading() {
  return (
    <div className="flex flex-col gap-6 px-6 pb-6">
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-[4.75rem] animate-pulse rounded-2xl bg-muted/50"
          />
        ))}
      </div>
      <div className="h-44 animate-pulse rounded-2xl bg-muted/50" />
      <div className="h-48 animate-pulse rounded-2xl bg-muted/50" />
    </div>
  );
}

/**
 * everything about one period
 */
function Insights({
  detail,
  view,
  now,
  onPeriod,
}: {
  detail: Detail;
  view: View;
  now: number;
  onPeriod: (period: PeriodRange) => void;
}) {
  const { locale, tz } = useLocale();
  const [hovered, setHovered] = useState<number | null>(null);

  const single = detail.unit === "hour";
  const ratio = change(detail.total, detail.previous);
  const TrendIcon = ratio !== null && ratio < 0 ? TrendingDown : TrendingUp;

  const peak = detail.buckets.reduce<Bucket | null>(
    (best, bucket) =>
      bucket.seconds > 0 && (!best || bucket.seconds > best.seconds)
        ? bucket
        : best,
    null,
  );

  const colors = new Map(
    detail.breakdown.project.map((item, index) => [
      item.name,
      rankColor(index),
    ]),
  );
  const byProject =
    view.filter?.dimension === "project" ? view.filter.value : undefined;

  /**
   * label for a bucket
   *
   * @param bucket bucket
   *
   * @returns {string} label
   */
  const describe = (bucket: Bucket) =>
    single
      ? `${bucket.key}:00 to ${String((Number(bucket.key) + 1) % 24).padStart(2, "0")}:00`
      : day(bucket.key, locale);

  const bucket = hovered === null ? null : detail.buckets[hovered];

  if (detail.total === 0) {
    return (
      <p className="px-6 py-10 text-center text-sm text-muted-foreground">
        No activity in this period
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-7 px-6 pb-6">
      {/* headline */}
      <div className="grid grid-cols-2 gap-2">
        <Stat title="Coded" value={duration(detail.total)}>
          {ratio !== null && (
            <span className="inline-flex items-center gap-1">
              <TrendIcon className="size-3.5" />
              <span className="text-foreground tabular-nums">
                {ratio >= 0 ? "+" : ""}
                {Math.round(ratio * 100)}%
              </span>
              vs {previousLabel(detail, locale)}
            </span>
          )}
        </Stat>

        {single ? (
          <Stat
            title="Active between"
            value={
              detail.first !== null && detail.last !== null
                ? `${time(detail.first, locale, tz)} to ${time(detail.last, locale, tz)}`
                : "-"
            }
          >
            First to last log
          </Stat>
        ) : (
          <Stat
            title="Active days"
            value={`${detail.activeDays} of ${detail.days}`}
          >
            {detail.activeDays
              ? `${duration(detail.total / detail.activeDays)} per active day`
              : "No active days"}
          </Stat>
        )}

        <Stat title="Sessions" value={detail.sessionCount}>
          {detail.longest &&
            `Longest ${duration(detail.longest.seconds)}, ${label("project", detail.longest.project)}`}
        </Stat>

        <Stat
          title={single ? "Busiest hour" : "Best day"}
          value={peak ? duration(peak.seconds) : "-"}
        >
          {peak && (single ? `${peak.key}:00` : day(peak.key, locale))}
        </Stat>
      </div>

      {/* chart */}
      <Block
        title={single ? "By hour" : "By day"}
        aside={
          bucket
            ? `${describe(bucket)} · ${duration(bucket.seconds)}`
            : !single && "Pick a day to open it"
        }
      >
        <BarChart
          className="h-44"
          buckets={detail.buckets}
          tick={(bucket, index) =>
            single
              ? index % 6 === 0
                ? bucket.key
                : ""
              : index === 0 || index % 7 === 0
                ? day(bucket.key, locale, { day: "numeric", month: "short" })
                : ""
          }
          current={peak ? detail.buckets.indexOf(peak) : undefined}
          hovered={hovered}
          onHover={setHovered}
          describe={describe}
          onSelect={
            single
              ? undefined
              : (index) => onPeriod(dayPeriod(detail.buckets[index].key))
          }
        />
      </Block>

      {!single && (
        <Block title="Time of day">
          <DayParts hours={detail.hours} />
        </Block>
      )}

      <RankingBlock
        title="Projects"
        items={detail.breakdown.project}
        dimension="project"
        view={view}
      />

      {byProject && (
        <RankingBlock
          title="Branches"
          items={detail.breakdown.branch}
          dimension="branch"
          view={view}
        />
      )}

      <RankingBlock
        title="Languages"
        items={detail.breakdown.language}
        dimension="language"
        view={view}
      />

      <RankingBlock
        title="Editors"
        items={detail.breakdown.editor}
        dimension="editor"
        view={view}
      />

      <RankingBlock
        title="Files"
        items={detail.files}
        dimension="file"
        view={view}
        project={byProject}
      />

      <Block
        title="Sessions"
        aside={
          detail.sessionCount > detail.sessions.length &&
          `Latest ${detail.sessions.length} of ${detail.sessionCount}`
        }
      >
        <ul className="@container">
          {detail.sessions.map((session) => (
            <SessionRow
              key={`${session.project}-${session.start}`}
              session={session}
              color={colors.get(session.project)}
              live={session.end >= now - LIVE_WINDOW}
            />
          ))}
        </ul>
      </Block>
    </div>
  );
}

/**
 * detailed insights for a period picked in the charts, can drill from a month into its days
 */
export default function PeriodSheet({
  periods,
  onPeriods,
  view,
  revision,
  today,
  now,
}: {
  // opened periods, the last one is shown
  periods: PeriodRange[];
  onPeriods: (periods: PeriodRange[]) => void;
  view: View;
  // the dashboard's live snapshot, refreshes periods that include today
  revision: unknown;
  // today's key in the dashboard's timezone
  today: string;
  now: number;
}) {
  const { locale } = useLocale();
  const period = periods.at(-1) ?? null;
  const live = !!period && period.to >= today;

  const { detail, failed } = useDetail(view, period, live ? revision : null);

  // the last loaded detail stays up while the next one loads
  const loading =
    !!period &&
    (!detail || detail.from !== period.from || detail.to !== period.to);

  const filter = view.filter
    ? `${label(view.filter.dimension, view.filter.value)} only`
    : "Everything";

  return (
    <Sheet
      open={!!period}
      onOpenChange={(open) => {
        if (!open) onPeriods([]);
      }}
    >
      <SheetContent
        resizable
        storageKey="takaweb-detail-width"
        defaultWidth={520}
        className="gap-0"
      >
        {period && (
          <>
            <SheetHeader className="pr-14">
              <div className="flex items-center gap-2">
                {periods.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Back"
                    title="Back"
                    className="-ml-2"
                    onClick={() => onPeriods(periods.slice(0, -1))}
                  >
                    <ChevronLeft />
                  </Button>
                )}
                <SheetTitle className="truncate text-lg">
                  {title(period, locale)}
                </SheetTitle>
                {loading && detail && (
                  <Spinner className="size-3.5 text-muted-foreground" />
                )}
              </div>

              <SheetDescription className="flex items-center gap-2">
                {filter}
                {live && (
                  <span className="inline-flex items-center gap-1.5">
                    ·
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    Live
                  </span>
                )}
              </SheetDescription>
            </SheetHeader>

            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
              {failed && !detail ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  Could not load this period
                </p>
              ) : detail ? (
                <Insights
                  detail={detail}
                  view={view}
                  now={now}
                  onPeriod={(next) => onPeriods([...periods, next])}
                />
              ) : (
                <Loading />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
