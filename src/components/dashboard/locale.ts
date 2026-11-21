import { createContext, useContext } from "react";

/**
 * locale and timezone shared by the server render and the browser, so both format alike
 */
export type Locale = { locale: string; tz: string };

const LocaleContext = createContext<Locale>({ locale: "en-US", tz: "UTC" });

export const LocaleProvider = LocaleContext.Provider;

/**
 * the dashboard's locale and timezone
 *
 * @returns {Locale} locale
 */
export const useLocale = (): Locale => useContext(LocaleContext);
