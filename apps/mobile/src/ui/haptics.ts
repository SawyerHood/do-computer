import * as Haptics from "expo-haptics"
import { Platform } from "react-native"

const can = Platform.OS === "ios" || Platform.OS === "android"

/** The small taps a hand feels: one for a choice, one for something done, one for something wrong. */
export const haptic = {
  tap: () => void (can && Haptics.selectionAsync().catch(() => {})),
  light: () => void (can && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})),
  medium: () =>
    void (can && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})),
  heavy: () => void (can && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})),
  done: () =>
    void (
      can && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    ),
  warn: () =>
    void (
      can && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
    ),
  fail: () =>
    void (can && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})),
}
