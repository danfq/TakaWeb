/**
 * marks the page as keyboard driven after tab, and pointer driven after any press
 * focus outlines only show in keyboard mode, so clicks and restored focus never draw one
 */
export const FOCUS_SCRIPT = `(() => {
  const root = document.documentElement;
  addEventListener("keydown", (event) => {
    if (event.key === "Tab") root.dataset.focus = "keyboard";
  }, true);
  addEventListener("pointerdown", () => {
    delete root.dataset.focus;
  }, true);
})();`;
