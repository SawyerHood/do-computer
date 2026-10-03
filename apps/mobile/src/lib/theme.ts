import { useColorScheme } from "react-native"

/** The same cool neutrals and teal accent as the web app. */
const dark = {
  canvas: "#131515",
  surface: "#1c1f20",
  raised: "#252929",
  border: "#2f3435",
  ink: "#e0e6e7",
  muted: "#979fa1",
  primary: "#1e7777",
  onPrimary: "#f4f9fa",
  danger: "#e5766a",
  success: "#5fb08a",
}

const light: typeof dark = {
  canvas: "#f8fafb",
  surface: "#eef2f3",
  raised: "#e3e8ea",
  border: "#d6dcdd",
  ink: "#242829",
  muted: "#697172",
  primary: "#157171",
  onPrimary: "#f7fbfc",
  danger: "#b3392c",
  success: "#2f7d57",
}

export type Theme = typeof dark

export function useTheme(): Theme {
  return useColorScheme() === "light" ? light : dark
}

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 }
export const space = (n: number) => n * 4
