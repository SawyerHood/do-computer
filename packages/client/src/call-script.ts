import type { CallScriptStep } from "@do-computer/protocol"
import type { Heard } from "./call-events.ts"
import type { VoiceLine } from "./call.ts"

/**
 * A call with no voice: the script the server handed over is played as if a voice were saying
 * it. Only a test asks for one. It goes at reading speed, so that what a call shows can be seen.
 */
export function playCallScript(
  script: readonly CallScriptStep[],
  onEvent: (event: Heard) => void,
): VoiceLine {
  let closed = false
  let answered: ((said: string) => void) | undefined
  const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))
  const words = async (who: "you" | "dood", said: string) => {
    for (const word of said.split(" ")) {
      if (closed) return
      onEvent({ type: "words", who, text: ` ${word}` })
      await wait(40)
    }
  }
  // As a real call does, it says that somebody has finished a moment after their last word.
  const finished = async (who: "you" | "dood", said: string) => {
    await wait(150)
    if (!closed) onEvent({ type: "line", who, text: said })
  }
  void (async () => {
    await wait(50)
    if (closed) return
    onEvent({ type: "started" })
    let n = 0
    const handOn = (ask?: string) =>
      new Promise<string>((done) => {
        answered = done
        onEvent({ type: "handOn", id: `scripted-${++n}`, ...(ask === undefined ? {} : { ask }) })
      })
    for (let i = 0; i < script.length; i++) {
      const step = script[i]!
      if (closed) return
      await wait(120)
      if ("say" in step) {
        await words("dood", step.say)
        await finished("dood", step.say)
        continue
      }
      const next = script[i + 1]
      let answer: Promise<string>
      if ("hear" in step) {
        await words("you", step.hear)
        if (next === undefined || !("handOn" in next)) {
          await finished("you", step.hear)
          continue
        }
        // What was heard is handed on before the person is said to have finished, with the
        // request in words.
        answer = handOn(step.hear)
        await finished("you", step.hear)
        i++
      } else answer = handOn()
      const said = await answer
      answered = undefined
      await words("dood", said)
      await finished("dood", said)
    }
  })()
  return {
    send(events) {
      for (const event of events) {
        const sent = JSON.parse(event) as {
          type?: string
          channel?: string
          content?: { text?: string }[]
        }
        if (sent.type === "delegation.context.append" && sent.channel === "speakable") {
          answered?.(sent.content?.[0]?.text ?? "")
        }
      }
    },
    setMuted() {},
    levels: () => ({ you: 0, dood: 0 }),
    close() {
      closed = true
    },
  }
}
