import { Text as NativeText, type TextProps } from "react-native"
import { type Theme, type TypeStyle, type, useTheme } from "@/lib/theme"

type Tone = "ink" | "ink2" | "ink3" | "tint" | "red" | "green" | "amber" | "onTint"

/**
 * Words in one of iOS's text styles. `tone` is one of the theme's colors by name; a `color` of
 * its own wins over it, for an agent's accent.
 */
export function Text({
  variant = "body",
  tone = "ink",
  color,
  weight,
  style,
  ...props
}: TextProps & {
  variant?: TypeStyle
  tone?: Tone
  color?: string
  weight?: "400" | "500" | "600" | "700"
}) {
  const theme = useTheme()
  return (
    <NativeText
      {...props}
      style={[
        type[variant],
        { color: color ?? (theme[tone as keyof Theme] as string) },
        weight === undefined ? null : { fontWeight: weight },
        style,
      ]}
    />
  )
}
