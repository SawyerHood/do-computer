import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChatState, ChatSummary, ToolPart } from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { justBashSandbox, type Sandbox } from "@do-computer/sandbox"
import { createLocalProcessSandbox } from "@do-computer/sandbox/testing"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import type { JsonObject } from "@earendil-works/pi-durable"
import { afterEach, describe, expect, it } from "vitest"
import {
  capText,
  type Cut,
  cutFromRead,
  cutToFile,
  HEAD_CHARS,
  OUTPUT_CAP_CHARS,
  OutputCap,
  TAIL_CHARS,
} from "../src/output-cap.ts"
import { createAgentActor } from "../src/index.ts"
import { quietOnReminder, sent } from "./quiet.ts"

/** `count` numbered lines: "1\n2\n...". */
const lines = (count: number, from = 1) =>
  Array.from({ length: count }, (_, at) => String(from + at)).join("\n") + "\n"

describe("cutting a long output to its start and end", () => {
  const seen: Cut[] = []
  const marker = (cut: Cut) => {
    seen.push(cut)
    return "[CUT]"
  }

  it("leaves output under the cap as it is", () => {
    const text = "x".repeat(OUTPUT_CAP_CHARS)
    expect(capText(text, marker)).toBe(text)
    const stream = new OutputCap()
    stream.push(text)
    expect(stream.over).toBe(false)
    expect(stream.capped(marker)).toBeUndefined()
  })

  it("keeps the first and last lines whole, and says which lines were cut", () => {
    const text = lines(20_000)
    seen.length = 0
    const capped = capText(text, marker)
    expect(capped.length).toBeLessThanOrEqual(HEAD_CHARS + TAIL_CHARS + 10)
    expect(capped.startsWith("1\n2\n3\n")).toBe(true)
    expect(capped.endsWith("19999\n20000\n")).toBe(true)
    const [cut] = seen
    const [head, tail] = capped.split("[CUT]\n") as [string, string]
    // Each side is whole lines, and between them exactly the lines the cut names are missing.
    expect(head.endsWith("\n")).toBe(true)
    const headLines = head.split("\n").filter(Boolean)
    const tailLines = tail.split("\n").filter(Boolean)
    expect(cut!.fromLine).toBe(Number(headLines.at(-1)) + 1)
    expect(cut!.toLine).toBe(Number(tailLines[0]) - 1)
    expect(cut!.lines).toBe(cut!.toLine - cut!.fromLine + 1)
    expect(cut!.chars).toBe(text.length - head.length - tail.length)
    expect(cut!.totalChars).toBe(text.length)
  })

  it("comes to the same, given the output a chunk at a time", () => {
    const text = lines(30_000)
    const stream = new OutputCap()
    for (let at = 0; at < text.length; at += 777) stream.push(text.slice(at, at + 777))
    expect(stream.chars).toBe(text.length)
    expect(stream.capped(marker)).toBe(capText(text, marker))
  })

  it("cuts one long line where it has to", () => {
    const text = "y".repeat(50_000)
    const capped = capText(text, () => "[CUT]")
    expect(capped).toBe(`${"y".repeat(HEAD_CHARS)}\n[CUT]\n${"y".repeat(TAIL_CHARS)}`)
  })

  it("counts what the computer left out, and starts the end after it", () => {
    const stream = new OutputCap()
    stream.push(lines(2_000))
    stream.skip(100_000, 9_000)
    stream.push(lines(2_000, 11_001))
    const capped = stream.capped(() => "[CUT]")!
    expect(capped.endsWith("13000\n")).toBe(true)
    expect(stream.chars).toBeGreaterThan(100_000)
  })

  it("says where all of it is, and how a read goes on", () => {
    const cut: Cut = {
      chars: 50_000,
      lines: 1_200,
      fromLine: 301,
      toLine: 1_500,
      totalChars: 61_000,
      totalLines: 2_000,
    }
    expect(cutToFile("/home/me/out.log", "box")(cut)).toContain(
      'All of it is in /home/me/out.log on "box"',
    )
    expect(cutToFile("/home/me/out.log", "box")(cut)).toContain("50,000 characters (1,200 lines)")
    // Lines are numbered in the file: a read from line 101 had its line 301 at 401.
    expect(cutFromRead("big.txt", 101)(cut)).toContain("lines 401-1,600")
    expect(cutFromRead("big.txt", 101)(cut)).toContain("offset=401")
  })
})

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof quietOnReminder<ReturnType<typeof fauxProvider>>>
  errors: unknown[]
  machine: Sandbox
}

const worlds: World[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

function open(options: { shell?: "light" } = {}): World {
  const directory = mkdtempSync(join(tmpdir(), "dc-cap-"))
  const faux = quietOnReminder(
    fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 50_000 }),
  )
  const models = createModels()
  models.setProvider(faux.provider)
  const errors: unknown[] = []
  const machine = createLocalProcessSandbox()
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        sandbox: (actor) =>
          options.shell === "light"
            ? justBashSandbox({ id: actor.name, database: actor.sql })
            : machine,
        keepAliveMs: 150,
        foregroundMs: 3_000,
        onReport: (error) => errors.push(error),
      }),
    onError: (error) => errors.push(error),
  })
  namespace.start()
  const world = { namespace, faux, errors, machine }
  worlds.push(world)
  return world
}

async function call<T>(world: World, path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await world.namespace.get("agent-1").fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 20_000,
): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`Timed out; last value: ${JSON.stringify(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats/main", "POST", {})
}

const tools = (state: ChatState) =>
  state.messages.flatMap((message) =>
    message.parts.filter((part): part is ToolPart => part.type === "tool"),
  )

/** Have the scripted model call one tool, and resolve with the call once the chat is at rest. */
async function ran(world: World, chatId: string, name: string, args: JsonObject) {
  const before = tools(await call<ChatState>(world, `/chats/${chatId}`)).length
  world.faux.setResponses([
    fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
    sent("Done."),
  ])
  await call(world, `/chats/${chatId}/messages`, "POST", {
    text: `use ${name}`,
    requestId: crypto.randomUUID(),
  })
  const state = await until(
    () => call<ChatState>(world, `/chats/${chatId}`),
    (next) => !next.busy && tools(next).length > before,
  )
  // What the model was sent of it is what it is shown the next time.
  return tools(state)[before]!
}

const textOf = (part: ToolPart) => part.output ?? ""

describe("what the agent is sent of a long output, on a machine with real programs", () => {
  it("cuts bash to its start and end, and keeps all of it in the command's log", async () => {
    const world = open()
    const chat = await setup(world)
    const part = await ran(world, chat.id, "bash", { command: "seq 1 30000" })
    expect(part.status).toBe("done")
    const output = textOf(part)
    expect(output.length).toBeLessThan(OUTPUT_CAP_CHARS + 1_000)
    expect(output.startsWith("1\n2\n")).toBe(true)
    expect(output).toContain("29999\n30000")
    const log = /All of it is in (\S+) on "[^"]+"/.exec(output)?.[1]
    expect(log).toBeDefined()
    // Said once: the harness cut nothing more, and no second note names the file.
    expect(output).not.toContain("Output truncated")
    expect(output).not.toContain("Full output:")
    expect((await world.machine.exec(`wc -l < ${log}`)).output.trim()).toBe("30000")
    expect(world.errors).toEqual([])
  }, 40_000)

  it("sends a short output whole", async () => {
    const world = open()
    const chat = await setup(world)
    const part = await ran(world, chat.id, "bash", { command: "seq 1 2000" })
    expect(textOf(part)).toContain(lines(2_000).trim())
    expect(textOf(part)).not.toContain("were cut here")
  }, 40_000)

  it("cuts a failed command's output the same way", async () => {
    const world = open()
    const chat = await setup(world)
    const part = await ran(world, chat.id, "bash", { command: "seq 1 30000; exit 4" })
    expect(part.status).toBe("error")
    expect(textOf(part)).toContain("were cut here")
    expect(textOf(part)).toContain("exited with code 4")
  }, 40_000)

  it("cuts what a background command printed since the agent last looked", async () => {
    const world = open()
    const chat = await setup(world)
    const started = await ran(world, chat.id, "bash", {
      command: "seq 1 20000; sleep 3; seq 20001 40000; sleep 30",
      run_in_background: true,
    })
    // What it printed by the time it was left to run is cut the same way.
    expect(textOf(started)).toContain("Started in the background as b1")
    expect(textOf(started).length).toBeLessThan(OUTPUT_CAP_CHARS + 1_000)
    const looked = await ran(world, chat.id, "background", {
      action: "output",
      id: "b1",
      wait_seconds: 5,
    })
    const output = textOf(looked)
    expect(output).toContain("were cut here")
    expect(output).toMatch(/All of it is in \S+ on "[^"]+"/)
    expect(output).toContain("40000")
    expect(output).toContain("b1 is still running")
    expect(output.length).toBeLessThan(OUTPUT_CAP_CHARS + 1_000)
    await ran(world, chat.id, "background", { action: "stop", id: "b1" })
  }, 40_000)

  it("cuts a long read to its start and end, naming the lines to read next", async () => {
    const world = open()
    const chat = await setup(world)
    const file = `cap-${Date.now()}.txt`
    await world.machine.exec(`seq -f "line %g of a longer file" 1 5000 > ${file}`)
    const part = await ran(world, chat.id, "read", { path: file, offset: 101 })
    const output = textOf(part)
    expect(output.startsWith("line 101 of a longer file\n")).toBe(true)
    const named = /\[… lines ([\d,]+)-([\d,]+) \(.*offset=(\d+)/.exec(output)!
    const from = Number(named[1]!.replace(/,/g, ""))
    const to = Number(named[2]!.replace(/,/g, ""))
    expect(Number(named[3])).toBe(from)
    // The lines on either side of the cut are the ones just outside what it names.
    expect(output).toContain(`line ${from - 1} of a longer file\n[… lines`)
    expect(output).toContain(
      `were cut here, to keep this short. Read them with offset=${from} and a limit, or search ${file} for what you need.]\nline ${to + 1} of a longer file\n`,
    )
  }, 40_000)
})

describe("what the agent is sent of a long output, on a lightweight shell", () => {
  it("writes all of it to a file there and names the file", async () => {
    const world = open({ shell: "light" })
    const chat = await setup(world)
    // More than the cap, less than what pi-durable's own bash spills to a file by itself.
    const part = await ran(world, chat.id, "bash", { command: "seq 1 6000" })
    const output = textOf(part)
    expect(output).toContain("were cut here")
    const file = /All of it is in (\S+) on "[^"]+"/.exec(output)?.[1]
    expect(file).toBeDefined()
    const counted = await ran(world, chat.id, "bash", { command: `wc -l < ${file}` })
    expect(textOf(counted).trim()).toBe("6000")
    expect(world.errors).toEqual([])
  }, 40_000)
})
