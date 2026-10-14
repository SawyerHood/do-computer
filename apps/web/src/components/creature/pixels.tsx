import type { TreatKind } from "@do-computer/protocol"
import { useMemo } from "react"
import { cn } from "@/lib/utils"

/** The colors the little pictures are drawn in, each by the letter that stands for it. */
const INK: Record<string, string> = {
  k: "#1b1d23",
  w: "#f6f3ea",
  s: "#d3cdbb",
  n: "#24382c",
  r: "#e5484d",
  R: "#b02a37",
  g: "#5fbf4a",
  b: "#7a4a2a",
  B: "#4f2f1a",
  t: "#dba968",
  T: "#b97a45",
  p: "#ff8fb3",
  Q: "#e0608a",
  y: "#ffd23f",
  c: "#2bb5a8",
  d: "#1f8a80",
  h: "#ffffff",
}

/** Each picture as rows of letters: a letter is a square of that color, a dot is nothing. */
const ART = {
  riceball: [
    "....kkkk....",
    "...kwwwwk...",
    "..kwwwwwwk..",
    "..kwwwwwwk..",
    ".kwwwwwwwwk.",
    ".kwwwwwwwsk.",
    "kwwwnnnnwwsk",
    "kwwwnnnnwwsk",
    "kwwsnnnnwssk",
    "kssknnnnkssk",
    ".kkkkkkkkkk.",
  ],
  cookie: [
    "...kkkkkk...",
    "..kttttttk..",
    ".kttBttttTk.",
    "kttttttBttTk",
    "kttttttttTTk",
    "ktBttttttTTk",
    "kttttBtttTTk",
    "ktttttttBTTk",
    ".kttBtttTTk.",
    "..kTTTTTTk..",
    "...kkkkkk...",
  ],
  apple: [
    "......kk....",
    ".....kgk....",
    "..kkkbkkkk..",
    ".krrrbrrrrk.",
    "krrhrrrrrrRk",
    "krhrrrrrrrRk",
    "krrrrrrrrrRk",
    "krrrrrrrrRRk",
    ".krrrrrrRRk.",
    ".krrrrrRRRk.",
    "..kkkkkkkk..",
  ],
  donut: [
    "...kkkkkk...",
    "..kppppppk..",
    ".kpyppppcpk.",
    "kppppkkpppQk",
    "kpcpk..kpyQk",
    "kpppk..kppQk",
    "kpypkkkkpcQk",
    "ktppppppyQtk",
    ".kttppppttk.",
    "..kttttttk..",
    "...kkkkkk...",
  ],
  box: [
    "....yy..yy....",
    "...y..yy..y...",
    "....y.yy.y....",
    ".kkkkkyykkkkk.",
    ".kccccyycccdk.",
    ".kccccyycccdk.",
    ".kkkkkyykkkkk.",
    "..kcccyyccdk..",
    "..kcccyyccdk..",
    "..kcccyyccdk..",
    "..kcccyyccdk..",
    "..kdddyydddk..",
    "..kkkkkkkkkk..",
  ],
  spark: ["..y..", "..y..", "yyhyy", "..y..", "..y.."],
} satisfies Record<string, string[]>

export type PixelArt = keyof typeof ART | TreatKind

/** The color of a treat's crumbs. */
export const CRUMB: Record<TreatKind, string> = {
  riceball: INK.w!,
  cookie: INK.t!,
  apple: INK.r!,
  donut: INK.p!,
}

/**
 * One of the little pictures that go with the creature: a treat, its box, a sparkle. Drawn in
 * squares, as the creature is, at whatever size it is given.
 */
export function Pixels({ art, className }: { art: PixelArt; className?: string }) {
  const rows = ART[art]
  // One path for each color: every square of it, row by row.
  const paths = useMemo(() => {
    const byColor = new Map<string, string>()
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const color = INK[row[x]!]
        if (color !== undefined) byColor.set(color, `${byColor.get(color) ?? ""}M${x} ${y}h1v1h-1z`)
      }
    })
    return [...byColor]
  }, [rows])
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${rows[0]!.length} ${rows.length}`}
      shapeRendering="crispEdges"
      className={cn("pointer-events-none block shrink-0 select-none", className)}
    >
      {paths.map(([color, d]) => (
        <path key={color} fill={color} d={d} />
      ))}
    </svg>
  )
}
