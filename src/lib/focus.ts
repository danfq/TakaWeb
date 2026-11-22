/**
 * keys that move focus, unlike escape or enter, which also follow clicks
 */
const NAVIGATION_KEYS = [
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]

/**
 * marks the page as keyboard driven after a navigation key, and pointer driven after any press
 * focus outlines only show in keyboard mode, so clicks and restored focus never draw one
 */
export const FOCUS_SCRIPT = `(() => {
  const root = document.documentElement;
  const keys = ${JSON.stringify(NAVIGATION_KEYS)};
  addEventListener("keydown", (event) => {
    if (keys.includes(event.key)) root.dataset.focus = "keyboard";
  }, true);
  addEventListener("pointerdown", () => {
    delete root.dataset.focus;
  }, true);
})();`

/**
 * switch to keyboard mode, for shortcuts that move focus such as opening a sheet
 */
export function keyboardMode() {
  document.documentElement.dataset.focus = "keyboard"
}
