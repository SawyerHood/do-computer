import { type ReactNode, useCallback, useEffect, useState } from "react"
import { type LayoutChangeEvent, View } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import { scheduleOnRN } from "react-native-worklets"
import { useTheme } from "@/lib/theme"
import { haptic } from "./haptics"
import { Icon } from "./icon"
import { heightOf, placeHeld, topOf } from "./sortable-places"

/** How long the rows that make room take to move, as a list on iOS does. */
const MAKE_ROOM_MS = 200

type Shared = {
  order: SharedValue<string[]>
  heights: SharedValue<Record<string, number>>
  held: SharedValue<string | null>
  editing: SharedValue<boolean>
}

/**
 * A list whose rows can be put in another order, as a list on iOS is in its edit mode: each row
 * has a handle at its trailing edge, and a finger on the handle takes the row up at once and
 * moves it, while the rows it passes make room. Letting go puts it down there and calls `onMove`
 * with every id, the top one first. A screen reader moves a row with the handle's actions, up
 * and down, one place at a time.
 *
 * Out of edit mode the rows are laid out as they always are, one after another. In it they are
 * placed by hand where they were, from their measured heights, so that moving one never asks
 * React to lay the list out again until it is let go. `children` draws a row, and is given the
 * handle to put at its end (none out of edit mode). `onHolding` is told when a row is taken up
 * and put down, for a page that has to stop scrolling meanwhile.
 */
export function Sortable({
  ids,
  editing,
  onMove,
  onHolding,
  name,
  children,
}: {
  ids: readonly string[]
  editing: boolean
  onMove: (ids: string[]) => void
  onHolding?: (holding: boolean) => void
  /** What a row is called, for what a screen reader says of its handle. */
  name: (id: string) => string
  children: (id: string, handle: ReactNode) => ReactNode
}) {
  const order = useSharedValue<string[]>([...ids])
  const heights = useSharedValue<Record<string, number>>({})
  const held = useSharedValue<string | null>(null)
  const editingNow = useSharedValue(editing)
  const shared: Shared = { order, heights, held, editing: editingNow }
  // How tall the list is, for the page to keep room for it while its rows are placed by hand.
  const [measured, setMeasured] = useState<Record<string, number>>({})

  const key = ids.join("\n")
  useEffect(() => {
    // What the list is now, from this phone or another device: unless a row is in the hand,
    // whose place is the finger's until it is let go.
    if (held.value === null) order.value = key === "" ? [] : key.split("\n")
  }, [key, held, order])
  useEffect(() => {
    editingNow.value = editing
  }, [editing, editingNow])

  const measure = useCallback(
    (id: string, height: number) => {
      setMeasured((kept) => (kept[id] === height ? kept : { ...kept, [id]: height }))
      heights.value = { ...heights.value, [id]: height }
    },
    [heights],
  )

  const moveBy = (id: string, by: number) => {
    const from = ids.indexOf(id)
    const to = Math.max(0, Math.min(ids.length - 1, from + by))
    if (from === -1 || from === to) return
    const next = ids.filter((each) => each !== id)
    next.splice(to, 0, id)
    haptic.tap()
    onMove(next)
  }

  const all = ids.every((id) => measured[id] !== undefined)
  return (
    <View style={editing && all ? { height: heightOf(ids, measured) } : undefined}>
      {ids.map((id, index) => (
        <SortableRow
          key={id}
          id={id}
          shared={shared}
          editing={editing}
          measure={measure}
          onMove={onMove}
          onHolding={onHolding}
          label={name(id)}
          place={`${index + 1} of ${ids.length}`}
          moveBy={(by) => moveBy(id, by)}
        >
          {children}
        </SortableRow>
      ))}
    </View>
  )
}

function SortableRow({
  id,
  shared,
  editing,
  measure,
  onMove,
  onHolding,
  label,
  place,
  moveBy,
  children,
}: {
  id: string
  shared: Shared
  editing: boolean
  measure: (id: string, height: number) => void
  onMove: (ids: string[]) => void
  onHolding: ((holding: boolean) => void) | undefined
  label: string
  place: string
  moveBy: (by: number) => void
  children: (id: string, handle: ReactNode) => ReactNode
}) {
  const theme = useTheme()
  const { order, heights, held, editing: editingNow } = shared
  // Where the row is placed in edit mode: its place in the order, or the finger's while held.
  const top = useSharedValue(0)
  const lift = useSharedValue(0)
  const from = useSharedValue(0)
  const before = useSharedValue<string[]>([])

  useAnimatedReaction(
    () => topOf(order.value, heights.value, id),
    (now, was) => {
      if (now === was || held.value === id) return
      // Another row is in the hand: this one makes room. Otherwise it is simply where it is.
      top.value = held.value === null ? now : withTiming(now, { duration: MAKE_ROOM_MS })
    },
  )

  // Called from the UI thread, so they are this row's own functions and not the kit's.
  const lifted = () => {
    onHolding?.(true)
    haptic.medium()
  }
  const passed = () => haptic.tap()
  const done = (changed: boolean, next: string[]) => {
    onHolding?.(false)
    haptic.light()
    if (changed) onMove(next)
  }

  const pan = Gesture.Pan()
    .enabled(editing)
    // A finger on the handle has taken the row up: there is nothing else for it to mean.
    .minDistance(0)
    .onStart(() => {
      held.value = id
      before.value = order.value
      from.value = topOf(order.value, heights.value, id)
      top.value = from.value
      lift.value = withSpring(1, { damping: 18, stiffness: 260 })
      scheduleOnRN(lifted)
    })
    .onUpdate((event) => {
      const most = heightOf(order.value, heights.value) - (heights.value[id] ?? 0)
      top.value = Math.max(0, Math.min(most, from.value + event.translationY))
      const next = placeHeld(order.value, heights.value, id, top.value)
      if (next.join("\n") !== order.value.join("\n")) {
        order.value = next
        scheduleOnRN(passed)
      }
    })
    .onFinalize(() => {
      if (held.value !== id) return
      const next = order.value
      const changed = next.join("\n") !== before.value.join("\n")
      top.value = withTiming(topOf(next, heights.value, id), { duration: MAKE_ROOM_MS }, () => {
        held.value = null
      })
      lift.value = withTiming(0, { duration: MAKE_ROOM_MS })
      scheduleOnRN(done, changed, next)
    })

  // The row in the hand is raised off the page, as a card is: lighter, and with a shadow where
  // a shadow can be seen.
  const { page, card } = theme
  const style = useAnimatedStyle(() => {
    if (!editingNow.value) {
      return {
        position: "relative",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 0,
        transform: [{ scale: 1 }],
        shadowOpacity: 0,
        backgroundColor: page,
      }
    }
    return {
      position: "absolute",
      top: top.value,
      left: 0,
      right: 0,
      zIndex: held.value === id ? 2 : 1,
      transform: [{ scale: 1 + lift.value * 0.03 }],
      shadowOpacity: lift.value * 0.18,
      backgroundColor: held.value === id ? card : page,
    }
  })

  const handle = editing ? (
    <GestureDetector gesture={pan}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`Move ${label}`}
        accessibilityHint={place}
        accessibilityActions={[
          { name: "up", label: "Move up" },
          { name: "down", label: "Move down" },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "up") moveBy(-1)
          if (event.nativeEvent.actionName === "down") moveBy(1)
        }}
        testID={`move-${id}`}
        style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="reorder" size={22} color={theme.ink2} weight="medium" />
      </View>
    </GestureDetector>
  ) : null

  return (
    <Animated.View
      onLayout={(event: LayoutChangeEvent) => measure(id, event.nativeEvent.layout.height)}
      style={[
        {
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 6 },
          shadowRadius: 14,
          borderRadius: 14,
        },
        style,
      ]}
    >
      {children(id, handle)}
    </Animated.View>
  )
}
