import { Pressable, View } from "react-native"
import { useTheme } from "@/lib/theme"
import { haptic } from "./haptics"
import { Text } from "./text"

/** A few choices side by side, one of them chosen, as iOS's segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  /** What is being chosen, for someone who cannot see it. */
  label: string
}) {
  const theme = useTheme()
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        backgroundColor: theme.fill,
        borderRadius: 10,
        borderCurve: "continuous",
        padding: 2,
      }}
    >
      {options.map((option) => {
        const chosen = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: chosen }}
            onPress={() => {
              if (chosen) return
              haptic.tap()
              onChange(option.value)
            }}
            style={[
              {
                flex: 1,
                paddingVertical: 6,
                paddingHorizontal: 8,
                borderRadius: 8,
                borderCurve: "continuous",
                alignItems: "center",
              },
              chosen
                ? {
                    backgroundColor: theme.dark ? "#5b6264" : "#fff",
                    shadowColor: "#000",
                    shadowOpacity: 0.14,
                    shadowRadius: 3,
                    shadowOffset: { width: 0, height: 1 },
                  }
                : null,
            ]}
          >
            <Text variant="footnote" weight={chosen ? "600" : "500"} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
