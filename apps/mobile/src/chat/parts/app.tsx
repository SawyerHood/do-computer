import { createAppHost } from "@do-computer/client"
import {
  MCP_APP_DEFAULT_HEIGHT,
  type McpAppDetails,
  mcpAppFrameHeight,
  readMcpApp,
  type ToolPart,
} from "@do-computer/protocol"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { Linking, StyleSheet, View } from "react-native"
import { authHeaders } from "@/lib/session"
import { mono, type Theme, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { confirm, Icon, Text } from "@/ui"
import { useSay } from "../composer"
import { type AppBridge, AppPage } from "./app-frame"
import { useChatScope } from "./shared"

/** The app's colors under the names MCP Apps gives them, for a connector's page to be drawn in. */
export function appStyleVariables(theme: Theme): Record<string, string> {
  return {
    "--color-background-primary": theme.page,
    "--color-background-secondary": theme.card,
    "--color-background-tertiary": theme.fill,
    "--color-background-inverse": theme.ink,
    "--color-background-ghost": theme.fill,
    "--color-background-danger": theme.red,
    "--color-background-success": theme.green,
    "--color-background-warning": theme.amber,
    "--color-text-primary": theme.ink,
    "--color-text-secondary": theme.ink2,
    "--color-text-tertiary": theme.ink2,
    "--color-text-inverse": theme.page,
    "--color-text-danger": theme.red,
    "--color-text-success": theme.green,
    "--color-text-warning": theme.amber,
    "--color-border-primary": theme.sep,
    "--color-border-secondary": theme.ink3,
    "--color-border-tertiary": theme.sep,
    "--color-border-danger": theme.red,
    "--color-ring-primary": theme.tint,
    "--font-sans": "-apple-system, system-ui, sans-serif",
    "--font-mono": `${mono}, ui-monospace, Menlo, monospace`,
    "--border-radius-md": "10px",
  }
}

/**
 * The page a connector's own server gives for one of its tools, in the chat where the Dood
 * used the tool: a live view of what the tool answered. It is somebody else's page, so it says
 * whose it is, it is kept apart from the app, and what it asks of its server goes through the
 * app, which asks the person before anything that may change something there. The talk with
 * the page is the web app's own (`createAppHost`). A phone shows it only in the reply: there is
 * no large.
 */
export const McpAppFrame = memo(function McpAppFrame({ part }: { part: ToolPart }) {
  const details = useMemo(() => readMcpApp(part.details), [part.details])
  return details === undefined ? null : <FrameOf details={details} />
})

function FrameOf({ details }: { details: McpAppDetails }) {
  const { app } = details
  const { agentId, chatId } = useChatScope()
  const { client, auth } = useSession()
  const theme = useTheme()
  const say = useSay(chatId)
  // The same from one draw to the next: what the page is told is kept by what is made with it.
  const api = useMemo(() => client.agent(agentId), [client, agentId])
  const [height, setHeight] = useState<number>()
  const bridge = useRef<AppBridge>({ post: () => {}, pressed: async () => false }).current
  // What the page asks is answered with what these are now, by a host made once: one made
  // again would have forgotten that the page had already said it was there.
  const now = useRef({ theme, say })
  now.current = { theme, say }
  const host = useMemo(
    () =>
      createAppHost(details, {
        post: (message) => bridge.post(message),
        context: () => ({
          theme: now.current.theme.dark ? "dark" : "light",
          styles: { variables: appStyleVariables(now.current.theme) },
          displayMode: "inline",
          availableDisplayModes: ["inline"],
          containerDimensions: { maxHeight: 1600 },
          platform: "mobile",
          locale: Intl.DateTimeFormat().resolvedOptions().locale,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        pressed: () => bridge.pressed(),
        callTool: async (tool, given) => {
          const first = await api.appCall(app.connectorId, { tool, arguments: given })
          if (!("needsConsent" in first)) return first
          // The tool may change something at the service, so the person is asked.
          const { description } = first.needsConsent
          const agreed = await confirm({
            title: `Let this page use “${tool}”?`,
            message: `The page from ${app.connector} wants to run that tool there${
              description === "" ? "" : `: ${description}`
            }. It may change something at the service.`,
            action: "Run it",
            destructive: false,
          })
          if (!agreed) throw new Error("The person said no.")
          const again = await api.appCall(app.connectorId, {
            tool,
            arguments: given,
            confirmed: true,
          })
          if ("needsConsent" in again) throw new Error("It was not run.")
          return again
        },
        readResource: (uri) => api.appRead(app.connectorId, uri),
        openLink: (url) => void Linking.openURL(url).catch(() => {}),
        say: (text) => {
          now.current.say(text)
          return true
        },
        setMode: () => {},
        onHeight: setHeight,
      }),
    [api, app.connector, app.connectorId, bridge, details],
  )
  // The page is told when the app goes light or dark.
  useEffect(() => host.contextChanged(), [host, theme.dark])
  // A line round it unless the page asks for none: it is not part of the reply.
  const lined = app.border !== false
  const headers = useMemo(() => authHeaders(auth), [auth])
  return (
    <View style={{ width: "100%", gap: 6 }}>
      {/* Whose page this is: not the Dood's, and not the app's. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 }}>
        <Icon name="plug" size={14} color={theme.ink2} />
        <Text variant="caption" tone="ink2" numberOfLines={1}>
          From{" "}
          <Text variant="caption" weight="600">
            {app.connector}
          </Text>
        </Text>
      </View>
      <View
        accessibilityLabel={`App: ${app.tool} from ${app.connector}`}
        style={[
          {
            width: "100%",
            height: mcpAppFrameHeight(height ?? MCP_APP_DEFAULT_HEIGHT) + (lined ? 2 : 0),
            borderRadius: 12,
            overflow: "hidden",
            backgroundColor: theme.page,
          },
          lined ? { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.sep } : null,
        ]}
      >
        <AppPage
          src={api.appPageUrl(app.id)}
          headers={headers}
          title={`${app.tool} from ${app.connector}`}
          bridge={bridge}
          onMessage={host.receive}
        />
      </View>
    </View>
  )
}
