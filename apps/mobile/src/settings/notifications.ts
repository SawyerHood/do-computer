import type { Client } from "@do-computer/client"
import * as Notifications from "expo-notifications"
import { useCallback, useEffect, useState } from "react"
import { AppState, Platform } from "react-native"
import { registerForPush } from "@/lib/push"

/**
 * What the system says about notifications from this app. `refused` is a no that only the
 * system's own Settings can undo; `unsupported` is a browser, where the app only runs for tests.
 */
export type NotificationsState = "on" | "off" | "refused" | "unsupported"

async function read(): Promise<NotificationsState> {
  if (Platform.OS === "web") return "unsupported"
  try {
    const permission = await Notifications.getPermissionsAsync()
    return permission.granted ? "on" : permission.canAskAgain ? "off" : "refused"
  } catch {
    return "unsupported"
  }
}

/** The token this phone is reached by, once it is known, so that signing out can take it back. */
let kept: string | undefined

/** Ask for permission where it has not been answered, and tell the server where this phone is. */
export async function enablePush(client: Client): Promise<NotificationsState> {
  kept = (await registerForPush(client)) ?? kept
  return read()
}

/**
 * Stop the server sending to this phone, as the web app forgets a browser on signing out. Never
 * asks for permission: a phone that was not allowed to be notified has nothing to take back.
 */
export async function forgetPush(client: Client): Promise<void> {
  if (Platform.OS === "web") return
  try {
    if (kept === undefined && (await read()) === "on") {
      // Allowed already, so this asks nothing and only gives the token back.
      kept = await registerForPush(client)
    }
    if (kept !== undefined) await client.unregisterPush(kept)
  } catch {
    // Signing out goes on; the server drops a token that stops answering.
  }
  kept = undefined
}

/** A notification from the phone to itself, shown at once. The server's test is for browsers. */
export async function sendTest(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title: "Do Computer", body: "This is a test. Notifications are on for this phone." },
    trigger: null,
  })
}

/**
 * Whether notifications are allowed, read when a screen opens and again whenever the app comes
 * back to the front, since the answer may have been changed in the system's Settings meanwhile.
 */
export function useNotificationsState(): [NotificationsState | undefined, () => Promise<void>] {
  const [state, setState] = useState<NotificationsState>()
  const refresh = useCallback(() => read().then(setState), [])
  useEffect(() => {
    void refresh()
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh()
    })
    return () => subscription.remove()
  }, [refresh])
  return [state, refresh]
}
