import { type ReactNode, useRef } from "react"
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  StyleSheet,
  Switch,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native"
import { radius, useTheme } from "@/lib/theme"
import { Icon, type IconName } from "./icon"
import { Text } from "./text"

/**
 * A screen of grouped rows, the kind Settings is made of: the grey page under a native header,
 * scrolling, with room for the bars the system draws over it.
 */
export function Screen({
  children,
  page = false,
  onRefresh,
  refreshing = false,
  style,
  ...props
}: ScrollViewProps & {
  /** A plain page such as a document, where there are no groups to set off. */
  page?: boolean
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const theme = useTheme()
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      refreshControl={
        onRefresh === undefined ? undefined : (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        )
      }
      {...props}
      style={[{ flex: 1, backgroundColor: page ? theme.page : theme.bg }, style]}
      contentContainerStyle={[{ paddingTop: 8, paddingBottom: 40 }, props.contentContainerStyle]}
    >
      {children}
    </ScrollView>
  )
}

/** A group of rows on one card, with a line of small words over it and under it. */
export function Section({
  title,
  footer,
  children,
  style,
  action,
}: {
  title?: string
  footer?: ReactNode
  children: ReactNode
  style?: StyleProp<ViewStyle>
  /** Something at the right of the title, such as a count or a button. */
  action?: ReactNode
}) {
  const theme = useTheme()
  const rows = (Array.isArray(children) ? children.flat() : [children]).filter(
    (child) => child !== null && child !== undefined && child !== false,
  )
  if (rows.length === 0) return null
  return (
    <View style={[styles.section, style]}>
      {title === undefined && action === undefined ? null : (
        <View style={styles.sectionTitle}>
          <Text variant="footnote" tone="ink2" style={{ flex: 1 }} accessibilityRole="header">
            {title}
          </Text>
          {action}
        </View>
      )}
      <View style={[styles.group, { backgroundColor: theme.card }]}>
        {rows.map((row, at) => (
          <View key={at}>
            {at === 0 ? null : <View style={[styles.sep, { backgroundColor: theme.sep }]} />}
            {row}
          </View>
        ))}
      </View>
      {footer === undefined ? null : typeof footer === "string" ? (
        <Text variant="footnote" tone="ink2" style={styles.footer}>
          {footer}
        </Text>
      ) : (
        <View style={styles.footer}>{footer}</View>
      )}
    </View>
  )
}

/** A colored square with a symbol in it, at the start of a row. */
export function IconTile({ icon, color }: { icon: IconName; color: string }) {
  return (
    <View style={[styles.tile, { backgroundColor: color }]}>
      <Icon name={icon} size={18} color="#fff" weight="medium" />
    </View>
  )
}

/**
 * One row of a group. What is at its start is `icon` (a tile), or `lead` (anything). What is at
 * its end is, in order: `value` in grey, `tail` (anything), a `toggle`, and the chevron of a row
 * that goes somewhere (`go`).
 */
export function Row({
  title,
  subtitle,
  icon,
  lead,
  value,
  tail,
  toggle,
  go = false,
  tone,
  bold = false,
  busy = false,
  onPress,
  disabled = false,
  numberOfLines = 1,
  accessibilityLabel,
  testID,
}: {
  title: ReactNode
  subtitle?: ReactNode
  icon?: [IconName, string]
  lead?: ReactNode
  value?: ReactNode
  tail?: ReactNode
  toggle?: { value: boolean; onChange: (value: boolean) => void; disabled?: boolean }
  go?: boolean
  /** `tint` for a row that does something, `red` for one that destroys. */
  tone?: "tint" | "red"
  bold?: boolean
  busy?: boolean
  onPress?: () => void
  disabled?: boolean
  numberOfLines?: number
  accessibilityLabel?: string
  testID?: string
}) {
  const theme = useTheme()
  const content = (
    <>
      {icon === undefined ? lead : <IconTile icon={icon[0]} color={icon[1]} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === "string" ? (
          <Text
            tone={tone ?? "ink"}
            weight={bold ? "600" : undefined}
            numberOfLines={numberOfLines}
          >
            {title}
          </Text>
        ) : (
          title
        )}
        {subtitle === undefined || subtitle === null || subtitle === "" ? null : typeof subtitle ===
          "string" ? (
          <Text variant="subhead" tone="ink2" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : (
          subtitle
        )}
      </View>
      {value === undefined || value === null ? null : typeof value === "string" ||
        typeof value === "number" ? (
        <Text tone="ink2" numberOfLines={1} style={{ flexShrink: 1, maxWidth: "55%" }}>
          {value}
        </Text>
      ) : (
        value
      )}
      {tail}
      {busy ? <ActivityIndicator /> : null}
      {toggle === undefined ? null : (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          disabled={toggle.disabled}
          accessibilityLabel={accessibilityLabel ?? (typeof title === "string" ? title : undefined)}
        />
      )}
      {go ? <Icon name="chevronRight" size={14} color={theme.ink3} weight="semibold" /> : null}
    </>
  )
  if (onPress === undefined) {
    return (
      <View style={styles.row} testID={testID}>
        {content}
      </View>
    )
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed ? { backgroundColor: theme.fill } : null,
        disabled ? { opacity: 0.45 } : null,
      ]}
    >
      {content}
    </Pressable>
  )
}

/** Words in the middle of an empty screen or an empty group. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={{ alignItems: "center", paddingHorizontal: 40, paddingVertical: 56, gap: 6 }}>
      <Text variant="title3" style={{ textAlign: "center" }}>
        {title}
      </Text>
      {children === undefined ? null : (
        <Text variant="subhead" tone="ink2" style={{ textAlign: "center" }}>
          {children}
        </Text>
      )}
    </View>
  )
}

/** A small word on a tint: Active, Online, Running. */
export function Pill({
  label,
  tone = "plain",
  color,
}: {
  label: string
  tone?: "plain" | "good" | "busy"
  color?: string
}) {
  const theme = useTheme()
  const ink = color ?? (tone === "good" ? theme.green : tone === "busy" ? theme.amber : theme.ink2)
  return (
    <View
      style={{
        borderRadius: radius.pill,
        paddingHorizontal: 8,
        paddingVertical: 2,
        overflow: "hidden",
      }}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: tone === "plain" && color === undefined ? theme.fill : ink,
            opacity: tone === "plain" && color === undefined ? 1 : 0.16,
          },
        ]}
      />
      <Text variant="caption" weight="600" color={ink}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginHorizontal: 16, marginBottom: 22 },
  sectionTitle: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 7,
  },
  group: { borderRadius: radius.group, borderCurve: "continuous", overflow: "hidden" },
  footer: { marginHorizontal: 16, marginTop: 7 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16, marginRight: 16 },
  row: {
    minHeight: 50,
    paddingHorizontal: 16,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  tile: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
})

/**
 * A row to write in. With a `label` the words sit at its start and what is typed after them, as
 * in Settings; without one the field has the whole row. `multiline` makes it a box of several lines.
 */
export function Field({ label, style, ...props }: TextInputProps & { label?: string }) {
  const theme = useTheme()
  const input = useRef<TextInput>(null)
  return (
    // Touching the row anywhere puts the cursor in its field, as a row of Settings does it.
    <Pressable
      accessible={false}
      onPress={() => input.current?.focus()}
      style={[
        styles.row,
        props.multiline ? { alignItems: "flex-start", paddingVertical: 12 } : null,
      ]}
    >
      {label === undefined ? null : (
        <Text
          // Never squeezed by what is typed beside it: a phone does not squeeze it anyway, and
          // the browser build would cut "Card number" short.
          style={{ minWidth: 96, flexShrink: 0 }}
          numberOfLines={1}
          accessible={false}
          importantForAccessibility="no"
        >
          {label}
        </Text>
      )}
      <TextInput
        ref={input}
        accessibilityLabel={label ?? props.placeholder}
        testID={label === undefined ? undefined : `field-${label}`}
        placeholderTextColor={theme.ink3}
        selectionColor={theme.tint}
        {...props}
        style={[
          {
            flex: 1,
            color: theme.ink,
            fontSize: 17,
            letterSpacing: -0.41,
            padding: 0,
            minHeight: props.multiline ? 88 : 24,
          },
          props.multiline ? { textAlignVertical: "top" } : null,
          style,
        ]}
      />
    </Pressable>
  )
}
