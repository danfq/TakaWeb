import { cn } from "cn";
import { GitBranch } from "lucide-react";
import { Section, SectionBody } from "@/components/dashboard/section";
import { duration, label, time } from "@/lib/stats/format";
import type { Session } from "@/lib/stats/types";

/**
 * local day key of an instant
 *
 * @param ms epoch ms
 *
 * @returns {string} YYYY-MM-DD in the browser's timezone
 */
const localKey = (ms: number): string =>
  new Date(ms).toLocaleDateString("en-CA");

/**
 * name a day relative to today
 *
 * @param ms epoch ms within the day
 * @param now current epoch ms
 *
 * @returns {string} Today, Yesterday or a date
 */
function dayName(ms: number, now: number): string {
  const key = localKey(ms);

  if (key === localKey(now)) return "Today";
  if (key === localKey(now - 86_400_000)) return "Yesterday";

  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
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
  const days = new Map<string, Session[]>();

  for (const session of sessions) {
    const name = dayName(session.start, now);
    days.set(name, [...(days.get(name) ?? []), session]);
  }

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

        {[...days].map(([name, list]) => (
          <div key={name}>
            <h3 className="sticky top-0 z-10 bg-card py-1.5 text-xs font-medium text-muted-foreground">
              {name}
              <span className="ml-2 font-normal tabular-nums">
                {duration(
                  list.reduce((sum, session) => sum + session.seconds, 0),
                )}
              </span>
            </h3>

            <ul className="mb-2">
              {list.map((session) => {
                const live = session.end >= liveSince;

                return (
                  <li
                    key={`${session.project}-${session.start}`}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border/60 py-2.5 last:border-0"
                  >
                    <span className="relative flex size-2">
                      {live && (
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                      )}
                      <span
                        className={cn(
                          "relative size-2 rounded-full",
                          live && "bg-emerald-500",
                        )}
                        style={
                          live
                            ? undefined
                            : {
                                background:
                                  colors.get(session.project) ??
                                  "var(--chart-5)",
                              }
                        }
                      />
                    </span>

                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {label("project", session.project)}
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="shrink-0 tabular-nums">
                          {time(session.start)} to{" "}
                          {live ? "now" : time(session.end)}
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
                          <span className="hidden shrink-0 items-center gap-0.5 xl:inline-flex">
                            · <GitBranch className="size-3" />
                            {session.branch}
                          </span>
                        )}
                        {session.editor && (
                          <span className="hidden shrink-0 2xl:inline">
                            · {label("editor", session.editor)}
                          </span>
                        )}
                      </div>
                    </div>

                    <span className="text-sm tabular-nums">
                      {duration(session.seconds)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </SectionBody>
    </Section>
  );
}
