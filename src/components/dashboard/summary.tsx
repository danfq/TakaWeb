import type { ReactNode } from "react"
import { cn } from "cn"
import { CalendarClock, Flame, Gauge, Timer, type LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { useDuration, useLocale } from "@/components/dashboard/locale"
import { day } from "@/lib/stats/format"
import type { Summary as SummaryData } from "@/lib/stats/types"

/**
 * one headline number
 */
function Stat({
  icon: Icon,
  title,
  value,
  children,
  className,
}: {
  icon: LucideIcon
  title: string
  value: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <Card size="sm" className={cn("min-w-0 gap-1 rounded-3xl px-4 shadow-none", className)}>
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Icon className="size-3.5" />
        {title}
      </div>
      <div className="font-heading truncate text-xl font-semibold tracking-tight tabular-nums lg:text-2xl">
        {value}
      </div>
      <div className="text-muted-foreground truncate text-xs">{children}</div>
    </Card>
  )
}

/**
 * headline stats, takatime's daily target, streak and totals
 */
export default function Summary({ summary, live }: { summary: SummaryData; live: boolean }) {
  const { locale } = useLocale()
  const duration = useDuration()
  const target = summary.average
  const progress = target ? Math.min(1, summary.today / target) : 0

  return (
    <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <Stat icon={Timer} title="Today" value={duration(summary.today)}>
        <div className="flex items-center gap-2">
          <div
            className="bg-muted h-1 flex-1 overflow-hidden rounded-full"
            title="Progress towards your daily average">
            <div
              className={cn(
                "bg-primary h-full rounded-full transition-[width] duration-500 ease-out",
                live && "animate-pulse"
              )}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <span className="shrink-0 tabular-nums">
            {target ? `${Math.round((summary.today / target) * 100)}%` : "-"}
          </span>
        </div>
      </Stat>

      <Stat icon={Flame} title="Streak" value={`${summary.streak} ${summary.streak === 1 ? "day" : "days"}`}>
        Best {summary.bestStreak} {summary.bestStreak === 1 ? "day" : "days"}
      </Stat>

      <Stat icon={Gauge} title="Daily average" value={duration(summary.average)}>
        {summary.bestDay
          ? `Record ${duration(summary.bestDay.seconds)} on ${day(summary.bestDay.date, locale, { month: "short", day: "numeric", year: "numeric" })}`
          : "No record yet"}
      </Stat>

      <Stat icon={CalendarClock} title="All time" value={duration(summary.allTime)}>
        {summary.since
          ? `${summary.activeDays} active days since ${day(summary.since, locale, { month: "short", year: "numeric" })}`
          : "Nothing logged yet"}
      </Stat>
    </div>
  )
}
