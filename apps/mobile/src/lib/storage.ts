import * as SecureStore from "expo-secure-store"
import { Platform } from "react-native"

/**
 * Small values kept across launches: the server address and the session. On a device they go in
 * the platform's secure store; in a browser, where the app runs for tests, in localStorage.
 */
export const storage = {
  get(key: string): string | null {
    if (Platform.OS === "web") {
      try {
        return globalThis.localStorage?.getItem(key) ?? null
      } catch {
        return null
      }
    }
    return SecureStore.getItem(key)
  },
  set(key: string, value: string): void {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.setItem(key, value)
      } catch {
        // Storage can be unavailable; the value then lasts for this page only.
      }
      return
    }
    SecureStore.setItem(key, value)
  },
  remove(key: string): void {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.removeItem(key)
      } catch {
        // Nothing to remove.
      }
      return
    }
    void SecureStore.deleteItemAsync(key)
  },
}
