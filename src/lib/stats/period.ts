import type { PeriodRange } from "@/lib/stats/types"

/**
 * a single day
 *
 * @param key YYYY-MM-DD
 *
 * @returns {PeriodRange} period
 */
export const dayPeriod = (key: string): PeriodRange => ({ from: key, to: key })

/**
 * a whole calendar month
 *
 * @param month YYYY-MM
 *
 * @returns {PeriodRange} period
 */
export function monthPeriod(month: string): PeriodRange {
  const [year, index] = month.split("-").map(Number)
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate()

  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`,
  }
}

/**
 * whether a period is exactly one calendar month
 *
 * @param period period
 *
 * @returns {boolean} whether it is a whole month
 */
export const isMonth = (period: PeriodRange): boolean =>
  monthPeriod(period.from.slice(0, 7)).to === period.to && period.from.endsWith("-01")

/**
 * whether two periods cover the same days
 *
 * @param a first period
 * @param b second period
 *
 * @returns {boolean} whether they match
 */
export const samePeriod = (a: PeriodRange | null | undefined, b: PeriodRange | null | undefined): boolean =>
  !!a && !!b && a.from === b.from && a.to === b.to
