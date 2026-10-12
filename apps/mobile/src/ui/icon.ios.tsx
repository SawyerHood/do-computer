import { SymbolView } from "expo-symbols"
import { ICONS } from "./icons"
import type { IconProps } from "./icon-types"

export type { IconName, IconProps, IconWeight } from "./icon-types"

/** A symbol: the system's own, which takes its weight and scale from the text around it. */
export function Icon({ name, size = 22, color, weight = "regular" }: IconProps) {
  return (
    <SymbolView
      name={ICONS[name][0]}
      size={size}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
      style={{ width: size, height: size }}
    />
  )
}
