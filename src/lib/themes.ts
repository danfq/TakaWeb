/**
 * a takatime theme palette, same fields as its ThemeConfig
 */
export type Palette = {
  background: string
  text: string
  subtext: string
  bar: string
  colors: [string, string, string, string]
}

export type Theme = {
  id: string
  name: string
  light?: boolean
  palette: Palette
}

/**
 * every takatime theme, ported from its internal/types/themes.go
 */
export const THEMES: Theme[] = [
  {
    id: "default",
    name: "Default",
    palette: {
      background: "#0d1117",
      text: "#ffffff",
      subtext: "#8b949e",
      bar: "#30363d",
      colors: ["#58a6ff", "#2ea043", "#e3b341", "#f78166"],
    },
  },
  {
    id: "light",
    name: "Light",
    light: true,
    palette: {
      background: "#fdf6e3",
      text: "#657b83",
      subtext: "#93a1a1",
      bar: "#eee8d5",
      colors: ["#268bd2", "#859900", "#b58900", "#d33682"],
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    palette: {
      background: "#282a36",
      text: "#f8f8f2",
      subtext: "#6272a4",
      bar: "#44475a",
      colors: ["#bd93f9", "#50fa7b", "#ff79c6", "#8be9fd"],
    },
  },
  {
    id: "nord",
    name: "Nord",
    palette: {
      background: "#2e3440",
      text: "#d8dee9",
      subtext: "#4c566a",
      bar: "#3b4252",
      colors: ["#88c0d0", "#a3be8c", "#81a1c1", "#bf616a"],
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    palette: {
      background: "#282828",
      text: "#ebdbb2",
      subtext: "#928374",
      bar: "#3c3836",
      colors: ["#fabd2f", "#b8bb26", "#fe8019", "#fb4934"],
    },
  },
  {
    id: "monokai",
    name: "Monokai",
    palette: {
      background: "#272822",
      text: "#f8f8f2",
      subtext: "#75715e",
      bar: "#3e3d32",
      colors: ["#a6e22e", "#f92672", "#66d9ef", "#fd971f"],
    },
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    palette: {
      background: "#0b0e14",
      text: "#e0f7fa",
      subtext: "#ff0055",
      bar: "#181c25",
      colors: ["#00ff9f", "#f6019d", "#03a9f4", "#ffeb3b"],
    },
  },
  {
    id: "tokyonight",
    name: "Tokyo Night",
    palette: {
      background: "#1a1b26",
      text: "#c0caf5",
      subtext: "#565f89",
      bar: "#24283b",
      colors: ["#7aa2f7", "#9ece6a", "#e0af68", "#f7768e"],
    },
  },
  {
    id: "everforest",
    name: "Everforest",
    palette: {
      background: "#2b3339",
      text: "#d3c6aa",
      subtext: "#7a8478",
      bar: "#374145",
      colors: ["#a7c080", "#7fbbb3", "#dbbc7f", "#e67e80"],
    },
  },
  {
    id: "iceberg",
    name: "Iceberg",
    palette: {
      background: "#161821",
      text: "#d2d4de",
      subtext: "#6b7089",
      bar: "#1e2132",
      colors: ["#84a0c6", "#a093c7", "#89b8c2", "#e27878"],
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    palette: {
      background: "#1f1d2b",
      text: "#f8f8f2",
      subtext: "#a599e9",
      bar: "#2a273f",
      colors: ["#ff9e64", "#ffd580", "#ff6b6b", "#c678dd"],
    },
  },
  {
    id: "deepocean",
    name: "Deep Ocean",
    palette: {
      background: "#0f172a",
      text: "#e2e8f0",
      subtext: "#64748b",
      bar: "#1e293b",
      colors: ["#38bdf8", "#22c55e", "#f59e0b", "#ef4444"],
    },
  },
  {
    id: "midnight",
    name: "Midnight Purple",
    palette: {
      background: "#1b1325",
      text: "#e9d8fd",
      subtext: "#9f7aea",
      bar: "#2d1b3f",
      colors: ["#c084fc", "#60a5fa", "#34d399", "#f472b6"],
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    palette: {
      background: "#1e1e2e",
      text: "#cdd6f4",
      subtext: "#6c7086",
      bar: "#313244",
      colors: ["#89b4fa", "#a6e3a1", "#f9e2af", "#f38ba8"],
    },
  },
  {
    id: "solarized",
    name: "Solarized",
    palette: {
      background: "#002b36",
      text: "#93a1a1",
      subtext: "#586e75",
      bar: "#073642",
      colors: ["#268bd2", "#859900", "#b58900", "#dc322f"],
    },
  },
  {
    id: "onedark",
    name: "One Dark",
    palette: {
      background: "#282c34",
      text: "#abb2bf",
      subtext: "#5c6370",
      bar: "#3a3f4b",
      colors: ["#61afef", "#98c379", "#e5c07b", "#e06c75"],
    },
  },
  {
    id: "material",
    name: "Material",
    palette: {
      background: "#263238",
      text: "#eeffff",
      subtext: "#546e7a",
      bar: "#37474f",
      colors: ["#82aaff", "#c3e88d", "#ffcb6b", "#f07178"],
    },
  },
  {
    id: "synthwave",
    name: "Synthwave",
    palette: {
      background: "#241b2f",
      text: "#f8f8f2",
      subtext: "#ff7edb",
      bar: "#34294f",
      colors: ["#36f9f6", "#72f1b8", "#fede5d", "#ff5c8a"],
    },
  },
  {
    id: "rosepine",
    name: "Rosé Pine",
    palette: {
      background: "#191724",
      text: "#e0def4",
      subtext: "#908caa",
      bar: "#1f1d2e",
      colors: ["#eb6f92", "#f6c177", "#ebbcba", "#31748f"],
    },
  },
]

/**
 * follows the os, picking takatime's default or light theme
 */
export const SYSTEM_THEME = "system"

export const THEME_STORAGE_KEY = "takaweb-theme"

/**
 * css variables for every theme, keyed off data-theme on the root
 *
 * @returns {string} css
 */
export function themeCss(): string {
  return THEMES.map(({ id, palette }) => {
    const [c1, c2, c3, c4] = palette.colors

    return `[data-theme="${id}"]{--tt-bg:${palette.background};--tt-text:${palette.text};--tt-sub:${palette.subtext};--tt-bar:${palette.bar};--tt-c1:${c1};--tt-c2:${c2};--tt-c3:${c3};--tt-c4:${c4}}`
  }).join("")
}

/**
 * resolves and applies the stored theme before first paint
 * kept dependency free since it is inlined into the head
 */
export const THEME_SCRIPT = `(() => {
  const light = ${JSON.stringify(THEMES.filter((theme) => theme.light).map((theme) => theme.id))};
  const known = ${JSON.stringify(THEMES.map((theme) => theme.id))};
  const media = matchMedia("(prefers-color-scheme: light)");
  const root = document.documentElement;
  const apply = () => {
    let stored = null;
    try { stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}); } catch {}
    const preference = known.includes(stored) ? stored : ${JSON.stringify(SYSTEM_THEME)};
    const theme = preference === ${JSON.stringify(SYSTEM_THEME)} ? (media.matches ? "light" : "default") : preference;
    const isLight = light.includes(theme);
    root.dataset.theme = theme;
    root.dataset.themePreference = preference;
    root.classList.toggle("dark", !isLight);
    root.style.colorScheme = isLight ? "light" : "dark";
  };
  apply();
  window.__takawebTheme = apply;
  media.addEventListener("change", apply);
  addEventListener("storage", (event) => event.key === ${JSON.stringify(THEME_STORAGE_KEY)} && apply());
})();`
