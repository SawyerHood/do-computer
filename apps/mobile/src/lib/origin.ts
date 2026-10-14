import { deviceOf, type MessageOrigin } from "@do-computer/protocol"
import { Platform } from "react-native"

/**
 * Where a message written here is from, for the agent to be told: this app and the kind of
 * device it is on. Built for a browser, it is a browser, and says what that calls itself.
 */
export function messageOrigin(): MessageOrigin {
  if (Platform.OS === "web") {
    const device = deviceOf(navigator.userAgent, navigator.maxTouchPoints)
    return { app: "browser", ...(device === undefined ? {} : { device }) }
  }
  if (Platform.OS === "ios") return { app: "mobile", device: Platform.isPad ? "iPad" : "iPhone" }
  return Platform.OS === "android" ? { app: "mobile", device: "Android" } : { app: "mobile" }
}
