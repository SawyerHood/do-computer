export const THEME_STORAGE_KEY = "dc-theme"

export type Theme = "light" | "dark"

export function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

/**
 * The page's own color in each theme, which a phone's browser bar and status bar are tinted
 * with. One tag in the head says it, added by the script below and kept in step with the theme:
 * the theme is the user's choice, which a media query for the system's would not follow.
 */
export const THEME_COLORS: Record<Theme, string> = { dark: "#121415", light: "#f8fbfb" }

export function setTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark")
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme])
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage can be unavailable; the choice then lasts for this page only.
  }
}

/**
 * Runs before first paint so a stored or system light preference never flashes dark. The document
 * is rendered dark by default. It also adds the tag that says the page's color: React would add
 * a second one beside a tag of its own that had been changed under it. Keep the key in sync with
 * THEME_STORAGE_KEY.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("dc-theme"),l=t==="light"||(t!=="dark"&&matchMedia("(prefers-color-scheme: light)").matches),m=document.createElement("meta");if(l)document.documentElement.classList.remove("dark");m.name="theme-color";m.content=l?"${THEME_COLORS.light}":"${THEME_COLORS.dark}";document.head.appendChild(m)}catch(e){}`
