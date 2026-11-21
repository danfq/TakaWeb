import { cn } from "cn";
import { day } from "@/lib/stats/format";

const HOUR = 3600;

/**
 * takatime's heatmap levels: none, up to 1h, up to 3h, more
 * its tui leans on glyph density, so here intensity is the primary colour's opacity
 */
const LEVELS = ["bg-muted", "bg-primary/30", "bg-primary/60", "bg-primary"];

/**
 * heat level for a day
 *
 * @param seconds coded time
 *
 * @returns {number} level index
 */
const level = (seconds: number): number =>
  seconds <= 0 ? 0 : seconds <= HOUR ? 1 : seconds <= 3 * HOUR ? 2 : 3;

/**
 * shift a day key
 *
 * @param key YYYY-MM-DD
 * @param offset days to add
 *
 * @returns {string} shifted key
 */
function addDays(key: string, offset: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);

  return date.toISOString().slice(0, 10);
}

type CalendarProps = {
  start: string;
  days: number[];
  hovered: string | null;
  onHover: (key: string | null) => void;
};

/**
 * a year of daily activity, one column per week, like takatime's contribution graph
 */
export default function Calendar({
  start,
  days,
  hovered,
  onHover,
}: CalendarProps) {
  const weeks = Math.ceil(days.length / 7);
  const columns = `1.75rem repeat(${weeks}, minmax(0, 1fr))`;

  // label a week column when a month starts inside it
  const months: { column: number; label: string }[] = [];
  for (let week = 0; week < weeks; week++) {
    for (let weekday = 0; weekday < 7; weekday++) {
      const key = addDays(start, week * 7 + weekday);

      if (key.endsWith("-01") && week * 7 + weekday < days.length) {
        months.push({ column: week + 2, label: day(key, { month: "short" }) });
      }
    }
  }

  return (
    <div
      className="mx-auto w-full max-w-[64rem]"
      onMouseLeave={() => onHover(null)}
    >
      {/* months */}
      <div
        className="mb-1.5 grid gap-[3px]"
        style={{ gridTemplateColumns: columns }}
      >
        {months.map((month) => (
          <span
            key={month.column}
            className="text-[10px] whitespace-nowrap text-muted-foreground"
            style={{ gridColumn: month.column, gridRow: 1 }}
          >
            {month.label}
          </span>
        ))}
      </div>

      <div
        className="grid grid-flow-col grid-rows-7 gap-[3px]"
        style={{ gridTemplateColumns: columns }}
      >
        {/* weekdays */}
        {["", "Mon", "", "Wed", "", "Fri", ""].map((name, row) => (
          <span
            key={row}
            className="self-center text-[10px] leading-none text-muted-foreground"
            style={{ gridColumn: 1, gridRow: row + 1 }}
          >
            {name}
          </span>
        ))}

        {days.map((seconds, index) => {
          const key = addDays(start, index);

          return (
            <span
              key={key}
              className={cn(
                "aspect-square rounded-[3px] transition-colors",
                LEVELS[level(seconds)],
                hovered === key && "ring-2 ring-foreground/60",
              )}
              style={{
                gridColumn: Math.floor(index / 7) + 2,
                gridRow: (index % 7) + 1,
              }}
              onMouseEnter={() => onHover(key)}
            />
          );
        })}
      </div>

      {/* legend */}
      <div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
        Less
        {LEVELS.map((color) => (
          <span key={color} className={cn("size-2.5 rounded-[3px]", color)} />
        ))}
        More
      </div>
    </div>
  );
}
