import { useColorScheme } from "react-native"

/** The same warm neutrals and clay accent as the web app. */
const dark = {
  canvas: "#161412",
  surface: "#211e1b",
  raised: "#2b2723",
  border: "#37322d",
  ink: "#e9e4dc",
  muted: "#a39c92",
  primary: "#8f5a3e",
  onPrimary: "#fbf7f1",
  danger: "#e5766a",
  success: "#5fb08a",
}

const light: typeof dark = {
  canvas: "#fbfaf7",
  surface: "#f3f1ec",
  raised: "#eae7e0",
  border: "#dedad2",
  ink: "#2b2622",
  muted: "#756e65",
  primary: "#935638",
  onPrimary: "#fdfaf5",
  danger: "#b3392c",
  success: "#2f7d57",
}

export type Theme = typeof dark

export function useTheme(): Theme {
  return useColorScheme() === "light" ? light : dark
}

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 }
export const space = (n: number) => n * 4
