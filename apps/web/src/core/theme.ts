export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "learnstep-theme";

export function savedTheme(value: string | null): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

// Run before the page is painted so a saved dark theme does not flash white.
export const THEME_INIT_SCRIPT = `(() => {
  let saved = null;
  try { saved = localStorage.getItem("${THEME_STORAGE_KEY}"); } catch {}
  const theme = saved === "light" || saved === "dark"
    ? saved
    : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
})();`;
