import { cn } from "cn"
import { shortDuration } from "@/lib/stats/format"
import type { Bucket } from "@/lib/stats/types"

const MINUTE = 60
const HOUR = 60 * MINUTE

/**
 * round a peak up to a readable axis maximum
 *
 * @param seconds peak value
 *
 * @returns {number} axis maximum in seconds
 */
function niceMax(seconds: number): number {
  if (seconds <= 0) return HOUR

  if (seconds <= HOUR) {
    return Math.max(15, Math.ceil(seconds / MINUTE / 15) * 15) * MINUTE
  }

  const hours = seconds / HOUR
  const magnitude = 10 ** Math.floor(Math.log10(hours))
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => step * magnitude >= hours)

  return (step ?? 10) * magnitude * HOUR
}

type BarChartProps = {
  buckets: Bucket[]
  // axis label per bucket, empty to skip
  tick: (bucket: Bucket, index: number) => string
  // bucket to emphasise, usually the current one
  current?: number
  hovered: number | null
  onHover: (index: number | null) => void
  // pulse the current bar while coding
  live?: boolean
  // bars become buttons when set
  onSelect?: (index: number) => void
  // bucket whose details are open
  selected?: number | null
  // accessible name for a selectable bar
  describe?: (bucket: Bucket) => string
  className?: string
}

/**
 * vertical bars of coded time with a light grid
 */
export default function BarChart({
  buckets,
  tick,
  current,
  hovered,
  onHover,
  live,
  onSelect,
  selected = null,
  describe,
  className,
}: BarChartProps) {
  const max = niceMax(Math.max(0, ...buckets.map((bucket) => bucket.seconds)))
  const dense = buckets.length > 20

  // hovering wins, then the open bucket, then the current one
  const focus = hovered ?? selected

  return (
    <div className={cn("flex min-h-36 flex-col pt-2", className)} onMouseLeave={() => onHover(null)}>
      <div className="relative min-h-0 flex-1">
        {/* grid */}
        {[1, 0.5, 0].map((fraction) => (
          <div
            key={fraction}
            className="border-border absolute inset-x-0 border-t border-dashed"
            style={{ bottom: `${fraction * 100}%` }}>
            {fraction > 0 && (
              <span className="text-muted-foreground absolute -top-2 right-0 text-[10px] leading-none tabular-nums">
                {shortDuration(max * fraction)}
              </span>
            )}
          </div>
        ))}

        {/* bars */}
        <div className={cn("absolute inset-0 right-9 flex items-end", dense ? "gap-0.5" : "gap-1.5")}>
          {buckets.map((bucket, index) => {
            const bar = (
              <div
                className={cn(
                  "bg-primary w-full rounded-t-[min(6px,30%)] transition-[height,opacity] duration-500 ease-out",
                  focus === null
                    ? index === current
                      ? "opacity-100"
                      : "opacity-55"
                    : focus === index
                      ? "opacity-100"
                      : "opacity-35",
                  live && index === current && "animate-pulse"
                )}
                style={{
                  height: `${(bucket.seconds / max) * 100}%`,
                  minHeight: bucket.seconds > 0 ? 2 : 0,
                }}
              />
            )

            return onSelect ? (
              <button
                key={bucket.key}
                type="button"
                aria-label={describe?.(bucket)}
                aria-pressed={selected === index}
                className="flex h-full min-w-0 flex-1 items-end rounded-t-md outline-none"
                onMouseEnter={() => onHover(index)}
                onFocus={() => onHover(index)}
                onBlur={() => onHover(null)}
                onClick={() => onSelect(index)}>
                {bar}
              </button>
            ) : (
              <div
                key={bucket.key}
                className="flex h-full min-w-0 flex-1 items-end"
                onMouseEnter={() => onHover(index)}>
                {bar}
              </div>
            )
          })}
        </div>
      </div>

      {/* ticks */}
      <div className={cn("mr-9 flex pt-2", dense ? "gap-0.5" : "gap-1.5")}>
        {buckets.map((bucket, index) => (
          <span
            key={bucket.key}
            className={cn(
              "text-muted-foreground min-w-0 flex-1 overflow-visible text-center text-[10px] whitespace-nowrap tabular-nums",
              (index === current || index === focus) && "text-foreground"
            )}>
            {tick(bucket, index)}
          </span>
        ))}
      </div>
    </div>
  )
}
