import { createContext, useContext } from "react"
import { duration } from "@/lib/stats/format"

/**
 * locale and timezone shared by the server render and the browser, so both format alike
 * hour12 and decimal come from settings, hour12 undefined lets the locale decide
 */
export type Locale = {
  locale: string
  tz: string
  hour12?: boolean
  decimal?: boolean
}

const LocaleContext = createContext<Locale>({ locale: "en-US", tz: "UTC" })

export const LocaleProvider = LocaleContext.Provider

/**
 * the dashboard's locale and timezone
 *
 * @returns {Locale} locale
 */
export const useLocale = (): Locale => useContext(LocaleContext)

/**
 * duration formatter following the duration setting
 *
 * @returns {(seconds: number) => string} formatter
 */
export function useDuration(): (seconds: number) => string {
  const { decimal } = useLocale()

  return (seconds) => duration(seconds, decimal)
}
