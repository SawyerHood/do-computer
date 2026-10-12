import { SvgXml } from "react-native-svg"
import { ICONS } from "./icons"

import type { IconProps, IconWeight } from "./icon-types"

export type { IconName, IconProps, IconWeight } from "./icon-types"

const STROKE: Record<IconWeight, number> = { regular: 1.7, medium: 1.9, semibold: 2.2, bold: 2.6 }

/** A symbol. On iOS it is the system's own (see icon.ios.tsx); here it is drawn. */
export function Icon({ name, size = 22, color, weight = "regular" }: IconProps) {
  const xml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${STROKE[weight]}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name][1]}</svg>`
  return <SvgXml xml={xml} width={size} height={size} color={color} />
}
