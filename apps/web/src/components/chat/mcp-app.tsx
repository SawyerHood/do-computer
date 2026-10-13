import {
  MCP_APP_DEFAULT_HEIGHT,
  type McpAppDetails,
  mcpAppFrameHeight,
  readMcpApp,
  type ToolPart,
} from "@do-computer/protocol"
import { ArrowsInSimpleIcon, PlugsConnectedIcon } from "@phosphor-icons/react"
import { useContext, useEffect, useMemo, useRef, useState } from "react"
import { useConfirm } from "@/components/confirm"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { type AppDisplayMode, createAppHost } from "@/lib/mcp-app-host"
import { appStyleVariables } from "@/lib/mcp-app-styles"
import { pressedIn } from "@/lib/pressed"
import { cn } from "@/lib/utils"
import { useAppColors } from "@/lib/visual-theme"
import { AgentIdContext } from "./sent-file.tsx"
import { useSay } from "./use-say.ts"

/**
 * The page a connector's own server gives for one of its tools, in the chat where the agent
 * used the tool: a live view of what the tool answered. It is somebody else's page, so it says
 * whose it is, it runs in a frame kept apart from the app, and what it asks of its server goes
 * through the app, which asks the person before anything that may change something there.
 */
export function McpAppFrame({ part }: { part: ToolPart }) {
  const agentId = useContext(AgentIdContext)
  const details = useMemo(() => readMcpApp(part.details), [part.details])
  return agentId === undefined || details === undefined ? null : (
    <FrameOf agentId={agentId} details={details} />
  )
}

function FrameOf({ agentId, details }: { agentId: string; details: McpAppDetails }) {
  const { app } = details
  // The same from one draw to the next: what the page is told is kept by what is made with it.
  const api = useMemo(() => client.agent(agentId), [agentId])
  const colors = useAppColors()
  const put = useSay()
  const [confirm, confirming] = useConfirm()
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState<number>()
  const [loaded, setLoaded] = useState(false)
  // Shown large, it is the same frame over the page: what the page was doing, it still is.
  const [mode, setMode] = useState<AppDisplayMode>("inline")

  // What the page asks is answered with what these are now, by a host made once: one made
  // again would have forgotten that the page had already said it was there.
  const now = useRef({ colors, mode, put, confirm })
  now.current = { colors, mode, put, confirm }
  const host = useMemo(
    () =>
      createAppHost(details, {
        // Its origin is nobody's, so "*" is the only address that reaches it.
        post: (message) => frame.current?.contentWindow?.postMessage(message, "*"),
        context: () => ({
          theme: now.current.colors.appearance === "light" ? "light" : "dark",
          styles: { variables: appStyleVariables() },
          displayMode: now.current.mode,
          availableDisplayModes: ["inline", "fullscreen"],
          containerDimensions: { maxHeight: 1600 },
          platform: "web",
          locale: navigator.language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        pressed: () => pressedIn(frame.current),
        callTool: async (tool, given) => {
          const first = await api.appCall(app.connectorId, { tool, arguments: given })
          if (!("needsConsent" in first)) return first
          // The tool may change something at the service, so the person is asked.
          const { description } = first.needsConsent
          const agreed = await now.current.confirm({
            title: `Let this page use “${tool}”?`,
            description: `The page from ${app.connector} wants to run that tool there${
              description === "" ? "" : `: ${description}`
            }. It may change something at the service.`,
            action: "Run it",
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
        openLink: (url) => void window.open(url, "_blank", "noopener,noreferrer"),
        say: (text) => {
          // The box is under the page while the page is large.
          if (!now.current.put(text)) return false
          setMode("inline")
          return true
        },
        setMode,
        onHeight: setHeight,
      }),
    [api, app.connector, app.connectorId, details],
  )

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (frame.current !== null && event.source === frame.current.contentWindow) {
        host.receive(event.data)
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [host])
  // The page is told when the app goes light or dark, or the page is made large or put back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are what it is told of
  useEffect(() => host.contextChanged(), [host, colors, mode])

  const large = mode === "fullscreen"
  // A line round it unless the page asks for none: it is not part of the reply.
  const lined = app.border !== false
  return (
    <div className="flex w-full flex-col gap-1.5">
      {/* Whose page this is: not the agent's, and not the app's. */}
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <PlugsConnectedIcon className="size-3.5 shrink-0" />
        <span className="truncate">
          From <span className="font-medium text-foreground">{app.connector}</span>
        </span>
      </p>
      {/* Its place in the reply, which it keeps while it is shown large over the page. */}
      <div
        className="w-full"
        // As tall as the page says it is, and the line round it besides.
        style={{ height: mcpAppFrameHeight(height ?? MCP_APP_DEFAULT_HEIGHT) + (lined ? 2 : 0) }}
      >
        {large ? (
          <div
            aria-hidden
            className="fixed inset-0 z-40 bg-black/45"
            onClick={() => setMode("inline")}
          />
        ) : null}
        <figure
          aria-label={`App: ${app.tool} from ${app.connector}`}
          className={cn(
            "m-0 overflow-hidden bg-background",
            large
              ? "fixed inset-3 z-50 rounded-2xl shadow-float md:inset-8"
              : "relative size-full rounded-xl",
            !large && lined && "border border-hairline",
          )}
        >
          <iframe
            ref={frame}
            src={api.appPageUrl(app.id)}
            title={`${app.tool} from ${app.connector}`}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            // No `allow-same-origin`: the page must not be the app, though the app serves it.
            // It is served under the same rule, and under one that says what it may load.
            sandbox="allow-scripts allow-forms"
            className="block size-full border-0 bg-transparent"
            style={{ colorScheme: loaded ? colors.appearance : "light" }}
          />
          {large ? (
            <Button
              variant="outline"
              size="icon-sm"
              className="absolute top-2 right-2 bg-background/80 text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
              aria-label="Put it back in the reply"
              title="Put it back in the reply"
              onClick={() => setMode("inline")}
            >
              <ArrowsInSimpleIcon />
            </Button>
          ) : null}
        </figure>
      </div>
      {confirming}
    </div>
  )
}
