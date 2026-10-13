import { SHOT_EDGE, type Shot, type ShotPoint } from "@do-computer/protocol"

/**
 * What a browser looks like now, for someone watching: a second DevTools socket of its own,
 * beside the one dev-browser drives the browser with. It follows the page that was most lately
 * gone to, has Chrome send that page as JPEG frames, and hears where the mouse is from a few
 * lines it puts in the page.
 */

/** The WebSocket this needs, which Node 22 and browsers both have. */
export interface PreviewSocket {
  readonly readyState: number
  send(data: string): void
  close(): void
  addEventListener(type: "open" | "close" | "error", listener: () => void): void
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void
}

export type PreviewTiming = {
  /** The least time between two frames: Chrome sends the next when the last is acknowledged. */
  frameIntervalMs: number
  /** How long it stays connected with nobody asking and no script running. */
  idleMs: number
  reconnectMs: number
  settleMs: number
}

export const PREVIEW_TIMING: PreviewTiming = {
  frameIntervalMs: 250,
  idleMs: 15_000,
  reconnectMs: 1_000,
  settleMs: 1_000,
}

export type PreviewOptions = {
  /** Counts everything shown. Shared, so that the count goes on when the browser changes. */
  seq: { n: number }
  /** Called for each press of the mouse while a script runs. */
  onClick?: () => void
  timing?: PreviewTiming
  openSocket?: (url: string) => PreviewSocket
}

export interface Preview {
  /** Connect, where it is not connected, and stay so for a while. */
  wake(): void
  /** Whether a script is running: only then is the mouse the agent's. */
  running(on: boolean): void
  /** Resolves when there is something newer than `after` to show, or when `waitMs` have passed. */
  next(after: number, waitMs: number): Promise<void>
  /** The newest frame, with the page it is of and where the agent's pointer is in it. */
  latest(): { shot?: Shot; url?: string; title?: string; pointer?: ShotPoint }
  /** The page in front, asked of the browser afresh: its title is often a moment behind. */
  front(): Promise<{ url: string; title: string } | undefined>
  /** The page it follows, as the browser names it. Undefined while it follows none. */
  target(): string | undefined
  /** Something else that is shown has changed. */
  bump(): void
  /** Nobody is using the browser: stop the frames and forget the last one. */
  rest(): void
  close(): void
}

/** The name the page calls to say where the mouse is. */
export const POINTER_BINDING = "__dcPointer"

/**
 * Run in each page: says where the mouse moved, was pressed and clicked, in the page's own
 * pixels. It listens first of all, so that a page which stops its clicks going further is still
 * heard. Moves are said no more often than every 40 ms.
 */
export const POINTER_SCRIPT = `(() => {
  if (window.__dcPointerOn || window !== window.top) return;
  window.__dcPointerOn = true;
  let last = 0;
  const say = (kind, e) => {
    try { window.${POINTER_BINDING}(kind + "," + Math.round(e.clientX) + "," + Math.round(e.clientY)); } catch {}
  };
  window.addEventListener("mousemove", (e) => {
    const now = Date.now();
    if (now - last < 40) return;
    last = now;
    say("m", e);
  }, true);
  window.addEventListener("mousedown", (e) => say("d", e), true);
  window.addEventListener("click", (e) => say("c", e), true);
})()`

/** What the page said through the binding: which of the three it was, and where. */
export function readPointer(
  payload: unknown,
): { kind: "m" | "d" | "c"; x: number; y: number } | null {
  if (typeof payload !== "string") return null
  const match = /^([mdc]),(-?\d+),(-?\d+)$/.exec(payload)
  if (!match) return null
  return { kind: match[1] as "m" | "d" | "c", x: Number(match[2]), y: Number(match[3]) }
}

const SOCKET_OPEN = 1
const MAX_FRAME_CHARS = 1_400_000
const BLANK = new Set(["", "about:blank"])

type Json = Record<string, unknown>
const obj = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Json) : {}

export function createPreview(connectionUrl: string, options: PreviewOptions): Preview {
  const timing = options.timing ?? PREVIEW_TIMING
  const openSocket =
    options.openSocket ?? ((url: string) => new WebSocket(url) as unknown as PreviewSocket)
  const seq = options.seq
  const targets = new Map<string, { url: string; title: string; activity: number }>()
  const calls = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  const waiters = new Set<() => void>()
  let socket: PreviewSocket | null = null
  let cast: { targetId: string; sessionId: string } | null = null
  let selection: Promise<void> = Promise.resolve()
  let shot: Shot | undefined
  let page: { url: string; title: string } | undefined
  let pointer: ShotPoint | undefined
  let nextCallId = 0
  let activityClock = 0
  let lastConnectAt = 0
  let nextAckAt = 0
  let idleTimer: NodeJS.Timeout | null = null
  let settleTimer: NodeJS.Timeout | null = null
  let running = false
  let closed = false

  function bump() {
    seq.n += 1
    for (const waiter of [...waiters]) waiter()
  }

  function send(
    connection: PreviewSocket,
    method: string,
    params: Json,
    sessionId?: string,
  ): Promise<unknown> {
    if (connection !== socket || connection.readyState !== SOCKET_OPEN) {
      return Promise.reject(new Error("The browser's live view is not connected."))
    }
    const id = ++nextCallId
    return new Promise((resolve, reject) => {
      calls.set(id, { resolve, reject })
      connection.send(
        JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }),
      )
    })
  }

  function disconnect() {
    const connection = socket
    socket = null
    cast = null
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = null
    targets.clear()
    for (const call of calls.values())
      call.reject(new Error("The browser's live view is not connected."))
    calls.clear()
    if (connection && connection.readyState <= SOCKET_OPEN) connection.close()
  }

  /** The page to show: one that has gone somewhere before a blank one, and then the latest to. */
  function bestTarget(): string | null {
    let best: { targetId: string; rank: number; activity: number } | null = null
    for (const [targetId, target] of targets) {
      const rank = BLANK.has(target.url) ? 0 : 1
      if (!best || rank > best.rank || (rank === best.rank && target.activity > best.activity)) {
        best = { targetId, rank, activity: target.activity }
      }
    }
    return best?.targetId ?? null
  }

  function select(connection: PreviewSocket) {
    selection = selection
      .then(async () => {
        if (connection !== socket) return
        const targetId = bestTarget()
        if (targetId === (cast?.targetId ?? null)) return
        const previous = cast
        cast = null
        if (previous) {
          await send(connection, "Page.stopScreencast", {}, previous.sessionId).catch(() => {})
          await send(connection, "Target.detachFromTarget", {
            sessionId: previous.sessionId,
          }).catch(() => {})
        }
        if (targetId === null) return
        const attached = obj(
          await send(connection, "Target.attachToTarget", { targetId, flatten: true }),
        )
        const sessionId = String(attached.sessionId)
        cast = { targetId, sessionId }
        const target = targets.get(targetId)
        if (target) page = { url: target.url, title: target.title }
        // The pointer first: a click made before the first frame is still a click to show.
        // Chrome runs a script in each new document only for a session that has Page switched on.
        await send(connection, "Page.enable", {}, sessionId)
        await send(connection, "Runtime.enable", {}, sessionId)
        await send(connection, "Runtime.addBinding", { name: POINTER_BINDING }, sessionId)
        await send(
          connection,
          "Page.addScriptToEvaluateOnNewDocument",
          { source: POINTER_SCRIPT },
          sessionId,
        )
        await send(connection, "Runtime.evaluate", { expression: POINTER_SCRIPT }, sessionId).catch(
          () => {},
        )
        await send(
          connection,
          "Page.startScreencast",
          {
            format: "jpeg",
            quality: 60,
            maxWidth: SHOT_EDGE,
            maxHeight: SHOT_EDGE,
            everyNthFrame: 1,
          },
          sessionId,
        )
      })
      .catch(() => {
        if (connection === socket) disconnect()
      })
  }

  function observe(connection: PreviewSocket, raw: unknown) {
    const info = obj(raw)
    if (info.type !== "page" || typeof info.targetId !== "string") return
    const url = typeof info.url === "string" ? info.url : ""
    const title = typeof info.title === "string" ? info.title : ""
    const known = targets.get(info.targetId)
    if (known && known.url === url && known.title === title) return
    targets.set(info.targetId, {
      url,
      title,
      activity: known && known.url === url ? known.activity : ++activityClock,
    })
    if (cast?.targetId === info.targetId) {
      page = { url, title }
      bump()
    }
    select(connection)
  }

  function receive(connection: PreviewSocket, raw: string) {
    const message = obj(JSON.parse(raw))
    if (typeof message.id === "number") {
      const call = calls.get(message.id)
      calls.delete(message.id)
      if (message.error) call?.reject(new Error(String(obj(message.error).message)))
      else call?.resolve(message.result)
      return
    }
    const params = obj(message.params)
    switch (message.method) {
      case "Target.targetCreated":
      case "Target.targetInfoChanged":
      case "Target.attachedToTarget":
        observe(connection, params.targetInfo)
        break
      case "Target.targetDestroyed":
        targets.delete(String(params.targetId))
        if (cast?.targetId === params.targetId) cast = null
        select(connection)
        break
      case "Target.detachedFromTarget":
        if (cast?.sessionId !== params.sessionId) return
        cast = null
        select(connection)
        break
      case "Runtime.bindingCalled": {
        // Between scripts the mouse in the owner's own Chrome is the owner's, and is not shown.
        if (!running || message.sessionId !== cast?.sessionId || params.name !== POINTER_BINDING)
          return
        const said = readPointer(params.payload)
        if (!said) return
        pointer = { x: said.x, y: said.y }
        if (said.kind === "d") options.onClick?.()
        bump()
        break
      }
      case "Page.screencastFrame": {
        const sessionId = message.sessionId
        if (typeof sessionId !== "string" || sessionId !== cast?.sessionId) return
        const metadata = obj(params.metadata)
        const width = Number(metadata.deviceWidth)
        const height = Number(metadata.deviceHeight)
        if (
          typeof params.data === "string" &&
          params.data.length <= MAX_FRAME_CHARS &&
          width > 0 &&
          height > 0
        ) {
          // The size is the page's own, in the pixels the mouse is said in, not the JPEG's.
          shot = { mimeType: "image/jpeg", data: params.data, width, height }
          bump()
        }
        const targetId = cast.targetId
        // Chrome does not always say that a page's address or title changed: ask, now and once
        // more when the page has had a moment.
        const refresh = () =>
          void send(connection, "Target.getTargetInfo", { targetId })
            .then((result) => {
              if (connection === socket) observe(connection, obj(result).targetInfo)
            })
            .catch(() => {})
        refresh()
        if (settleTimer) clearTimeout(settleTimer)
        settleTimer = setTimeout(refresh, timing.settleMs)
        settleTimer.unref()
        const ackAt = Math.max(Date.now(), nextAckAt) + timing.frameIntervalMs
        nextAckAt = ackAt
        const ack = setTimeout(() => {
          void send(
            connection,
            "Page.screencastFrameAck",
            { sessionId: params.sessionId },
            sessionId,
          ).catch(() => {})
        }, ackAt - Date.now())
        ack.unref()
        break
      }
      default:
        break
    }
  }

  function connect() {
    if (closed || socket || Date.now() - lastConnectAt < timing.reconnectMs) return
    lastConnectAt = Date.now()
    let connection: PreviewSocket
    try {
      connection = openSocket(connectionUrl)
    } catch {
      return
    }
    socket = connection
    connection.addEventListener("open", () => {
      send(connection, "Target.setDiscoverTargets", { discover: true }).catch(() => {
        if (connection === socket) disconnect()
      })
    })
    connection.addEventListener("message", (event) => {
      if (connection !== socket || typeof event.data !== "string") return
      try {
        receive(connection, event.data)
      } catch {
        disconnect()
      }
    })
    const drop = () => {
      if (connection === socket) disconnect()
    }
    connection.addEventListener("close", drop)
    connection.addEventListener("error", drop)
  }

  function wake() {
    if (closed) return
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (waiters.size > 0 || running) wake()
      else disconnect()
    }, timing.idleMs)
    idleTimer.unref()
    connect()
  }

  return {
    wake,
    running(on) {
      running = on
      if (on) wake()
    },
    next(after, waitMs) {
      if (closed) return Promise.resolve()
      wake()
      // A count ahead of ours is one from before this daemon started: anything is newer.
      const ready = () => seq.n > after || after > seq.n
      if (ready() && shot) return Promise.resolve()
      return new Promise((resolve) => {
        const settle = () => {
          waiters.delete(check)
          clearTimeout(timeout)
          clearInterval(reconnect)
          resolve()
        }
        const check = () => {
          if (closed || (ready() && shot)) settle()
        }
        const timeout = setTimeout(settle, waitMs)
        const reconnect = setInterval(connect, timing.reconnectMs)
        timeout.unref()
        reconnect.unref()
        waiters.add(check)
      })
    },
    latest: () => ({
      ...(shot ? { shot } : {}),
      ...(page ? { url: page.url.slice(0, 2_000), title: page.title.slice(0, 300) } : {}),
      ...(pointer ? { pointer } : {}),
    }),
    async front() {
      await selection
      const connection = socket
      const targetId = cast?.targetId
      if (!connection || targetId === undefined) return page
      const asked = send(connection, "Target.getTargetInfo", { targetId }).catch(() => undefined)
      const result = await Promise.race([
        asked,
        new Promise<undefined>((resolve) => {
          const timer: NodeJS.Timeout = setTimeout(() => resolve(undefined), 1_000)
          timer.unref()
        }),
      ])
      if (result !== undefined && connection === socket) observe(connection, obj(result).targetInfo)
      return page
    },
    target: () => cast?.targetId,
    bump,
    rest() {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = null
      disconnect()
      shot = undefined
      pointer = undefined
    },
    close() {
      if (closed) return
      closed = true
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = null
      disconnect()
      for (const waiter of [...waiters]) waiter()
    },
  }
}
