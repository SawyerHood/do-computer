import { View } from "react-native"
import { useTheme } from "@/lib/theme"
import { Icon } from "./icon"
import { Menu } from "./menu"
import { Text } from "./text"

/** The words of a value that opens a menu to choose another: "Ask first" and two small arrows. */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  /** What is being chosen, for someone who cannot see the row it is in. */
  label: string
  disabled?: boolean
}) {
  const theme = useTheme()
  const current = options.find((option) => option.value === value)
  const words = (
    <View
      accessibilityLabel={`${label}: ${current?.label ?? value}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 }}
    >
      <Text tone="ink2">{current?.label ?? value}</Text>
      <View style={{ gap: 0 }}>
        <Icon name="chevronDown" size={9} color={theme.ink2} weight="bold" />
      </View>
    </View>
  )
  if (disabled) return words
  return (
    <Menu
      title={label}
      items={options.map((option) => ({
        title: option.label,
        checked: option.value === value,
        onPress: () => onChange(option.value),
      }))}
    >
      {words}
    </Menu>
  )
}
