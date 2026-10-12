import type { Use } from "@durable-computer/protocol"
import { createContext, type ReactNode, useContext, useState } from "react"
import {
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native"
import { type Accent, mono, radius, useTheme } from "@/lib/theme"
import { haptic, Icon, type IconName, Text } from "@/ui"

/**
 * What every piece of a transcript may need to know about the chat it is in. It changes only
 * when the chat or its agent does, so reading it costs a streaming answer nothing.
 */
export type ChatScope = {
  agentId: string
  chatId: string
  /** The workspace the agent lives in, once the list of agents is in. */
  workspaceId: string | undefined
  /** The agent's own color: `a` for marks, `soft` and `ink` for the reader's messages. */
  accent: Accent
}

export const ChatScopeContext = createContext<ChatScope | null>(null)

/** The chat a piece is drawn in. Every piece of a transcript is inside one. */
export function useChatScope(): ChatScope {
  const scope = useContext(ChatScopeContext)
  if (scope === null) throw new Error("A transcript part was drawn outside a Transcript")
  return scope
}

/**
 * The screens and browsers an agent used in this chat, by the id of the first step of each.
 * This changes as the chat does, so only what draws a use reads it.
 */
export type ChatUses = { all: Use[]; byId: Map<string, Use>; busy: boolean }
export const UsesContext = createContext<ChatUses>({ all: [], byId: new Map(), busy: false })

/** A card in the transcript: a rounded surface with a hairline, as wide as the page allows. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme()
  return (
    <View
      style={[
        {
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.sep,
          backgroundColor: theme.card,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

/**
 * A chip: one row in a card, with something at its head (a face, an icon), a title, a line of
 * status under it, and something at its end. With `onPress` the whole row is a button.
 */
export function Chip({
  lead,
  title,
  subtitle,
  tail,
  onPress,
  label,
  children,
}: {
  lead?: ReactNode
  title: string
  subtitle?: ReactNode
  tail?: ReactNode
  onPress?: () => void
  /** What a screen reader says for the row; the title and subtitle if not given. */
  label?: string
  /** What is unfolded under the row, inside the same card. */
  children?: ReactNode
}) {
  const row = (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, minHeight: 52 }}
    >
      {lead}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="subhead" weight="600" numberOfLines={1}>
          {title}
        </Text>
        {typeof subtitle === "string" ? (
          <Text variant="footnote" tone="ink2" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : (
          subtitle
        )}
      </View>
      {tail}
    </View>
  )
  return (
    <Card>
      {onPress === undefined ? (
        row
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            label ?? (typeof subtitle === "string" ? `${title}, ${subtitle}` : title)
          }
          onPress={onPress}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          {row}
        </Pressable>
      )}
      {children}
    </Card>
  )
}

/** An icon on a soft square, for the head of a chip. */
export function ChipIcon({ icon, color }: { icon: IconName; color?: string }) {
  const theme = useTheme()
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 9,
        backgroundColor: theme.fill,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={icon} size={17} color={color ?? theme.ink2} />
    </View>
  )
}

/**
 * Something folded away behind a few words ("Details", "What it reported"): a tap on the words
 * unfolds it under them, and another folds it again.
 */
export function Fold({
  label,
  children,
  defaultOpen = false,
  onToggle,
}: {
  label: string
  children: ReactNode
  defaultOpen?: boolean
  onToggle?: (open: boolean) => void
}) {
  const theme = useTheme()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        onPress={() => {
          haptic.tap()
          setOpen(!open)
          onToggle?.(!open)
        }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          alignSelf: "flex-start",
          paddingVertical: 4,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          <Icon name="chevronRight" size={11} color={theme.ink2} weight="semibold" />
        </View>
        <Text variant="footnote" tone="ink2" weight="500">
          {label}
        </Text>
      </Pressable>
      {open ? <View style={{ marginTop: 6 }}>{children}</View> : null}
    </View>
  )
}

/** Plain output in a fixed-width face, in a box that scrolls when it is long. */
export function Pre({ text, maxHeight = 220 }: { text: string; maxHeight?: number }) {
  const theme = useTheme()
  return (
    <ScrollView
      nestedScrollEnabled
      style={{
        maxHeight,
        borderRadius: radius.sm,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.sep,
        backgroundColor: theme.fill,
      }}
      contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}
    >
      <Text
        selectable
        style={{ fontFamily: mono, fontSize: 12, lineHeight: 17, color: theme.ink2 }}
      >
        {text}
      </Text>
    </ScrollView>
  )
}

/**
 * A quiet line that records something that happened in the chat (an answer to an ask, word from
 * a sub-agent): an icon, the words, and a rule down its left side.
 */
export function NoticeLine({ icon, children }: { icon: IconName; children: ReactNode }) {
  const theme = useTheme()
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        borderLeftWidth: 2,
        borderLeftColor: theme.sep,
        paddingLeft: 12,
        paddingVertical: 2,
      }}
    >
      <View style={{ paddingTop: 2 }}>
        <Icon name={icon} size={15} color={theme.ink2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  )
}

/** A small round button with one symbol, for the end of a card's row (share, copy, stop). */
export function RoundButton({
  icon,
  label,
  onPress,
  color,
}: {
  icon: IconName
  label: string
  onPress: () => void
  color?: string
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: theme.fill,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={15} color={color ?? theme.ink} weight="medium" />
    </Pressable>
  )
}
