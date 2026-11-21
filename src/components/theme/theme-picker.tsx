import { useSyncExternalStore } from "react";
import { Monitor, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SYSTEM_THEME,
  THEME_STORAGE_KEY,
  THEMES,
  type Palette as ThemePalette,
} from "@/lib/themes";

declare global {
  interface Window {
    __takawebTheme?: () => void;
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
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributeFilter: ["data-theme-preference"],
  });

  return () => observer.disconnect();
}

const getPreference = () =>
  document.documentElement.dataset.themePreference ?? SYSTEM_THEME;

/**
 * store a theme and apply it right away
 *
 * @param id theme id or system
 */
function choose(id: string) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {}

  window.__takawebTheme?.();
}

/**
 * a theme's background ringed by its four accents
 */
function Swatch({ palette }: { palette: ThemePalette }) {
  const [c1, c2, c3, c4] = palette.colors;

  return (
    <span
      aria-hidden
      className="grid size-5 shrink-0 place-items-center rounded-full ring-1 ring-foreground/15"
      style={{
        background: `conic-gradient(${c1} 0 25%, ${c2} 0 50%, ${c3} 0 75%, ${c4} 0)`,
      }}
    >
      <span
        className="size-3 rounded-full"
        style={{ background: palette.background }}
      />
    </span>
  );
}

/**
 * pick one of takatime's themes, or follow the os
 */
export default function ThemePicker() {
  const preference = useSyncExternalStore(
    subscribe,
    getPreference,
    () => SYSTEM_THEME,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Theme"
            title="Theme"
          />
        }
      >
        <Palette />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuRadioGroup value={preference} onValueChange={choose}>
          <DropdownMenuRadioItem value={SYSTEM_THEME}>
            <Monitor className="mx-0.5" />
            System
          </DropdownMenuRadioItem>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuLabel>TakaTime themes</DropdownMenuLabel>

            {THEMES.map((theme) => (
              <DropdownMenuRadioItem key={theme.id} value={theme.id}>
                <Swatch palette={theme.palette} />
                {theme.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
