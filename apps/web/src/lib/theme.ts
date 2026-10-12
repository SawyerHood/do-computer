export const THEME_STORAGE_KEY = "dc-theme"

export type Theme = "light" | "dark"

/** What was asked for: one of the two, or whichever the device is set to. */
export type ThemeChoice = Theme | "system"

export function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

export function chosenTheme(): ThemeChoice {
  try {
    const kept = localStorage.getItem(THEME_STORAGE_KEY)
    return kept === "light" || kept === "dark" ? kept : "system"
  } catch {
    return "system"
  }
}

export function setTheme(choice: ThemeChoice): void {
  const theme =
    choice === "system"
      ? matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : choice
  document.documentElement.classList.toggle("dark", theme === "dark")
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    // Storage can be unavailable; the choice then lasts for this page only.
  }
}

/**
 * Runs before first paint so a stored or system light preference never flashes dark. The document
 * is rendered dark by default. Keep the key in sync with THEME_STORAGE_KEY.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("dc-theme");if(t==="light"||(t!=="dark"&&matchMedia("(prefers-color-scheme: light)").matches))document.documentElement.classList.remove("dark")}catch(e){}`
