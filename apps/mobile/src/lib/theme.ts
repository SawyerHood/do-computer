import { type Avatar, AVATAR_COLORS, avatarLook } from "@durable-computer/protocol"
import { useMemo } from "react"
import { PlatformColor, Platform, useColorScheme } from "react-native"

/**
 * The app's colors: cool neutrals and one teal, the same as the web app's, laid out the way iOS
 * lays out a screen. `bg` is what grouped lists sit on and `card` is a group; `page` is a plain
 * page such as a chat or a document.
 */
const light = {
  bg: "#f2f4f5",
  card: "#ffffff",
  page: "#ffffff",
  ink: "#16191a",
  ink2: "rgba(40, 48, 50, 0.62)",
  ink3: "rgba(40, 48, 50, 0.34)",
  sep: "rgba(40, 48, 50, 0.14)",
  fill: "rgba(96, 110, 114, 0.12)",
  fill2: "rgba(96, 110, 114, 0.2)",
  tint: "#127a78",
  onTint: "#ffffff",
  red: "#e5484d",
  green: "#2f9e63",
  amber: "#e2a400",
  blue: "#2f7fd6",
  scrim: "rgba(10, 16, 18, 0.28)",
}

const dark: typeof light = {
  bg: "#0b0d0d",
  card: "#1a1d1e",
  page: "#0b0d0d",
  ink: "#f1f4f4",
  ink2: "rgba(226, 236, 238, 0.6)",
  ink3: "rgba(226, 236, 238, 0.3)",
  sep: "rgba(226, 236, 238, 0.14)",
  fill: "rgba(130, 146, 150, 0.2)",
  fill2: "rgba(130, 146, 150, 0.3)",
  tint: "#4cc2bd",
  onTint: "#06201f",
  red: "#ff6b6f",
  green: "#4fc487",
  amber: "#f0b545",
  blue: "#73b0f0",
  scrim: "rgba(0, 0, 0, 0.5)",
}

export type Theme = typeof light & { dark: boolean }

const themes = { light: { ...light, dark: false }, dark: { ...dark, dark: true } }

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? themes.dark : themes.light
}

/** iOS's text styles, by name. Sizes are in points and grow with the reader's text size. */
export const type = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: 0.4 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: 0.36 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: 0.35 },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: "600", letterSpacing: 0.38 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.41 },
  body: { fontSize: 17, lineHeight: 22, fontWeight: "400", letterSpacing: -0.41 },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: "400", letterSpacing: -0.32 },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: "400", letterSpacing: -0.24 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400", letterSpacing: -0.08 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400", letterSpacing: 0 },
} as const
export type TypeStyle = keyof typeof type

export const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" })

export const radius = { sm: 10, md: 16, lg: 22, group: 24, pill: 999 }
export const space = (n: number) => n * 4

/* ---------- an agent's color ---------- */

type Rgb = [number, number, number]
/** A color as red, green and blue. An agent's color is kept by name ("clay"), so that is looked up. */
const parse = (color: string): Rgb => {
  const named = AVATAR_COLORS.find((entry) => entry.id === color)?.hex ?? color
  const value = /^#?([0-9a-f]{6})$/i.exec(named)?.[1] ?? "127a78"
  return [0, 2, 4].map((at) => Number.parseInt(value.slice(at, at + 2), 16)) as Rgb
}
const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  a.map((channel, i) => Math.round(channel + (b[i]! - channel) * t)) as Rgb
const hex = (rgb: Rgb) => `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

/** How light a color is, from 0 to 1, as the eye has it. */
const luminance = ([r, g, b]: Rgb) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

/**
 * What a chat takes from its agent's color, as the web app's pages do: `a` for buttons and
 * marks, `soft` for the reader's own messages, and `ink` for the words on them. The color is
 * the agent's `avatar.color`, a name such as "clay", or any `#rrggbb`.
 */
export type Accent = { a: string; onA: string; soft: string; ink: string }

export function accentOf(color: string | undefined | null, isDark: boolean): Accent {
  const base = parse(color ?? "#127a78")
  if (isDark) {
    // Lifted until it reads on a dark page.
    const a = luminance(base) < 0.45 ? mix(base, WHITE, 0.35) : base
    return {
      a: hex(a),
      onA: luminance(a) > 0.55 ? "#101314" : "#ffffff",
      soft: hex(mix(base, BLACK, 0.68)),
      ink: hex(mix(base, WHITE, 0.85)),
    }
  }
  // Deepened until white reads on it.
  const a = luminance(base) > 0.42 ? mix(base, BLACK, 0.18) : base
  return {
    a: hex(a),
    onA: "#ffffff",
    soft: hex(mix(base, WHITE, 0.8)),
    ink: hex(mix(base, BLACK, 0.6)),
  }
}

export function useAccent(color: string | undefined | null): Accent {
  const isDark = useColorScheme() === "dark"
  return useMemo(() => accentOf(color, isDark), [color, isDark])
}

/**
 * An agent's accent, from the agent itself: the color it was given, or the one that an agent
 * which never chose is drawn in, which goes by its id.
 */
export function useAgentAccent(
  agent: { id: string; avatar?: Avatar | null } | undefined | null,
): Accent {
  const color = agent ? avatarLook(agent.avatar, agent.id).color : undefined
  return useAccent(color)
}

/** A color of the system's own, where there is one, for what should follow the system exactly. */
export const system = (name: string, fallback: string) =>
  Platform.OS === "ios" ? PlatformColor(name) : fallback
