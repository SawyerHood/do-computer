import { ActionSheetIOS, Alert, Platform } from "react-native"

/**
 * Ask before something that cannot be taken back. Resolves true if they went ahead. On iOS it
 * is an action sheet from the bottom, as the system's own confirmations are.
 */
export function confirm(options: {
  title: string
  message?: string
  /** The words of the button that goes ahead: "Delete", "Remove", "Sign out". */
  action: string
  destructive?: boolean
}): Promise<boolean> {
  const destructive = options.destructive ?? true
  return new Promise((resolve) => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: options.title,
          message: options.message,
          options: [options.action, "Cancel"],
          destructiveButtonIndex: destructive ? 0 : undefined,
          cancelButtonIndex: 1,
        },
        (index) => resolve(index === 0),
      )
      return
    }
    if (Platform.OS === "web") {
      const ask = (globalThis as { confirm?: (text: string) => boolean }).confirm
      resolve(
        ask === undefined
          ? true
          : ask([options.title, options.message].filter(Boolean).join("\n\n")),
      )
      return
    }
    Alert.alert(options.title, options.message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      {
        text: options.action,
        style: destructive ? "destructive" : "default",
        onPress: () => resolve(true),
      },
    ])
  })
}

/** Say that something went wrong, in the system's own alert. */
export function tell(title: string, message?: string): void {
  if (Platform.OS === "web") {
    ;(globalThis as { alert?: (text: string) => void }).alert?.(
      [title, message].filter(Boolean).join("\n\n"),
    )
    return
  }
  Alert.alert(title, message)
}

/** What went wrong, in words fit to show: the server's own where it gave any. */
export const errorText = (error: unknown, fallback = "Something went wrong. Try again."): string =>
  error instanceof Error && error.message !== "" ? error.message : fallback
