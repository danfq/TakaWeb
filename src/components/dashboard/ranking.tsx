import { cn } from "cn";
import { useDuration } from "@/components/dashboard/locale";
import { useNamesHidden } from "@/lib/settings";
import { filePath, label, sensitive } from "@/lib/stats/format";
import type { Dimension, Filter, Item } from "@/lib/stats/types";

/**
 * takatime colours list rows by cycling its palette
 */
const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/**
 * palette colour for a ranked row
 *
 * @param index row index
 *
 * @returns {string} css colour
 */
export const rankColor = (index: number): string =>
  COLORS[index % COLORS.length];

type RankingProps = {
  items: Item[];
  dimension: Dimension | "file";
  filter: Filter | null;
  // rows become filter toggles when set
  onFilter?: (filter: Filter | null) => void;
  // trims file paths to the project folder
  project?: string;
};

/**
 * names ranked by coded time, with share bars
 */
export default function Ranking({
  items,
  dimension,
  filter,
  onFilter,
  project,
}: RankingProps) {
  const duration = useDuration();
  // tooltips would show hidden names in full
  const hidden = useNamesHidden() && sensitive(dimension);

  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No activity in this range
      </p>
    );
  }

  const max = items[0].share || 1;

  return (
    <ul className="-mx-2 flex flex-col">
      {items.map((item, index) => {
        const active =
          filter?.dimension === dimension && filter.value === item.name;
        const color = rankColor(index);
        const file = dimension === "file" ? filePath(item.name, project) : null;

        const content = (
          <>
            <div className="flex items-center gap-2.5 text-sm">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: color }}
              />

              <span
                className="min-w-0 truncate font-medium"
                title={hidden ? undefined : item.name}
                data-sensitive={sensitive(dimension)}
              >
                {file ? file.name : label(dimension, item.name)}
                {file?.dir && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {file.dir}
                  </span>
                )}
              </span>

              <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                {duration(item.seconds)}
              </span>
              <span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {Math.round(item.share * 100)}%
              </span>
            </div>

            <div className="mt-1.5 ml-4.5 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${(item.share / max) * 100}%`,
                  background: color,
                }}
              />
            </div>
          </>
        );

        return (
          <li key={item.name}>
            {onFilter && dimension !== "file" ? (
              <button
                type="button"
                aria-pressed={active}
                title={
                  active
                    ? "Clear filter"
                    : hidden
                      ? "Only show this one"
                      : `Only show ${label(dimension, item.name)}`
                }
                className={cn(
                  "w-full rounded-2xl px-2 py-2 text-left transition-colors outline-none hover:bg-muted/60",
                  active && "bg-muted",
                )}
                onClick={() =>
                  onFilter(
                    active
                      ? null
                      : {
                          dimension: dimension as Filter["dimension"],
                          value: item.name,
                        },
                  )
                }
              >
                {content}
              </button>
            ) : (
              <div className="px-2 py-2">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
