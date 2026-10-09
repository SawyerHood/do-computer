import { PassThrough } from "node:stream"
import { UseRefused } from "@durable-computer/computers/use"
import { describe, expect, it } from "vitest"
import { type AppCall, parseCall } from "../src/events.ts"
import { appScreen } from "../src/screen.ts"

const pip = { id: "agent-1", name: "Pip", color: "#5f8a4e" }

/** A daemon's screen, with what it printed for the app and a way to answer as the app. */
function relay() {
  const printed: string[] = []
  const input = new PassThrough()
  const screen = appScreen((line) => void printed.push(line), input)
  const asked = (): AppCall => parseCall(printed.at(-1)!)!
  return { screen, printed, input, asked }
}

describe("a daemon the app runs, asked for the screen", () => {
  it("asks the app in one line, and resolves with the app's answer", async () => {
    const { screen, printed, input, asked } = relay()
    const acting = screen.act(pip, { do: "click", x: 10, y: 20 }, "Clicking")
    expect(printed).toHaveLength(1)
    expect(printed[0]).toMatch(/^@dc-call \{/)
    expect(asked()).toMatchObject({
      op: "act",
      agent: pip,
      action: { do: "click", x: 10, y: 20 },
      say: "Clicking",
    })
    const shot = { mimeType: "image/jpeg", data: "AAAA", width: 4, height: 2 }
    // Answers arrive however the pipe cuts them up, and among lines that are not answers.
    const answer = JSON.stringify({ id: asked().id, value: { shot, pointer: { x: 10, y: 20 } } })
    input.write(`not an answer\n${answer.slice(0, 20)}`)
    input.write(`${answer.slice(20)}\n`)
    expect(await acting).toEqual({ shot, pointer: { x: 10, y: 20 } })
  })

  it("matches each answer to what was asked, in whatever order they come", async () => {
    const { screen, printed, input } = relay()
    const view = screen.view(3, 500)
    const hold = screen.hold(true)
    const [first, second] = printed.map((line) => parseCall(line)!)
    expect(first).toMatchObject({ op: "view", after: 3, waitMs: 500 })
    expect(second).toMatchObject({ op: "hold", held: true })
    input.write(`${JSON.stringify({ id: second!.id })}\n`)
    input.write(`${JSON.stringify({ id: first!.id, value: { active: false, seq: 3 } })}\n`)
    expect(await hold).toBeUndefined()
    expect(await view).toEqual({ active: false, seq: 3 })
  })

  it("passes on a refusal as one, and anything else as a failure", async () => {
    const { screen, input, asked } = relay()
    const refused = screen.act(pip, { do: "screenshot" }, undefined)
    input.write(
      `${JSON.stringify({ id: asked().id, error: { refused: true, message: "Stopped by its owner." } })}\n`,
    )
    await expect(refused).rejects.toBeInstanceOf(UseRefused)

    const broken = screen.act(pip, { do: "screenshot" }, undefined)
    input.write(
      `${JSON.stringify({ id: asked().id, error: { refused: false, message: "The driver crashed." } })}\n`,
    )
    const error = await broken.catch((caught: unknown) => caught)
    expect(error).not.toBeInstanceOf(UseRefused)
    expect((error as Error).message).toBe("The driver crashed.")
  })
})
