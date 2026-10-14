/** The apps a message can be written in: a web browser, the desktop app, the phone app. */
export const MESSAGE_APPS = ["browser", "desktop", "mobile"] as const
export type MessageApp = (typeof MESSAGE_APPS)[number]

/** The kinds of device a message can be written on, as a person would call them. */
export const MESSAGE_DEVICES = ["Mac", "Windows", "Linux", "iPhone", "iPad", "Android"] as const
export type MessageDevice = (typeof MESSAGE_DEVICES)[number]

/**
 * Where a message was written, as the app it was written in knows it, so that the agent can
 * tell which computer the person is at. It is the sender's word and nothing is granted on it.
 */
export type MessageOrigin = {
  app: MessageApp
  /** The kind of device, where the app can tell. */
  device?: MessageDevice
  /**
   * The paired computer the app is running on. Only the desktop app knows one, and only while
   * its owner lets agents use the computer: a browser cannot tell which computer it is on.
   */
  computerId?: string
}

/**
 * The kind of device a browser is on, from what it calls itself, or undefined where that does
 * not say. `touchPoints` tells an iPad from a Mac: an iPad's browser calls itself a Mac.
 */
export function deviceOf(userAgent: string, touchPoints = 0): MessageDevice | undefined {
  if (/iPhone|iPod/.test(userAgent)) return "iPhone"
  if (/iPad/.test(userAgent)) return "iPad"
  // Before Linux, which Android also calls itself.
  if (/Android/.test(userAgent)) return "Android"
  if (/Windows/.test(userAgent)) return "Windows"
  if (/Macintosh|Mac OS X/.test(userAgent)) return touchPoints > 1 ? "iPad" : "Mac"
  if (/Linux|X11/.test(userAgent)) return "Linux"
  return undefined
}
