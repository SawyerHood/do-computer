import type { ReactNode } from "react"
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text as NativeText,
  TextInput,
  type TextInputProps,
  type TextProps,
  View,
  type ViewProps,
} from "react-native"
import { radius, space, useTheme } from "@/lib/theme"

export function Text({
  tone = "ink",
  size = 15,
  weight = "400",
  style,
  ...props
}: TextProps & {
  tone?: "ink" | "muted" | "danger" | "onPrimary"
  size?: number
  weight?: "400" | "500" | "600"
}) {
  const theme = useTheme()
  return (
    <NativeText
      style={[
        {
          color: theme[tone],
          fontSize: size,
          fontWeight: weight,
          lineHeight: Math.round(size * 1.4),
        },
        style,
      ]}
      {...props}
    />
  )
}

export function Button({
  label,
  variant = "primary",
  busy = false,
  icon,
  disabled,
  style,
  ...props
}: Omit<PressableProps, "children" | "style"> & {
  label: string
  variant?: "primary" | "outline" | "ghost" | "danger"
  busy?: boolean
  icon?: ReactNode
  style?: ViewProps["style"]
}) {
  const theme = useTheme()
  const filled = variant === "primary"
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: filled ? theme.primary : "transparent",
          borderColor: variant === "outline" ? theme.border : "transparent",
          opacity: disabled || busy ? 0.5 : pressed ? 0.75 : 1,
        },
        style,
      ]}
      {...props}
    >
      {busy ? (
        <ActivityIndicator size="small" color={filled ? theme.onPrimary : theme.ink} />
      ) : (
        icon
      )}
      <Text weight="500" tone={filled ? "onPrimary" : variant === "danger" ? "danger" : "ink"}>
        {label}
      </Text>
    </Pressable>
  )
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const theme = useTheme()
  return (
    <View style={{ gap: space(1.5) }}>
      <Text size={13} weight="500">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.muted}
        style={[
          styles.input,
          { color: theme.ink, backgroundColor: theme.surface, borderColor: theme.border },
        ]}
        {...props}
      />
    </View>
  )
}

export function Card({ style, ...props }: ViewProps) {
  const theme = useTheme()
  return (
    <View
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}
      {...props}
    />
  )
}

export function Empty({ children }: { children: ReactNode }) {
  const theme = useTheme()
  return (
    <View style={[styles.empty, { borderColor: theme.border }]}>
      <Text tone="muted" size={14} style={{ textAlign: "center" }}>
        {children}
      </Text>
    </View>
  )
}

export function Badge({ label, tone }: { label: string; tone: "good" | "plain" }) {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: tone === "good" ? `${theme.success}33` : theme.raised },
      ]}
    >
      <NativeText
        style={{
          fontSize: 12,
          fontWeight: "500",
          color: tone === "good" ? theme.success : theme.muted,
        }}
      >
        {label}
      </NativeText>
    </View>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? (
    <Text tone="danger" size={13} accessibilityRole="alert">
      {children}
    </Text>
  ) : null
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: space(4),
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
  },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: space(3.5),
    fontSize: 16,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    padding: space(4),
    gap: space(2.5),
  },
  empty: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderStyle: "dashed",
    padding: space(6),
  },
  badge: { borderRadius: radius.pill, paddingHorizontal: space(2.5), paddingVertical: space(0.5) },
})
