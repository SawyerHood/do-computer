import type { Client } from "@durable-computer/client"
import Constants from "expo-constants"
import * as Device from "expo-device"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

/** Show a notification even while the app is open; the chat it is about may not be on screen. */
export function configureNotifications(): void {
  if (Platform.OS === "web") return
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  })
}

/**
 * Ask for permission and tell the server where to reach this device. Returns the token, or
 * undefined when notifications are not possible here: a simulator, a browser, a refusal, or a
 * build without a push project.
 */
export async function registerForPush(client: Client): Promise<string | undefined> {
  if (Platform.OS === "web" || !Device.isDevice) return undefined
  try {
    const current = await Notifications.getPermissionsAsync()
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted
    if (!granted) return undefined
    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId === undefined ? undefined : { projectId },
    )
    await client.registerPush(token, Platform.OS)
    return token
  } catch {
    return undefined
  }
}

/** Where a tapped notification leads, from the data the server attached to it. */
export function notificationTarget(
  data: unknown,
): { agentId: string; chatId: string | null } | undefined {
  const value = data as { agentId?: unknown; chatId?: unknown } | null
  if (typeof value?.agentId !== "string") return undefined
  return { agentId: value.agentId, chatId: typeof value.chatId === "string" ? value.chatId : null }
}
