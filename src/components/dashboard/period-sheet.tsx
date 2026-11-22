import { useState, type ReactNode } from "react"
import { ChevronLeft, CircleAlert, TrendingDown, TrendingUp } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { DayParts } from "@/components/dashboard/activity"
import BarChart from "@/components/dashboard/bar-chart"
import { useDuration, useLocale } from "@/components/dashboard/locale"
import Ranking, { rankColor } from "@/components/dashboard/ranking"
import { SessionDays, SessionRow } from "@/components/dashboard/sessions"
import { useDetail } from "@/components/dashboard/use-detail"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { change, day, hour, label, sensitive, time } from "@/lib/stats/format"
import { dayPeriod, isMonth } from "@/lib/stats/period"
import type { Bucket, Detail, Item, PeriodRange, View } from "@/lib/stats/types"

/**
 * rows a list shows before "show all"
 */
const LIST_PREVIEW = 6

/**
 * a log this recent means the editor is still sending, matches the dashboard
 */
const LIVE_WINDOW = 3 * 60 * 1000

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
    })
  }

  if (isMonth(period)) {
    return day(period.from.slice(0, 7), locale, {
      month: "long",
      year: "numeric",
    })
  }

  return `${day(period.from, locale)} to ${day(period.to, locale)}`
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
  if (period.from === period.to) return "the day before"

  if (isMonth(period)) {
    const date = new Date(`${period.from}T00:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() - 1)

    return day(date.toISOString().slice(0, 7), locale, { month: "long" })
  }

  return "the period before"
}

/**
 * one headline number
 */
function Stat({ title, value, children }: { title: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="bg-muted/50 min-w-0 rounded-2xl px-3.5 py-3">
      <div className="text-muted-foreground text-xs">{title}</div>
      <div className="font-heading mt-0.5 truncate text-lg font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      {children && <div className="text-muted-foreground truncate text-xs">{children}</div>}
    </div>
  )
}

/**
 * a titled block of the sheet
 */
function Block({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {aside && <span className="text-muted-foreground text-xs">{aside}</span>}
      </header>
      {children}
    </section>
  )
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
  title: string
  items: Item[]
  dimension: Parameters<typeof Ranking>[0]["dimension"]
  view: View
  project?: string
}) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, LIST_PREVIEW)

  return (
    <Block
      title={title}
      aside={
        items.length > LIST_PREVIEW && (
          <button type="button" className="hover:text-foreground" onClick={() => setAll(!all)}>
            {all ? "Show less" : `Show all ${items.length}`}
          </button>
        )
      }>
      <Ranking items={shown} dimension={dimension} filter={view.filter} project={project} />
    </Block>
  )
}

/**
 * placeholder while the first detail loads
 */
function Loading() {
  return (
    <div className="flex flex-col gap-6 px-6 pb-6">
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="bg-muted/50 h-[4.75rem] animate-pulse rounded-2xl" />
        ))}
      </div>
      <div className="bg-muted/50 h-44 animate-pulse rounded-2xl" />
      <div className="bg-muted/50 h-48 animate-pulse rounded-2xl" />
    </div>
  )
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
  detail: Detail
  view: View
  now: number
  onPeriod: (period: PeriodRange) => void
}) {
  const duration = useDuration()
  const { locale, tz, hour12 } = useLocale()
  const [hovered, setHovered] = useState<number | null>(null)

  const single = detail.unit === "hour"
  const ratio = change(detail.total, detail.previous)
  const TrendIcon = ratio !== null && ratio < 0 ? TrendingDown : TrendingUp

  const peak = detail.buckets.reduce<Bucket | null>(
    (best, bucket) => (bucket.seconds > 0 && (!best || bucket.seconds > best.seconds) ? bucket : best),
    null
  )

  const colors = new Map(detail.breakdown.project.map((item, index) => [item.name, rankColor(index)]))
  const byProject = view.filter?.dimension === "project" ? view.filter.value : undefined

  /**
   * label for a bucket
   *
   * @param bucket bucket
   *
   * @returns {string} label
   */
  const describe = (bucket: Bucket) =>
    single
      ? `${hour(bucket.key, locale, hour12)} to ${hour(Number(bucket.key) + 1, locale, hour12)}`
      : day(bucket.key, locale)

  const bucket = hovered === null ? null : detail.buckets[hovered]

  if (detail.total === 0) {
    return <p className="text-muted-foreground px-6 py-10 text-center text-sm">No activity in this period</p>
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
                ? `${time(detail.first, locale, tz, hour12)} to ${time(detail.last, locale, tz, hour12)}`
                : "-"
            }>
            First to last log
          </Stat>
        ) : (
          <Stat title="Active days" value={`${detail.activeDays} of ${detail.days}`}>
            {detail.activeDays
              ? `${duration(detail.total / detail.activeDays)} per active day`
              : "No active days"}
          </Stat>
        )}

        <Stat title="Sessions" value={detail.sessionCount}>
          {detail.longest && (
            <>
              Longest {duration(detail.longest.seconds)},{" "}
              <span data-sensitive>{label("project", detail.longest.project)}</span>
            </>
          )}
        </Stat>

        <Stat title={single ? "Busiest hour" : "Best day"} value={peak ? duration(peak.seconds) : "-"}>
          {peak && (single ? hour(peak.key, locale, hour12) : day(peak.key, locale))}
        </Stat>
      </div>

      {/* chart */}
      <Block
        title={single ? "By hour" : "By day"}
        aside={
          bucket ? `${describe(bucket)} · ${duration(bucket.seconds)}` : !single && "Pick a day to open it"
        }>
        <BarChart
          className="h-44"
          buckets={detail.buckets}
          tick={(bucket, index) =>
            single
              ? index % 6 === 0
                ? hour(bucket.key, locale, hour12, true)
                : ""
              : index === 0 || index % 7 === 0
                ? day(bucket.key, locale, { day: "numeric", month: "short" })
                : ""
          }
          current={peak ? detail.buckets.indexOf(peak) : undefined}
          hovered={hovered}
          onHover={setHovered}
          describe={describe}
          onSelect={single ? undefined : (index) => onPeriod(dayPeriod(detail.buckets[index].key))}
        />
      </Block>

      {!single && (
        <Block title="Time of day">
          <DayParts hours={detail.hours} />
        </Block>
      )}

      <RankingBlock title="Projects" items={detail.breakdown.project} dimension="project" view={view} />

      {byProject && (
        <RankingBlock title="Branches" items={detail.breakdown.branch} dimension="branch" view={view} />
      )}

      <RankingBlock title="Languages" items={detail.breakdown.language} dimension="language" view={view} />

      <RankingBlock title="Editors" items={detail.breakdown.editor} dimension="editor" view={view} />

      <RankingBlock title="Files" items={detail.files} dimension="file" view={view} project={byProject} />

      <Block
        title="Sessions"
        aside={
          detail.sessionCount > detail.sessions.length &&
          `Latest ${detail.sessions.length} of ${detail.sessionCount}`
        }>
        {single ? (
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
        ) : (
          // several days, so each session sits under its start day
          <SessionDays
            sessions={detail.sessions}
            colors={colors}
            liveSince={now - LIVE_WINDOW}
            now={now}
            headingClassName="bg-popover"
          />
        )}
      </Block>
    </div>
  )
}

/**
 * detailed insights for a period picked in the charts, can drill from a month into its days
 */
export default function PeriodSheet({
  periods,
  onPeriods,
  view,
  revision,
  imports,
  today,
  now,
}: {
  // opened periods, the last one is shown
  periods: PeriodRange[]
  onPeriods: (periods: PeriodRange[]) => void
  view: View
  // the dashboard's live snapshot, refreshes periods that include today
  revision: unknown
  // imported logs version, refreshes past periods when imports change
  imports: number | undefined
  // today's key in the dashboard's timezone
  today: string
  now: number
}) {
  const { locale } = useLocale()
  const period = periods.at(-1) ?? null

  // refresh with each live snapshot while the requested period includes today,
  // past periods only change when imported logs do
  const { detail, current, failed, retry } = useDetail(
    view,
    period,
    !!period && period.to >= today ? revision : imports
  )

  // label everything after what is on screen: the loaded detail, or the request
  // when nothing matching loaded, so old numbers never sit under a new title or filter
  const showsRequest = failed ? !current : !detail
  const shown: PeriodRange & { view: View } =
    showsRequest || !detail ? { from: period?.from ?? "", to: period?.to ?? "", view } : detail
  const pending = !current && !failed
  const live = !!period && shown.to >= today

  const filter = shown.view.filter ? (
    <span>
      <span data-sensitive={sensitive(shown.view.filter.dimension)}>
        {label(shown.view.filter.dimension, shown.view.filter.value)}
      </span>{" "}
      only
    </span>
  ) : (
    "Everything"
  )

  return (
    <Sheet
      open={!!period}
      onOpenChange={(open) => {
        if (!open) onPeriods([])
      }}>
      <SheetContent resizable storageKey="takaweb-detail-width" defaultWidth={520} className="gap-0">
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
                    onClick={() => onPeriods(periods.slice(0, -1))}>
                    <ChevronLeft />
                  </Button>
                )}
                <SheetTitle className="truncate text-lg">{title(shown, locale)}</SheetTitle>
                {pending && detail && <Spinner className="text-muted-foreground size-3.5" />}
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

            <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto">
              {failed && !current ? (
                <div className="text-muted-foreground flex flex-col items-center gap-3 px-6 py-10 text-center text-sm">
                  Could not load this period
                  <Button variant="secondary" size="sm" onClick={retry}>
                    Try again
                  </Button>
                </div>
              ) : detail ? (
                <>
                  {/* a failed refresh keeps the last numbers, but says they may be outdated */}
                  {failed && (
                    <Alert variant="destructive" className="mx-6 mb-5 w-auto">
                      <CircleAlert />
                      <AlertTitle>Could not refresh this period</AlertTitle>
                      <AlertDescription className="flex flex-col items-start gap-2">
                        These numbers may be outdated.
                        <Button variant="secondary" size="sm" onClick={retry}>
                          Try again
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}
                  <Insights
                    detail={detail}
                    view={detail.view}
                    now={now}
                    onPeriod={(next) => onPeriods([...periods, next])}
                  />
                </>
              ) : (
                <Loading />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
