import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "cn"
import { Database, Radio, type LucideIcon } from "lucide-react"
import Activity from "@/components/dashboard/activity"
import DashboardHeader from "@/components/dashboard/dashboard-header"
import { LocaleProvider } from "@/components/dashboard/locale"
import PeriodSheet from "@/components/dashboard/period-sheet"
import Ranking, { rankColor } from "@/components/dashboard/ranking"
import { SectionBody, TabbedSection } from "@/components/dashboard/section"
import Sessions from "@/components/dashboard/sessions"
import Summary from "@/components/dashboard/summary"
import { useStream } from "@/components/dashboard/use-stream"
import { fixedRange, hour12, useSettings } from "@/lib/settings"
import { dayKey, duration } from "@/lib/stats/format"
import type { Filter, PeriodRange, Range, Snapshot, Status } from "@/lib/stats/types"
import { rememberRange, writeFilter } from "@/lib/stats/view"

/**
 * a log this recent means the editor is still sending, takatime uploads every minute
 */
const LIVE_WINDOW = 3 * 60 * 1000

const SECTIONS = [
  { value: "activity", label: "Activity" },
  { value: "projects", label: "Projects" },
  { value: "languages", label: "Languages" },
  { value: "sessions", label: "Sessions" },
] as const

type SectionName = (typeof SECTIONS)[number]["value"]

/**
 * everything the server rendered the page with, so the first client render matches it
 */
export type DashboardProps = {
  snapshot: Snapshot | null
  status: Status
  range: Range
  filter: Filter | null
  tz: string
  locale: string
  now: number
}

/**
 * re-render on an interval, keeps relative times and the live state fresh
 *
 * @param initial time the page was rendered at
 * @param interval tick in ms
 *
 * @returns {number} current epoch ms
 */
function useNow(initial: number, interval: number): number {
  const [now, setNow] = useState(initial)

  useEffect(() => {
    setNow(Date.now())

    const timer = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(timer)
  }, [interval])

  return now
}

/**
 * centered message filling the main area
 */
function Notice({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="bg-muted flex size-11 items-center justify-center rounded-full">
        <Icon className="size-5" />
      </div>
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="text-muted-foreground max-w-md text-sm">{children}</div>
    </div>
  )
}

/**
 * placeholder while the first snapshot loads
 */
function Skeleton() {
  return (
    <>
      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="bg-card ring-foreground/10 h-[5.5rem] animate-pulse rounded-3xl ring-1"
          />
        ))}
      </div>
      <div className="bg-card ring-foreground/10 min-h-0 flex-1 animate-pulse rounded-4xl ring-1" />
    </>
  )
}

/**
 * the four sections, side by side on desktop and one at a time on mobile
 */
function Board({
  snapshot,
  range,
  live,
  now,
  filter,
  onFilter,
  selected,
  onOpen,
}: {
  snapshot: Snapshot
  range: Range
  live: boolean
  now: number
  filter: Filter | null
  onFilter: (filter: Filter | null) => void
  selected: PeriodRange | null
  onOpen: (period: PeriodRange) => void
}) {
  const [section, setSection] = useState<SectionName>("activity")
  const [projectTab, setProjectTab] = useState("project")
  const [languageTab, setLanguageTab] = useState("language")

  const { breakdown, files, sessionCount, start } = snapshot.ranges[range]
  // a session belongs to the range it started in
  const sessions = snapshot.sessions.filter((session) => session.start >= start)

  // branches only mean something inside one project
  const byProject = filter?.dimension === "project" ? filter.value : undefined
  const projectValue = projectTab === "branch" && !byProject ? "project" : projectTab

  const colors = new Map(breakdown.project.map((item, index) => [item.name, rankColor(index)]))

  /**
   * classes for a section, hidden on mobile unless picked
   *
   * @param name section
   * @param desktop extra desktop classes
   *
   * @returns {string} classes
   */
  const place = (name: SectionName, desktop: string) =>
    cn(section === name ? "flex" : "hidden", "min-h-0 flex-1 lg:flex", desktop)

  return (
    <>
      {/* mobile section picker */}
      <nav className="flex shrink-0 gap-1 overflow-x-auto px-3 pt-3 lg:hidden">
        {SECTIONS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={section === item.value}
            className="text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground h-8 rounded-full px-3 text-xs font-medium transition-colors"
            onClick={() => setSection(item.value)}>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Activity
          snapshot={snapshot}
          range={range}
          live={live}
          selected={selected}
          onOpen={onOpen}
          className={place("activity", "lg:border-b")}
        />

        <TabbedSection
          title="Projects"
          description={`${breakdown.project.length} in this range`}
          className={place("projects", "lg:border-b lg:border-l")}
          value={projectValue}
          onValueChange={setProjectTab}
          tabs={[
            {
              value: "project",
              label: "Projects",
              content: (
                <SectionBody>
                  <Ranking
                    items={breakdown.project}
                    dimension="project"
                    filter={filter}
                    onFilter={onFilter}
                  />
                </SectionBody>
              ),
            },
            ...(byProject
              ? [
                  {
                    value: "branch",
                    label: "Branches",
                    content: (
                      <SectionBody>
                        <Ranking items={breakdown.branch} dimension="branch" filter={filter} />
                      </SectionBody>
                    ),
                  },
                ]
              : []),
            {
              value: "file",
              label: "Files",
              content: (
                <SectionBody>
                  <Ranking items={files} dimension="file" filter={filter} project={byProject} />
                </SectionBody>
              ),
            },
          ]}
        />

        <Sessions
          sessions={sessions}
          count={sessionCount}
          colors={colors}
          liveSince={now - LIVE_WINDOW}
          now={now}
          className={place("sessions", "")}
        />

        <TabbedSection
          title="Languages"
          description={`${breakdown.language.length} in this range`}
          className={place("languages", "lg:border-l")}
          value={languageTab}
          onValueChange={setLanguageTab}
          tabs={[
            {
              value: "language",
              label: "Languages",
              items: breakdown.language,
            },
            { value: "editor", label: "Editors", items: breakdown.editor },
            { value: "os", label: "Systems", items: breakdown.os },
          ].map(({ value, label, items }) => ({
            value,
            label,
            content: (
              <SectionBody>
                <Ranking
                  items={items}
                  dimension={value as Filter["dimension"]}
                  filter={filter}
                  onFilter={onFilter}
                />
              </SectionBody>
            ),
          }))}
        />
      </div>
    </>
  )
}

/**
 * the live takatime dashboard
 */
export default function Dashboard(initial: DashboardProps) {
  const [range, setRange] = useState(initial.range)
  const [filter, setFilter] = useState(initial.filter)
  const [tz, setTz] = useState(initial.tz)
  // periods open in the details sheet, drilled into from left to right
  const [periods, setPeriods] = useState<PeriodRange[]>([])

  const { snapshot, status, connected, stale } = useStream({ tz, filter }, initial)
  const now = useNow(initial.now, 15_000)
  const settings = useSettings()

  const latest = snapshot?.latest ?? null
  const live = !!latest && now - latest.end < LIVE_WINDOW

  const decimal = settings.durations === "decimal"
  // page title before any live status was added to it
  const baseTitle = useRef("")

  // the server falls back to utc until the timezone cookie exists
  useEffect(() => {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (browser !== tz) setTz(browser)

    baseTitle.current = document.title
  }, [])

  // the next server render opens on the fixed range, or wherever this one was left
  useEffect(() => rememberRange(fixedRange(settings) ?? range), [range, settings.defaultRange])

  // today's time in the tab, with a dot while coding
  useEffect(() => {
    document.title =
      settings.tabTitle && snapshot
        ? `${live ? "● " : ""}${duration(snapshot.summary.today, decimal)} today · ${baseTitle.current}`
        : baseTitle.current
  }, [settings.tabTitle, snapshot, live, decimal])

  /**
   * switch filter and mirror it in the url
   *
   * @param next filter or null
   */
  const changeFilter = (next: Filter | null) => {
    setFilter(next)

    const url = new URL(location.href)
    writeFilter(url.searchParams, next)

    history.replaceState(history.state, "", url)
  }

  let content: ReactNode

  if (status.state === "unconfigured") {
    content = (
      <Notice icon={Database} title="Connect TakaTime">
        Set <code className="bg-muted text-foreground rounded px-1.5 py-0.5">MONGO_URI</code> to the MongoDB
        your editors log to, then restart TakaWeb. A read-only user is enough.
      </Notice>
    )
  } else if (!snapshot) {
    content = <Skeleton />
  } else {
    content = (
      <>
        <Summary summary={snapshot.summary} live={live} />

        <div className="bg-card ring-foreground/10 flex min-h-0 flex-1 flex-col overflow-hidden rounded-4xl ring-1">
          {snapshot.empty ? (
            <Notice icon={Radio} title="Waiting for your first log">
              Start coding in an editor with the TakaTime plugin pointed at this database. This page updates
              the moment your first log lands.
            </Notice>
          ) : (
            <Board
              snapshot={snapshot}
              range={range}
              live={live}
              now={now}
              filter={filter}
              onFilter={changeFilter}
              selected={periods[0] ?? null}
              onOpen={(period) => setPeriods([period])}
            />
          )}
        </div>
      </>
    )
  }

  return (
    <LocaleProvider
      value={{
        locale: initial.locale,
        tz,
        hour12: hour12(settings.timeFormat),
        decimal,
      }}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DashboardHeader
          status={status}
          connected={connected}
          loading={!snapshot && status.state !== "unconfigured"}
          pending={stale}
          latest={latest}
          live={live}
          now={now}
          range={range}
          onRange={setRange}
          filter={filter}
          onFilter={changeFilter}
        />

        <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 lg:gap-4 lg:px-6 lg:pb-6">
          {content}
        </main>

        <PeriodSheet
          periods={periods}
          onPeriods={setPeriods}
          view={{ tz, filter }}
          revision={snapshot}
          imports={snapshot?.imports}
          today={dayKey(now, tz)}
          now={now}
        />
      </div>
    </LocaleProvider>
  )
}
