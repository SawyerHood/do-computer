/** Bounded, versioned screen IPC with the desktop app. Environment flags alone are not proof of a parent. */
import type { ScreenIO } from "@do-computer/computers/daemon"
import { UseRefused } from "@do-computer/computers/use"
import { USE_HELD_WAIT_MS, type LiveView, type ScreenActed } from "@do-computer/protocol"
import { type AppAnswer, type AppCall, formatCall, parseAnswer } from "./events.ts"

// A replacement adapter must not accept a late answer intended for its predecessor.
let counter = 0

export function appScreen(
  print: (line: string) => void,
  input: NodeJS.ReadableStream,
  options: { timeoutMs?: number; probeTimeoutMs?: number } = {},
): ScreenIO & {
  probe(): Promise<void>
  inspect(
    verifyLegacyView?: boolean,
  ): Promise<{ available: boolean; enabled: boolean; reason?: string }>
  dispose(): void
} {
  const waiting = new Map<string, { answer(answer: AppAnswer): void; fail(error: Error): void }>()
  let rest = ""
  let closed: Error | undefined
  const wasFlowing = (input as { readableFlowing?: boolean | null }).readableFlowing
  input.setEncoding("utf8")
  const fail = (error: Error) => {
    closed = error
    rest = ""
    for (const entry of waiting.values()) entry.fail(error)
    waiting.clear()
  }
  const data = (chunk: string) => {
    if (closed) return
    const text = rest + chunk
    if (text.length > 2 * 1024 * 1024)
      return fail(new Error("Screen IPC message exceeded its limit"))
    const lines = text.split(/\r?\n/)
    rest = lines.pop() ?? ""
    for (const line of lines) {
      const answer = parseAnswer(line)
      if (answer) waiting.get(answer.id)?.answer(answer)
    }
  }
  const end = () => fail(new Error("The desktop app closed its screen transport"))
  const error = (caught: Error) => fail(caught)
  input.on("data", data)
  input.on("end", end)
  input.on("close", end)
  input.on("error", error)
  input.resume()
  if (
    (input as { readableEnded?: boolean; destroyed?: boolean }).readableEnded ||
    (input as { destroyed?: boolean }).destroyed
  )
    end()
  const ask = <T>(
    call: Omit<AppCall, "id">,
    timeoutMs = options.timeoutMs ?? USE_HELD_WAIT_MS + 40_000,
  ): Promise<T> => {
    if (closed) return Promise.reject(closed)
    if (waiting.size >= 64) return Promise.reject(new Error("Too many pending screen requests"))
    return new Promise<T>((resolve, reject) => {
      const id = `c${++counter}`
      const finish = () => {
        clearTimeout(timer)
        waiting.delete(id)
      }
      const timer = setTimeout(() => {
        finish()
        reject(new Error("The desktop app did not answer its screen request in time"))
      }, timeoutMs)
      waiting.set(id, {
        fail(error) {
          finish()
          reject(error)
        },
        answer(answer) {
          finish()
          if (answer.error)
            reject(
              answer.error.refused
                ? new UseRefused(answer.error.message)
                : new Error(answer.error.message),
            )
          else resolve(answer.value as T)
        },
      })
      try {
        print(formatCall({ id, ...call }))
      } catch (error) {
        finish()
        reject(error)
      }
    })
  }
  const inspect = async (verifyLegacyView = true) => {
    try {
      const hello = await ask<{
        protocolVersion: number
        screen: boolean
        available?: boolean
        reason?: string
      }>({ op: "hello", protocolVersion: 1 }, options.probeTimeoutMs ?? 5000)
      if (
        typeof hello?.screen !== "boolean" ||
        (hello.available !== undefined && typeof hello.available !== "boolean") ||
        (hello.reason !== undefined && typeof hello.reason !== "string")
      )
        throw new Error("The desktop app returned an invalid screen IPC handshake")
      if (hello?.protocolVersion !== 1)
        throw new Error("The desktop app uses an unsupported screen IPC version")
      return {
        available: hello.available !== false,
        enabled: hello.screen === true,
        reason:
          hello.reason ??
          (hello.screen !== true ? "Screen sharing is disabled in the desktop app" : undefined),
      }
    } catch (error) {
      // Old apps already implement view. Verify that transport without requiring an app upgrade.
      if (!(error instanceof Error) || !/screen has no .*hello/.test(error.message)) throw error
      if (verifyLegacyView)
        await ask<LiveView>({ op: "view", waitMs: 0 }, options.probeTimeoutMs ?? 5000)
      return { available: true, enabled: true, reason: undefined }
    }
  }
  return {
    inspect,
    async probe() {
      const status = await inspect()
      if (!status.available || !status.enabled)
        throw new UseRefused(status.reason ?? "Screen adapter unavailable")
    },
    act: (agent, action, say) =>
      ask<ScreenActed>({ op: "act", agent, action, ...(say === undefined ? {} : { say }) }),
    view: (after, waitMs) =>
      ask<LiveView>(
        { op: "view", after, waitMs },
        options.timeoutMs ?? Math.min(Math.max(0, waitMs), 5000) + 10_000,
      ),
    hold: (held) => ask<void>({ op: "hold", held }, options.timeoutMs ?? 10_000),
    dispose() {
      fail(new Error("Screen IPC disposed"))
      input.off("data", data)
      input.off("end", end)
      input.off("close", end)
      input.off("error", error)
      if (wasFlowing !== true && input.listenerCount("data") === 0) input.pause()
    },
  }
}
