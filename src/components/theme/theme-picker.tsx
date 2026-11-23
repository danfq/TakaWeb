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
  type ThemeMode,
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
 * force a scheme, or follow the os
 *
 * @param mode theme mode
 */
const choose = (mode: ThemeMode) => store([THEME_STORAGE_KEY, mode])

/**
 * set the theme a scheme uses, and switch to system mode
 *
 * @param scheme color scheme
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
 * a scheme's mode option, with a button opening its theme list
 */
function SchemeOption({ scheme, value }: { scheme: Scheme; value: string }) {
  const Icon = scheme === "light" ? Sun : Moon
  const name = scheme === "light" ? "Light" : "Dark"

  return (
    <div className="flex items-center gap-1">
      <DropdownMenuRadioItem value={scheme} className="flex-1">
        <Icon className="mx-0.5" />
        {name}
      </DropdownMenuRadioItem>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger
          openOnHover={false}
          aria-label={`${name} theme`}
          title={`${name} theme`}
          className="gap-1 px-2">
          <Swatch palette={paletteOf(value)} />
        </DropdownMenuSubTrigger>

        <DropdownMenuSubContent className="w-56">
          <DropdownMenuRadioGroup value={value} onValueChange={(id: string) => chooseFor(scheme, id)}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>{name} theme</DropdownMenuLabel>
              {THEMES.map((theme) => (
                <DropdownMenuRadioItem key={theme.id} value={theme.id}>
                  <Swatch palette={theme.palette} />
                  {theme.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </div>
  )
}

/**
 * follow the os or force a scheme, each scheme with its own theme
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

      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuRadioGroup value={preference} onValueChange={choose}>
          <DropdownMenuRadioItem value={SYSTEM_THEME}>
            <Monitor className="mx-0.5" />
            System
          </DropdownMenuRadioItem>
          <SchemeOption scheme="light" value={light} />
          <SchemeOption scheme="dark" value={dark} />
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
