import type { IconName } from "./icons"

export type { IconName } from "./icons"
export type IconWeight = "regular" | "medium" | "semibold" | "bold"
export type IconProps = { name: IconName; size?: number; color: string; weight?: IconWeight }
