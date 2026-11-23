import { expect, test } from "vitest"
import { SCHEME_THEMES, THEME_SCRIPT, THEME_STORAGE_KEY } from "@/lib/themes"

/**
 * run the head script against a fake browser
 *
 * @param stored local storage contents
 * @param prefersLight whether the os is in light mode
 *
 * @returns {{ dataset: Record<string, string>, dark: boolean, scheme: string }} root state
 */
function run(stored: Record<string, string>, prefersLight: boolean) {
  const dataset: Record<string, string> = {}
  const classes = new Set<string>()
  const style = { colorScheme: "" }

  const root = {
    dataset,
    style,
    classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
  }

  new Function("document", "localStorage", "matchMedia", "window", "addEventListener", THEME_SCRIPT)(
    { documentElement: root },
    { getItem: (key: string) => stored[key] ?? null },
    () => ({ matches: prefersLight, addEventListener: () => {} }),
    {},
    () => {}
  )

  return { dataset, dark: classes.has("dark"), scheme: style.colorScheme }
}

test("system mode falls back to takatime's light and default themes", () => {
  expect(run({}, true)).toMatchObject({ dataset: { theme: "light", themePreference: "system" }, dark: false })
  expect(run({}, false)).toMatchObject({
    dataset: { theme: "default", themePreference: "system" },
    dark: true,
  })
})

test("system mode uses the chosen theme for each scheme", () => {
  const stored = { [SCHEME_THEMES.light.key]: "solarized", [SCHEME_THEMES.dark.key]: "nord" }

  expect(run(stored, true)).toMatchObject({
    dataset: { theme: "solarized", themeLight: "solarized", themeDark: "nord" },
    scheme: "dark",
  })
  expect(run(stored, false).dataset.theme).toBe("nord")
})

test("a fixed theme ignores the scheme choices", () => {
  const stored = { [THEME_STORAGE_KEY]: "dracula", [SCHEME_THEMES.light.key]: "light" }

  expect(run(stored, true).dataset).toMatchObject({ theme: "dracula", themePreference: "dracula" })
})

test("unknown stored ids fall back", () => {
  const stored = {
    [THEME_STORAGE_KEY]: "nope",
    [SCHEME_THEMES.light.key]: "system",
    [SCHEME_THEMES.dark.key]: "gone",
  }

  expect(run(stored, true).dataset).toMatchObject({
    theme: "light",
    themePreference: "system",
    themeLight: "light",
  })
  expect(run(stored, false).dataset).toMatchObject({ theme: "default", themeDark: "default" })
})
