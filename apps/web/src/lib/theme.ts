export const THEME_STORAGE_KEY = "dc-theme"

export type Theme = "light" | "dark"

export function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

export function setTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark")
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage can be unavailable; the choice then lasts for this page only.
  }
}

/**
 * Runs before first paint so a stored or system light preference never flashes dark. The document
 * is rendered dark by default. Keep the key in sync with THEME_STORAGE_KEY.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("dc-theme");if(t==="light"||(t!=="dark"&&matchMedia("(prefers-color-scheme: light)").matches))document.documentElement.classList.remove("dark")}catch(e){}`
