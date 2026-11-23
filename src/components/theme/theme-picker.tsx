import { useSyncExternalStore } from "react"
import { Monitor, Moon, Palette, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SCHEME_THEMES,
  SYSTEM_THEME,
  THEME_STORAGE_KEY,
  THEMES,
  type Palette as ThemePalette,
  type Scheme,
} from "@/lib/themes"

declare global {
  interface Window {
    __takawebTheme?: () => void
  }
}

/**
 * watch the preference the head script applied to the root
 *
 * @param callback change handler
 *
 * @returns {() => void} unsubscribe
 */
function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, {
    attributeFilter: ["data-theme-preference", "data-theme-light", "data-theme-dark"],
  })

  return () => observer.disconnect()
}

const getPreference = () => document.documentElement.dataset.themePreference ?? SYSTEM_THEME
const getLight = () => document.documentElement.dataset.themeLight ?? SCHEME_THEMES.light.fallback
const getDark = () => document.documentElement.dataset.themeDark ?? SCHEME_THEMES.dark.fallback

/**
 * store theme choices and apply them right away
 *
 * @param entries storage key and theme id pairs
 */
function store(...entries: [string, string][]) {
  try {
    for (const [key, id] of entries) localStorage.setItem(key, id)
  } catch {}

  window.__takawebTheme?.()
}

/**
 * use a theme, or follow the os
 *
 * @param id theme id or system
 */
const choose = (id: string) => store([THEME_STORAGE_KEY, id])

/**
 * set the theme system mode uses for a scheme, and switch to system mode
 *
 * @param scheme os color scheme
 * @param id theme id
 */
const chooseFor = (scheme: Scheme, id: string) =>
  store([SCHEME_THEMES[scheme].key, id], [THEME_STORAGE_KEY, SYSTEM_THEME])

/**
 * find a theme's palette by id
 *
 * @param id theme id
 *
 * @returns {ThemePalette} palette, the first theme's if unknown
 */
const paletteOf = (id: string): ThemePalette => (THEMES.find((theme) => theme.id === id) ?? THEMES[0]).palette

/**
 * a theme's background ringed by its four accents
 */
function Swatch({ palette }: { palette: ThemePalette }) {
  const [c1, c2, c3, c4] = palette.colors

  return (
    <span
      aria-hidden
      className="ring-foreground/15 grid size-5 shrink-0 place-items-center rounded-full ring-1"
      style={{
        background: `conic-gradient(${c1} 0 25%, ${c2} 0 50%, ${c3} 0 75%, ${c4} 0)`,
      }}>
      <span className="size-3 rounded-full" style={{ background: palette.background }} />
    </span>
  )
}

/**
 * every theme as radio items
 */
function ThemeItems() {
  return THEMES.map((theme) => (
    <DropdownMenuRadioItem key={theme.id} value={theme.id}>
      <Swatch palette={theme.palette} />
      {theme.name}
    </DropdownMenuRadioItem>
  ))
}

/**
 * submenu picking the theme system mode uses for a scheme
 */
function SchemeMenu({ scheme, value }: { scheme: Scheme; value: string }) {
  const Icon = scheme === "light" ? Sun : Moon

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2.5">
        <Icon className="mx-0.5" />
        {scheme === "light" ? "Light mode" : "Dark mode"}
        <span className="ml-auto">
          <Swatch palette={paletteOf(value)} />
        </span>
      </DropdownMenuSubTrigger>

      <DropdownMenuSubContent className="w-56">
        <DropdownMenuRadioGroup value={value} onValueChange={(id: string) => chooseFor(scheme, id)}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {scheme === "light" ? "When the system is light" : "When the system is dark"}
            </DropdownMenuLabel>
            <ThemeItems />
          </DropdownMenuGroup>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/**
 * pick one of takatime's themes, or follow the os with a theme for each scheme
 */
export default function ThemePicker() {
  const preference = useSyncExternalStore(subscribe, getPreference, () => SYSTEM_THEME)
  const light = useSyncExternalStore(subscribe, getLight, () => SCHEME_THEMES.light.fallback)
  const dark = useSyncExternalStore(subscribe, getDark, () => SCHEME_THEMES.dark.fallback)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Theme" title="Theme" />}>
        <Palette />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuRadioGroup value={preference} onValueChange={choose}>
          <DropdownMenuRadioItem value={SYSTEM_THEME}>
            <Monitor className="mx-0.5" />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <SchemeMenu scheme="light" value={light} />
        <SchemeMenu scheme="dark" value={dark} />

        <DropdownMenuSeparator />

        <DropdownMenuRadioGroup value={preference} onValueChange={choose}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>TakaTime themes</DropdownMenuLabel>
            <ThemeItems />
          </DropdownMenuGroup>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
