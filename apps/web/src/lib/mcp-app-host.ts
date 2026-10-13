import {
  MCP_APP_PROTOCOL_VERSION,
  type McpAppDetails,
  mcpAppError,
  mcpAppNotice,
  mcpAppResult,
  type McpAppToolResult,
  readMcpAppMessage,
} from "@do-computer/protocol"

/** How a page is shown: in the reply, or large over the page. */
export type AppDisplayMode = "inline" | "fullscreen"

/** What a page is told of where it is shown. */
export type AppHostContext = {
  theme: "light" | "dark"
  styles: { variables: Record<string, string> }
  displayMode: AppDisplayMode
  availableDisplayModes: AppDisplayMode[]
  containerDimensions: { maxHeight: number }
  platform: "web"
  locale: string
  timeZone: string
}

export type AppHostOptions = {
  /** Say something to the page. */
  post: (message: unknown) => void
  /** Where the page is shown, as it is now. */
  context: () => AppHostContext
  /** Whether the reader has just pressed something in the page: what a page does by itself is less. */
  pressed: () => boolean
  /** Use one of the page's own server's tools. Rejects with words for the page where it is not done. */
  callTool: (name: string, given: Record<string, unknown>) => Promise<McpAppToolResult>
  /** Read something of the page's own server. */
  readResource: (uri: string) => Promise<unknown>
  /** Open a web address in a new tab. */
  openLink: (url: string) => void
  /** Put words in the chat's message box. False where there is none. */
  say: (text: string) => boolean
  /** Show the page large, or put it back. */
  setMode: (mode: AppDisplayMode) => void
  /** The page said how tall it is. */
  onHeight: (height: number) => void
}

/** How many things a page may have asked for that are not yet answered. */
const MAX_WAITING = 8
/** The longest thing a page can put in the message box. */
const MAX_SAID = 4_000

/**
 * The app's side of the talk with a connector's page, as MCP Apps has it: JSON-RPC, passed
 * through the frame. The page says it is there (`ui/initialize`) and is told where it is; once
 * it says it is ready it is told what the tool was asked and what it answered. After that the
 * page may ask for things, and each is done or refused here.
 *
 * `receive` is given what the page posts. Whoever calls it has made sure the page it is from
 * is this one's.
 */
export function createAppHost(details: McpAppDetails, options: AppHostOptions) {
  let ready = false
  let told = false
  let waiting = 0
  let sent: AppHostContext | undefined

  const tell = () => {
    if (!ready || told) return
    told = true
    const input = details.input
    options.post(
      mcpAppNotice("ui/notifications/tool-input", {
        arguments:
          typeof input === "object" && input !== null && !Array.isArray(input) ? input : {},
      }),
    )
    options.post(mcpAppNotice("ui/notifications/tool-result", details.result))
  }

  /** Answer `id` with what `work` comes to, or with why it failed. */
  const answer = (id: string | number, work: () => Promise<unknown>) => {
    if (waiting >= MAX_WAITING) {
      return options.post(mcpAppError(id, "Too much is being asked for at once."))
    }
    waiting++
    void work().then(
      (result) => {
        waiting--
        options.post(mcpAppResult(id, result))
      },
      (error: unknown) => {
        waiting--
        options.post(mcpAppError(id, error instanceof Error ? error.message : "It was not done."))
      },
    )
  }

  const asked = (id: string | number, method: string, params: Record<string, unknown>) => {
    switch (method) {
      case "ui/initialize": {
        sent = options.context()
        return options.post(
          mcpAppResult(id, {
            protocolVersion: MCP_APP_PROTOCOL_VERSION,
            hostInfo: { name: "do-computer", version: "1" },
            hostCapabilities: {
              openLinks: {},
              serverTools: {},
              serverResources: {},
              logging: {},
              message: { text: {} },
              sandbox: details.app.csp === undefined ? {} : { csp: details.app.csp },
            },
            hostContext: sent,
          }),
        )
      }
      case "ping":
        return options.post(mcpAppResult(id, {}))
      case "tools/call": {
        const { name, arguments: given = {} } = params
        if (
          typeof name !== "string" ||
          name === "" ||
          typeof given !== "object" ||
          given === null
        ) {
          return options.post(mcpAppError(id, "tools/call needs a tool's name.", -32602))
        }
        return answer(id, () => options.callTool(name, given as Record<string, unknown>))
      }
      case "resources/read": {
        const { uri } = params
        if (typeof uri !== "string" || uri === "") {
          return options.post(mcpAppError(id, "resources/read needs a uri.", -32602))
        }
        return answer(id, () => options.readResource(uri))
      }
      case "ui/open-link": {
        const { url } = params
        if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
          return options.post(mcpAppError(id, "Only a web address can be opened.", -32602))
        }
        // Only on the reader's own press: a page opens no tabs by itself.
        if (!options.pressed()) {
          return options.post(mcpAppError(id, "Only when the person has just pressed something."))
        }
        options.openLink(url)
        return options.post(mcpAppResult(id, {}))
      }
      case "ui/message": {
        const blocks = Array.isArray(params.content) ? params.content : [params.content]
        const words = blocks.map((block) => {
          const { type, text } = (block ?? {}) as { type?: unknown; text?: unknown }
          return type === "text" && typeof text === "string" ? text : undefined
        })
        const text = words.includes(undefined) ? "" : words.join("\n").trim().slice(0, MAX_SAID)
        if (params.role !== "user" || text === "") {
          return options.post(mcpAppError(id, "Only words from the person's side.", -32602))
        }
        if (!options.pressed()) {
          return options.post(mcpAppError(id, "Only when the person has just pressed something."))
        }
        // The words go in the message box, for the person to send or not.
        return options.post(
          options.say(text)
            ? mcpAppResult(id, {})
            : mcpAppError(id, "There is no message box here."),
        )
      }
      case "ui/request-display-mode": {
        const { mode } = params
        const now = options.context().displayMode
        if (mode !== "inline" && mode !== "fullscreen")
          return options.post(mcpAppResult(id, { mode: now }))
        if (mode === "fullscreen" && !options.pressed()) {
          return options.post(mcpAppResult(id, { mode: now }))
        }
        options.setMode(mode)
        return options.post(mcpAppResult(id, { mode }))
      }
      default:
        return options.post(mcpAppError(id, `${method} is not something this app does.`, -32601))
    }
  }

  return {
    /** What the page posted. */
    receive(data: unknown) {
      const message = readMcpAppMessage(data)
      if (message === undefined) return
      if (message.id !== undefined) return asked(message.id, message.method, message.params)
      if (message.method === "ui/notifications/initialized") {
        ready = true
        return tell()
      }
      if (message.method === "ui/notifications/size-changed") {
        const { height } = message.params
        if (typeof height === "number" && Number.isFinite(height) && height > 0) {
          options.onHeight(height)
        }
      }
    },
    /** Where the page is shown has changed: it is told what is different. */
    contextChanged() {
      if (sent === undefined) return
      const now = options.context()
      const changed: Partial<AppHostContext> = {}
      if (now.theme !== sent.theme) changed.theme = now.theme
      if (now.displayMode !== sent.displayMode) changed.displayMode = now.displayMode
      if (JSON.stringify(now.styles) !== JSON.stringify(sent.styles)) changed.styles = now.styles
      sent = now
      if (Object.keys(changed).length > 0) {
        options.post(mcpAppNotice("ui/notifications/host-context-changed", changed))
      }
    },
  }
}
