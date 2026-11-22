import { cn } from "cn";
import { GitBranch } from "lucide-react";
import { Section, SectionBody } from "@/components/dashboard/section";
import { useDuration, useLocale } from "@/components/dashboard/locale";
import { day, dayKey, label, time } from "@/lib/stats/format";
import type { Session } from "@/lib/stats/types";

/**
 * name a day relative to today
 *
 * @param ms epoch ms within the day
 * @param now current epoch ms
 * @param locale bcp 47 locale
 * @param tz iana timezone
 *
 * @returns {string} Today, Yesterday or a date
 */
function dayName(ms: number, now: number, locale: string, tz: string): string {
  const key = dayKey(ms, tz);

  if (key === dayKey(now, tz)) return "Today";
  if (key === dayKey(now - 86_400_000, tz)) return "Yesterday";

  return day(key, locale, { weekday: "long", month: "short", day: "numeric" });
}

/**
 * one session: project, time span, languages and duration
 */
export function SessionRow({
  session,
  color,
  live,
}: {
  session: Session;
  color?: string;
  // still going, pulses and ends "now"
  live: boolean;
}) {
  const duration = useDuration();
  const { locale, tz, hour12 } = useLocale();

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border/60 py-2.5 last:border-0">
      <span className="relative flex size-2">
        {live && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
        )}
        <span
          className={cn(
            "relative size-2 rounded-full",
            live && "bg-emerald-500",
          )}
          style={live ? undefined : { background: color ?? "var(--chart-5)" }}
        />
      </span>

      <div className="min-w-0">
        <div className="truncate text-sm font-medium" data-sensitive>
          {label("project", session.project)}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0 tabular-nums">
            {time(session.start, locale, tz, hour12)} to{" "}
            {live ? "now" : time(session.end, locale, tz, hour12)}
          </span>
          {session.languages.length > 0 && (
            <span className="truncate">
              ·{" "}
              {session.languages
                .map((name) => label("language", name))
                .join(", ")}
            </span>
          )}
          {session.branch && (
            <span className="hidden shrink-0 items-center gap-0.5 @lg:inline-flex">
              · <GitBranch className="size-3" />
              <span data-sensitive>{session.branch}</span>
            </span>
          )}
          {session.editor && (
            <span className="hidden shrink-0 @2xl:inline">
              · {label("editor", session.editor)}
            </span>
          )}
        </div>
      </div>

      <span className="text-sm tabular-nums">{duration(session.seconds)}</span>
    </li>
  );
}

type SessionsProps = {
  sessions: Session[];
  count: number;
  colors: Map<string, string>;
  // sessions ending after this are still going
  liveSince: number;
  now: number;
  className?: string;
};

/**
 * sessions grouped under their local start day, with a total per day
 */
export function SessionDays({
  sessions,
  colors,
  liveSince,
  now,
  headingClassName = "bg-card",
}: {
  sessions: Session[];
  colors: Map<string, string>;
  // sessions ending after this are still going
  liveSince: number;
  now: number;
  // sticky headings need the background they scroll over
  headingClassName?: string;
}) {
  const duration = useDuration();
  const { locale, tz } = useLocale();
  const days = new Map<string, Session[]>();

  for (const session of sessions) {
    const name = dayName(session.start, now, locale, tz);
    days.set(name, [...(days.get(name) ?? []), session]);
  }

  return [...days].map(([name, list]) => (
    <div key={name}>
      <h3
        className={cn(
          "sticky top-0 z-10 py-1.5 text-xs font-medium text-muted-foreground",
          headingClassName,
        )}
      >
        {name}
        <span className="ml-2 font-normal tabular-nums">
          {duration(list.reduce((sum, session) => sum + session.seconds, 0))}
        </span>
      </h3>

      <ul className="mb-2 @container">
        {list.map((session) => (
          <SessionRow
            key={`${session.project}-${session.start}`}
            session={session}
            color={colors.get(session.project)}
            live={session.end >= liveSince}
          />
        ))}
      </ul>
    </div>
  ));
}

/**
 * recent stretches of work, newest first, grouped by day
 */
export default function Sessions({
  sessions,
  count,
  colors,
  liveSince,
  now,
  className,
}: SessionsProps) {
  return (
    <Section
      title="Sessions"
      description={
        count > sessions.length
          ? `Latest ${sessions.length} of ${count} in this range`
          : `${count} in this range`
      }
      className={className}
    >
      <SectionBody className="pb-3">
        {sessions.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No sessions in this range
          </p>
        )}

        <SessionDays
          sessions={sessions}
          colors={colors}
          liveSince={liveSince}
          now={now}
        />
      </SectionBody>
    </Section>
  );
}
