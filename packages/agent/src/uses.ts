import {
  type BrowserRan,
  DEFAULT_BROWSER_TIMEOUT_MS,
  type Json,
  type LiveView,
  MAX_BROWSER_TIMEOUT_MS,
  SCREEN_ACTIONS,
  type DesktopAction,
  type ScreenActed,
  type ScreenAction,
  type ScreenWindow,
  type WindowAct,
  windowName,
  type Shot,
  type UseDetails,
  type UseWhat,
  type UsingAgent,
  VIEW_WAIT_MS,
} from "@do-computer/protocol"
import type { BlobStore } from "@do-computer/runtime"
import type { Context } from "@earendil-works/chord"
import { type Message, StringEnum, Type } from "@earendil-works/pi-ai"
import {
  defineExtension,
  defineTool,
  type Extension,
  GenerationTask,
  hook,
  section,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable"
import { ComputerEnv, type ComputerTarget, isPaired } from "./computers.ts"

/** How many of the pictures a screen or a browser gave it the agent keeps in front of it. */
const KEPT_PICTURES = 4
/** What stands in a tool result where a picture was. */
const DROPPED = "(A picture was here. It is no longer shown: look again if you need to.)"
/** The longest a wait on the screen may be. */
const MAX_WAIT_SECONDS = 10

export const SCREEN_TOOL = "screen"
export const BROWSER_TOOL = "browser"

export type UsesOptions = {
  readonly agentId: string
  /** Where the pictures taken at each step are kept, for a chat to show afterwards. */
  readonly blobs: BlobStore
  /** Who the agent is, as it is said on the computer and to whoever watches. */
  readonly agent: (context: Context) => Promise<UsingAgent>
  /**
   * Whether the browser kept for agents on a computer has a window its owner can watch, as the
   * agent's workspace has it now. Where this is absent or does not know, the computer is not told.
   */
  readonly showsBrowser?: (context: Context) => Promise<boolean | undefined>
  /** Whether the model the agent runs on takes pictures. */
  readonly sees: (context: Context) => Promise<boolean>
  /** The computer of that name or id, ready to work on, or why there is none. */
  readonly computer: (id: string, context: Context) => Promise<ComputerTarget | string>
}

/** A failure the agent is told of, as opposed to a bug. */
export class UseError extends Error {}

const fail = (text: string): ToolExecutionResult => ({
  isError: true,
  content: [{ type: "text", text }],
})

const shotKey = (id: string) => `shots/${id}`

const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" }

function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** What an action is called while it is done, where the agent did not say. */
function sayOf(action: ScreenAction): string {
  switch (action.do) {
    case "windows":
      return "Looking at what is open"
    case "open":
      return `Opening ${action.app}`
    case "in_window":
      return action.act.do === "screenshot" ? "Looking at a window" : sayOf(action.act)
    case "screenshot":
      return "Looking at the screen"
    case "click":
      return "Clicking"
    case "double_click":
      return "Double-clicking"
    case "right_click":
      return "Right-clicking"
    case "move":
      return "Moving the pointer"
    case "drag":
      return "Dragging"
    case "scroll":
      return `Scrolling ${action.direction}`
    case "type":
      return `Typing ${action.text.length > 40 ? `${action.text.slice(0, 40)}…` : action.text}`
    case "key":
      return `Pressing ${action.keys}`
    case "wait":
      return "Waiting"
  }
}

/** A window as it is listed for an agent: what it is asked for by, and what tells it from the others. */
function windowLine(window: ScreenWindow): string {
  const title = window.title.trim()
  return [
    String(window.id),
    window.app.trim() || "(no name)",
    ...(title === "" || title === window.app.trim() ? [] : [title]),
    `${window.width}×${window.height}`,
    ...(window.shown ? [] : ["not showing"]),
  ].join(" · ")
}

const windowLines = (windows: readonly ScreenWindow[]) =>
  windows.length === 0 ? "(none)" : windows.map(windowLine).join("\n")

/** What a window is called in a sentence. */
function windowSaid(window: ScreenWindow): string {
  return `Window ${window.id} (${windowName(window)})`
}

/** The action a call's arguments ask for, or what is wrong with them. */
export function screenAction(args: {
  action: string
  window?: number
  in_front?: boolean
  app?: string
  x?: number
  y?: number
  to_x?: number
  to_y?: number
  direction?: string
  amount?: number
  text?: string
  keys?: string
  seconds?: number
}): ScreenAction | string {
  if (args.action === "windows") return { do: "windows" }
  if (args.action === "open") {
    return typeof args.app === "string" && args.app.trim() !== ""
      ? { do: "open", app: args.app.trim() }
      : "open needs app: the name of the app to open, such as Notes."
  }
  if (args.window === undefined || args.window === null) return desktopAction(args)
  if (!Number.isInteger(args.window) || args.window <= 0) {
    return "window is the id of a window, a whole number: ask for `windows` to see the ones there are."
  }
  if (args.action === "move") {
    return "move is for the whole screen. In a window nothing is under your pointer until you click: leave out `window` to move the computer's own pointer."
  }
  const act = desktopAction(args)
  if (typeof act === "string") return act
  // In a window the keyboard is wherever was last clicked, or at a place given with the text.
  const place =
    act.do === "type" && Number.isFinite(args.x) && Number.isFinite(args.y)
      ? { x: Math.round(args.x!), y: Math.round(args.y!) }
      : {}
  return {
    do: "in_window",
    window: args.window,
    ...(args.in_front === true ? { inFront: true } : {}),
    act: { ...act, ...place } as WindowAct,
  }
}

/** The same for an action done to the whole screen. */
function desktopAction(args: {
  action: string
  x?: number
  y?: number
  to_x?: number
  to_y?: number
  direction?: string
  amount?: number
  text?: string
  keys?: string
  seconds?: number
}): DesktopAction | string {
  const at = (): { x: number; y: number } | undefined =>
    Number.isFinite(args.x) && Number.isFinite(args.y)
      ? { x: Math.round(args.x!), y: Math.round(args.y!) }
      : undefined
  const place = at()
  switch (args.action) {
    case "screenshot":
      return { do: "screenshot" }
    case "click":
    case "double_click":
    case "right_click":
    case "move":
      return place === undefined
        ? `${args.action} needs x and y, in the pixels of the last picture.`
        : { do: args.action, ...place }
    case "drag":
      if (place === undefined || !Number.isFinite(args.to_x) || !Number.isFinite(args.to_y)) {
        return "drag needs x and y to start from, and to_x and to_y to end at."
      }
      return { do: "drag", ...place, toX: Math.round(args.to_x!), toY: Math.round(args.to_y!) }
    case "scroll": {
      const direction = args.direction
      if (
        place === undefined ||
        (direction !== "up" &&
          direction !== "down" &&
          direction !== "left" &&
          direction !== "right")
      ) {
        return "scroll needs x and y to scroll at, and a direction: up, down, left or right."
      }
      const amount = Number.isFinite(args.amount) ? Math.min(Math.max(1, args.amount!), 30) : 3
      return { do: "scroll", ...place, direction, amount }
    }
    case "type":
      return typeof args.text === "string" && args.text !== ""
        ? { do: "type", text: args.text }
        : "type needs the text to type."
    case "key":
      return typeof args.keys === "string" && args.keys.trim() !== ""
        ? { do: "key", keys: args.keys.trim() }
        : "key needs keys, such as enter or cmd+s."
    case "wait": {
      const seconds = Number.isFinite(args.seconds) ? args.seconds! : 1
      return { do: "wait", seconds: Math.min(Math.max(0.1, seconds), MAX_WAIT_SECONDS) }
    }
    default:
      return `There is no action "${args.action}". The actions: ${SCREEN_ACTIONS.join(", ")}.`
  }
}

/**
 * Take the older pictures out of what the model is sent, leaving the newest few. Each one costs
 * as much as a page of text, and one from ten steps ago shows a screen that is no longer so.
 */
export function dropOldPictures(messages: readonly Message[], keep = KEPT_PICTURES): Message[] {
  let left = keep
  const kept: Message[] = []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (
      message.role !== "toolResult" ||
      (message.toolName !== SCREEN_TOOL && message.toolName !== BROWSER_TOOL) ||
      !message.content.some((part) => part.type === "image")
    ) {
      kept.push(message)
      continue
    }
    // Newest first within a result too: the last picture a script took is the page as it is.
    const content = [...message.content]
    for (let part = content.length - 1; part >= 0; part--) {
      if (content[part]!.type !== "image") continue
      if (left > 0) left--
      else content[part] = { type: "text", text: DROPPED }
    }
    kept.push({ ...message, content })
  }
  return kept.reverse()
}

/**
 * The screen of somebody's own computer, and a browser on it, as tools. Both run on the computer
 * a call names, through its daemon, and both can be watched while they are used: the pictures
 * for that are asked of the computer by `view`, and are not kept. The picture each call ends
 * with is kept, so that a chat can show afterwards what was done.
 */
export class Uses {
  readonly extension: Extension
  /** To be given the `computer` argument by the computers extension, as the file tools are. */
  readonly tools: readonly ToolRegistration[]
  readonly #options: UsesOptions
  /** What is being done on each computer's screen, so that the next thing waits for it. */
  readonly #turns = new Map<string, Promise<unknown>>()

  constructor(options: UsesOptions) {
    this.#options = options
    this.tools = [this.#screen(), this.#browser()] as unknown as ToolRegistration[]
    this.extension = defineExtension({
      name: "dc.uses",
      tools: [...this.tools],
      sections: [
        section(
          "screen-and-browser",
          () =>
            `On somebody's own computer you may be able to use more than files and commands. \`${BROWSER_TOOL}\` runs a short script in a browser there: use it for anything on a website. It is their own Chrome when that is open and lets itself be used, with everything they are signed in to, and otherwise a browser kept for agents. \`${SCREEN_TOOL}\` works the programs on the computer's screen: use it for programs that can be worked no other way, and prefer a command, a file or the browser when one of those would do, because the screen is slow. Work in one window at a time, which is done behind whatever the person has in front and leaves them their mouse and keyboard, so that they can carry on with their own work; only the whole screen, and a window you ask to have brought forward, take those from them. The person can watch either while you work, pause you, and stop you. Say what you are doing in each call's \`note\`, in a few words, for them to read. Whether a computer allows either is its owner's to say, on that computer: where it does not, the tool says so, and you cannot switch it on.`,
        ),
      ],
      hooks: [
        hook(GenerationTask, {
          beforeRequest: (request) => {
            const messages = dropOldPictures(request.messages)
            return { messages }
          },
        }),
      ],
    })
  }

  /** One thing at a time on a computer: the calls of a round start together. */
  #inTurn<T>(key: string, work: () => Promise<T>): Promise<T> {
    const before = this.#turns.get(key) ?? Promise.resolve()
    const mine = before.then(work, work)
    const settled = mine.catch(() => {})
    this.#turns.set(key, settled)
    void settled.then(() => {
      if (this.#turns.get(key) === settled) this.#turns.delete(key)
    })
    return mine
  }

  /** The computer a call is for, where it is one whose screen and browser can be asked for. */
  #target(env: unknown, what: string): ComputerTarget | string {
    const target = env instanceof ComputerEnv ? env.target : undefined
    if (target === undefined || !isPaired(target.computer) || target.sandbox.use === undefined) {
      return `${what} can be used only on somebody's own computer: one they connected themselves. Name one with \`computer\`. A machine of the workspace has neither a screen nor a browser to use.`
    }
    return target
  }

  /** Keep a picture, and resolve with the id it is fetched by. */
  async #keep(shot: Shot): Promise<string> {
    const id = `${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}.${EXTENSION[shot.mimeType] ?? "img"}`
    await this.#options.blobs.put(shotKey(id), bytesOf(shot.data), { contentType: shot.mimeType })
    return id
  }

  /** A picture kept of a step, by its id. */
  async shot(id: string): Promise<{ bytes: Uint8Array; contentType: string } | undefined> {
    if (!/^[a-z0-9]+\.[a-z]+$/.test(id)) return undefined
    const found = await this.#options.blobs.get(shotKey(id))
    if (found === undefined) return undefined
    return { bytes: await found.bytes(), contentType: found.contentType ?? "image/jpeg" }
  }

  /**
   * How a computer's screen, or the browser on it, looks now, for someone watching. Nothing is
   * shown of one that no agent is using. A computer that cannot be asked is one with nothing
   * to see.
   */
  async view(computer: string, what: UseWhat, after: number, context: Context): Promise<LiveView> {
    const nothing: LiveView = { active: false, seq: after }
    const target = await this.#options.computer(computer, context)
    if (typeof target === "string" || target.sandbox.use === undefined) return nothing
    try {
      return (await target.sandbox.use(what, {
        op: "view",
        after,
        waitMs: VIEW_WAIT_MS,
      })) as LiveView
    } catch {
      return nothing
    }
  }

  /** Pause the agent on a computer's screen or browser, or let it carry on. */
  async hold(computer: string, what: UseWhat, held: boolean, context: Context): Promise<void> {
    const target = await this.#options.computer(computer, context)
    if (typeof target === "string") throw new UseError(target)
    if (target.sandbox.use === undefined) throw new UseError("That computer has nothing to pause.")
    try {
      await target.sandbox.use(what, { op: "hold", held })
    } catch (error) {
      throw new UseError(error instanceof Error ? error.message : String(error))
    }
  }

  #screen() {
    return defineTool({
      name: SCREEN_TOOL,
      description:
        "Work the programs on the screen of somebody's own computer. Every call does one thing and answers with a picture of how it looks afterwards. " +
        "Work in a window wherever you can. `windows` lists the windows there are, each with an id; `open` starts an app by its name (`app`) without bringing it forward, and answers with its windows. With `window` set to an id, every other action is done in that window alone, behind whatever the person has in front and without their mouse or keyboard, so they can carry on with their own work; the picture is of that window, whether or not it can be seen on the screen, and places are x and y in the pixels of the last picture you were given of it, from its top left. " +
        "`screenshot` looks; `click`, `double_click` and `right_click` take x and y; `drag` takes x, y, to_x and to_y; `scroll` takes x, y, a direction and an amount of wheel notches; " +
        "`type` types text where the keyboard is, so click there first, or give x and y with it to click the field and type in one go, which is what a field in a web page wants; `key` presses keys together, such as `enter`, `tab`, `escape`, `cmd+s` or `ctrl+shift+t`; `wait` waits some seconds for things to change. " +
        "Some things cannot be done behind what is in front, and the answer then says so: do the same again with `in_front: true`, which brings the window forward for that one action and takes the person's mouse and keyboard for a moment. Look at each picture to see that what you did took. " +
        "Without `window`, the action is done to the whole screen with the computer's own mouse and keyboard, which the person cannot then use: keep that for what is in no window, such as the Dock, the menu bar or the desktop. `move` is only for the whole screen. " +
        "The person can watch, pause you, and stop you. Their computer must allow this: if it does not, the answer says so.",
      parameters: Type.Object({
        action: StringEnum([...SCREEN_ACTIONS], { description: "What to do" }),
        window: Type.Optional(
          Type.Number({
            description:
              "The id of the window to do it in, from `windows` or `open`. Left out: the whole screen",
          }),
        ),
        in_front: Type.Optional(
          Type.Boolean({
            description:
              "With `window`: bring the window forward for this one action. Only when the answer said it could not be done otherwise",
          }),
        ),
        app: Type.Optional(Type.String({ description: "For open: the app's name, such as Notes" })),
        x: Type.Optional(Type.Number({ description: "Pixels from the left of the last picture" })),
        y: Type.Optional(Type.Number({ description: "Pixels from the top of the last picture" })),
        to_x: Type.Optional(Type.Number({ description: "For drag: where it ends" })),
        to_y: Type.Optional(Type.Number({ description: "For drag: where it ends" })),
        direction: Type.Optional(
          StringEnum(["up", "down", "left", "right"], { description: "For scroll" }),
        ),
        amount: Type.Optional(
          Type.Number({ description: "For scroll: wheel notches, 3 if left out" }),
        ),
        text: Type.Optional(Type.String({ description: "For type: the text" })),
        keys: Type.Optional(Type.String({ description: "For key: keys joined with +" })),
        seconds: Type.Optional(Type.Number({ description: "For wait: how long, 10 at most" })),
        note: Type.Optional(
          Type.String({
            description:
              "What you are doing, in a few words, for the person watching: “Clicking Mail in the Dock”",
          }),
        ),
      }),
      execute: async (args, api, context) => {
        const target = this.#target(api.env, "A screen")
        if (typeof target === "string") return fail(target)
        if (!(await this.#options.sees(context))) {
          return fail(
            "The model you are running on cannot see pictures, so it cannot use a screen. Say so: the person can choose a model that can in your settings.",
          )
        }
        const action = screenAction(args)
        if (typeof action === "string") return fail(action)
        const say = args.note?.trim() || sayOf(action)
        const computer = { id: target.id, name: target.computer.name }
        const details = (more: Partial<UseDetails["use"]> = {}): UseDetails => ({
          use: { what: "screen", computer, say, ...more },
        })
        await api.details(details() as unknown as Json, context)
        const agent = await this.#options.agent(context)
        let acted: ScreenActed
        try {
          acted = (await this.#inTurn(target.id, () =>
            target.sandbox.use!("screen", { op: "act", agent, action, say }),
          )) as ScreenActed
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error))
        }
        // An app from before windows does nothing with what it was asked, and says nothing of windows.
        const inWindows =
          action.do === "windows" || action.do === "open" || action.do === "in_window"
        if (inWindows && acted.window === undefined && acted.windows === undefined) {
          return fail(
            `The Do Computer app on ${computer.name} is from before agents could work in a window, so nothing was done. Its owner can install the newest Do Computer there. Until then, leave out \`window\` and use the whole screen, which takes their mouse and keyboard while you work.`,
          )
        }
        const { shot, pointer, window, windows, note } = acted
        const said: string[] = []
        if (action.do === "windows") {
          said.push(
            `The windows on ${computer.name}, the nearest the front first (id · app · title · size):\n${windowLines(windows ?? [])}\nGive an id as \`window\` to look at one and work in it. \`open\` starts an app that has no window here.`,
          )
        } else if (action.do === "open") {
          said.push(
            `Opened ${action.app}, behind what is in front. Its windows:\n${windowLines(windows ?? [])}`,
          )
        } else if (windows !== undefined) {
          said.push(`The windows there are now:\n${windowLines(windows)}`)
        }
        if (note !== undefined) said.unshift(note)
        if (shot === undefined) {
          return {
            content: [{ type: "text", text: said.join("\n") }],
            details: details() as unknown as Json,
          }
        }
        const kept = await this.#keep(shot)
        const of = window === undefined ? "The screen" : windowSaid(window)
        const looked =
          action.do === "screenshot" ||
          action.do === "open" ||
          (action.do === "in_window" && action.act.do === "screenshot")
        said.push(`${looked ? of : `Done. ${of} now`}, ${shot.width} by ${shot.height}:`)
        return {
          content: [
            { type: "text", text: said.join("\n") },
            { type: "image", data: shot.data, mimeType: shot.mimeType },
          ],
          details: details({
            shot: kept,
            width: shot.width,
            height: shot.height,
            ...(pointer === undefined ? {} : { pointer }),
            ...(window === undefined ? {} : { title: windowName(window) }),
          }) as unknown as Json,
        }
      },
    })
  }

  #browser() {
    return defineTool({
      name: BROWSER_TOOL,
      description:
        "Run a short script in a browser on somebody's own computer, with dev-browser. It is their own Chrome when that is open and lets itself be used (then you are signed in wherever they are, and `browser.listPages()` shows their tabs: leave those alone unless asked), and otherwise a browser kept for agents. " +
        'The script is the body of an async function with real Puppeteer objects; what it logs and the value of its last expression come back. End lines with semicolons. Pages are named and stay open between calls: `const page = await browser.getPage("main"); await page.goto("https://example.com");`. ' +
        'Look with `await page.snapshot({ interactive: true })`, an outline of the page with a ref on each thing, and act by ref: `await page.click("ref/e12")`, `await page.fill("ref/e7", "text")`, `await page.type("ref/e7", "text")`, `await page.keyboard.press("Enter")`. Refs change when the page does: look again. ' +
        "`page.click` does not wait: `await page.waitForSelector(sel, { visible: true })` or `await page.waitForLoad()` first where something may not be there yet. `await page.shot()` takes a picture, which you are shown. `page.url()`, `page.title()` and `page.evaluate(() => …)` are as in Puppeteer. " +
        'One decision to a call: look, or act and check. Prefer the outline to a picture: it is cheaper and exact. `await browser.closePage("main")` when a page is done with.',
      parameters: Type.Object({
        script: Type.String({ description: "The script to run" }),
        timeout: Type.Optional(
          Type.Number({
            description: `Seconds the script may take: ${DEFAULT_BROWSER_TIMEOUT_MS / 1000} if left out, ${MAX_BROWSER_TIMEOUT_MS / 1000} at most`,
          }),
        ),
        note: Type.Optional(
          Type.String({
            description:
              "What you are doing, in a few words, for the person watching: “Opening the pricing page”",
          }),
        ),
      }),
      execute: async (args, api, context) => {
        const target = this.#target(api.env, "A browser")
        if (typeof target === "string") return fail(target)
        if (args.script.trim() === "") return fail("There is no script to run.")
        const say = args.note?.trim() || "Using the browser"
        const computer = { id: target.id, name: target.computer.name }
        const details = (more: Partial<UseDetails["use"]> = {}): UseDetails => ({
          use: { what: "browser", computer, say, ...more },
        })
        await api.details(details() as unknown as Json, context)
        const agent = await this.#options.agent(context)
        const timeoutMs = Math.min(
          Math.max(1, args.timeout ?? DEFAULT_BROWSER_TIMEOUT_MS / 1000) * 1000,
          MAX_BROWSER_TIMEOUT_MS,
        )
        const shown = await this.#options.showsBrowser?.(context)
        let ran: BrowserRan
        try {
          // Scripts on one page would get in each other's way, so they take turns as well.
          ran = (await this.#inTurn(`${target.id}/browser`, () =>
            target.sandbox.use!("browser", {
              op: "run",
              agent,
              script: args.script,
              timeoutMs,
              say,
              ...(shown === undefined ? {} : { shown }),
            }),
          )) as BrowserRan
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error))
        }
        const sees = await this.#options.sees(context)
        const last = ran.shots.at(-1)
        const kept = last === undefined ? undefined : await this.#keep(last)
        const words = [
          ran.output.trim(),
          ran.error === undefined ? "" : `The script failed: ${ran.error}`,
          ran.url === undefined ? "" : `[page] ${ran.url}${ran.title ? ` “${ran.title}”` : ""}`,
          ran.shots.length > 0 && !sees
            ? "(It took a picture, which the model you are running on cannot see. Use page.snapshot() instead.)"
            : "",
        ]
          .filter((line) => line !== "")
          .join("\n")
        return {
          ...(ran.error === undefined ? {} : { isError: true }),
          content: [
            { type: "text", text: words === "" ? "(The script printed nothing.)" : words },
            ...(sees
              ? ran.shots.map((shot) => ({
                  type: "image" as const,
                  data: shot.data,
                  mimeType: shot.mimeType,
                }))
              : []),
          ],
          details: details({
            ...(kept === undefined || last === undefined
              ? {}
              : { shot: kept, width: last.width, height: last.height }),
            ...(ran.url === undefined ? {} : { url: ran.url }),
            ...(ran.title === undefined ? {} : { title: ran.title }),
            own: ran.own,
          }) as unknown as Json,
        }
      },
    })
  }
}
