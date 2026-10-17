import type { ConnectorSummary } from "@do-computer/protocol"
import type { ReactNode } from "react"
import { Platform } from "react-native"
import * as WebBrowser from "expo-web-browser"
import { errorText, tell, Text } from "@/ui"

/** What a connector's state is called, and how its mark is colored. */
export const STATUS = {
  connected: { label: "Connected", tone: "good" },
  needs_auth: { label: "Needs sign-in", tone: "busy" },
  error: { label: "Not connected", tone: "bad" },
} as const

/** How many of a connector's tools are named on its row: a server may have hundreds. */
const TOOLS_NAMED = 12

/** A connector's tools by name, the first few of them where there are many, as the web app's card has them. */
export function toolNames(tools: ConnectorSummary["tools"]): string {
  const named = tools
    .slice(0, TOOLS_NAMED)
    .map((tool) => tool.name)
    .join(", ")
  return tools.length > TOOLS_NAMED ? `${named} and ${tools.length - TOOLS_NAMED} more` : named
}

/** The host of an address, for a line under a name. The address itself where it is not one. */
export const hostOf = (url: string | null): string | undefined => {
  try {
    return url === null ? undefined : new URL(url).host
  } catch {
    return url ?? undefined
  }
}

/** The site an address is on: `https://composio.dev` of `https://composio.dev/mcp/x`. */
export const originOf = (url: string): string => {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

/** Show a page in the browser that comes up over the app, which keeps the app where it is. */
export function open(url: string): void {
  WebBrowser.openBrowserAsync(url).catch((error) =>
    tell("That could not be opened", errorText(error)),
  )
}

/**
 * Send someone to a service to sign in to it, and come back when they are done there. On a
 * device that is the system's sign-in window over the app. In a browser the page itself goes
 * there, as the web app's does, and the service sends it back to the connectors: a window opened
 * this late after the press would be stopped by the browser.
 */
export async function signIn(authorizationUrl: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.location?.assign(authorizationUrl)
    return
  }
  await WebBrowser.openAuthSessionAsync(authorizationUrl)
}

/** The small words under a group, which may have links in them. */
export function Words({ children, tone = "ink2" }: { children: ReactNode; tone?: "ink2" | "red" }) {
  return (
    <Text variant="footnote" tone={tone}>
      {children}
    </Text>
  )
}

/** Words inside `Words` that open a page. */
export function WordsLink({ children, url }: { children: string; url: string }) {
  return (
    <Text variant="footnote" tone="tint" accessibilityRole="link" onPress={() => open(url)}>
      {children}
    </Text>
  )
}
