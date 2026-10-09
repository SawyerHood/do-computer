/**
 * The computer's screen, as the daemon reaches it. The daemon is a plain Node program and has no
 * way to a screen of its own: the Do Computer app does, and a daemon the app runs asks it.
 * A daemon run by hand has no screen for agents.
 */
import type { ScreenIO } from "@durable-computer/computers/daemon"
import { UseRefused } from "@durable-computer/computers/use"
import type { LiveView, ScreenActed } from "@durable-computer/protocol"
import { type AppAnswer, type AppCall, formatCall, parseAnswer } from "./events.ts"

/**
 * The screen as the app that runs this daemon has it. Each thing asked is one line printed for
 * the app, which answers with one line on the daemon's input.
 */
export function appScreen(
  print: (line: string) => void,
  input: NodeJS.ReadableStream,
): ScreenIO {
  const waiting = new Map<string, (answer: AppAnswer) => void>()
  let counter = 0
  let rest = ""
  input.setEncoding("utf8")
  input.on("data", (chunk: string) => {
    const lines = (rest + chunk).split(/\r?\n/)
    rest = lines.pop() ?? ""
    for (const line of lines) {
      const answer = parseAnswer(line)
      if (answer === undefined) continue
      waiting.get(answer.id)?.(answer)
      waiting.delete(answer.id)
    }
  })
  const ask = <T>(call: Omit<AppCall, "id">): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = `c${++counter}`
      waiting.set(id, (answer) => {
        if (answer.error === undefined) return resolve(answer.value as T)
        reject(
          answer.error.refused
            ? new UseRefused(answer.error.message)
            : new Error(answer.error.message),
        )
      })
      print(formatCall({ id, ...call }))
    })
  return {
    act: (agent, action, say) =>
      ask<ScreenActed>({ op: "act", agent, action, ...(say === undefined ? {} : { say }) }),
    view: (after, waitMs) => ask<LiveView>({ op: "view", after, waitMs }),
    hold: (held) => ask<void>({ op: "hold", held }),
  }
}
