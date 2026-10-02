import type { ColorValue } from "react-native"
import Svg, { Circle, Path, Rect } from "react-native-svg"

type IconProps = { size?: number; color: ColorValue }

const stroke = (color: ColorValue) =>
  ({
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    fill: "none",
  }) as const

/** A small set of line icons, drawn here so the app needs no icon font. */
export const Icon = {
  chat: ({ size = 22, color }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5v-8Z"
        {...stroke(color)}
      />
    </Svg>
  ),
  clock: ({ size = 22, color }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="8.5" {...stroke(color)} />
      <Path d="M12 7.5V12l3 2" {...stroke(color)} />
    </Svg>
  ),
  bolt: ({ size = 22, color }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" {...stroke(color)} />
    </Svg>
  ),
  folder: ({ size = 22, color }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M3.5 7A2 2 0 0 1 5.5 5h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7Z"
        {...stroke(color)}
      />
    </Svg>
  ),
  person: ({ size = 22, color }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="9" r="3.5" {...stroke(color)} />
      <Path d="M5 19.5c1.2-3 3.8-4.5 7-4.5s5.800 1.500 7 4.500" {...stroke(color)} />
    </Svg>
  ),
  send: ({ size = 20, color }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 19V5m0 0-6 6m6-6 6 6" {...stroke(color)} strokeWidth={2.2} />
    </Svg>
  ),
  stop: ({ size = 18, color }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="6" y="6" width="12" height="12" rx="2.5" fill={color} />
    </Svg>
  ),
  mic: ({ size = 20, color }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="9" y="3.5" width="6" height="11" rx="3" {...stroke(color)} />
      <Path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v2.500" {...stroke(color)} />
    </Svg>
  ),
  plus: ({ size = 22, color }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 5v14M5 12h14" {...stroke(color)} />
    </Svg>
  ),
  back: ({ size = 22, color }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M15 5l-7 7 7 7" {...stroke(color)} />
    </Svg>
  ),
  trash: ({ size = 20, color }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M5 7h14M10 7V5h4v2m-7 0 .8 11a1.500 1.500 0 0 0 1.500 1.400h5.400a1.500 1.500 0 0 0 1.500-1.400L17 7"
        {...stroke(color)}
      />
    </Svg>
  ),
  download: ({ size = 20, color }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 4v11m0 0-4.500-4.500M12 15l4.500-4.500M5 19h14" {...stroke(color)} />
    </Svg>
  ),
  file: ({ size = 22, color }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M7 3.500h7l4 4V19a1.500 1.500 0 0 1-1.500 1.500h-9.500A1.500 1.500 0 0 1 5.500 19V5A1.500 1.500 0 0 1 7 3.500Zm7 0v4h4"
        {...stroke(color)}
      />
    </Svg>
  ),
  tool: ({ size = 16, color }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M14.500 6a4 4 0 0 0-5 5L4 16.500 7.500 20l5.500-5.500a4 4 0 0 0 5-5L15.500 12 12 8.500 14.500 6Z"
        {...stroke(color)}
      />
    </Svg>
  ),
}
