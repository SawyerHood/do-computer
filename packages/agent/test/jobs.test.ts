import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  AgentActivity,
  AgentSummary,
  ChatState,
  ChatSummary,
  JobSummary,
  NoticePart,
  ToolPart,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { justBashSandbox, type Sandbox } from "@do-computer/sandbox"
import { createLocalProcessSandbox } from "@do-computer/sandbox/testing"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { type AgentNotification, createAgentActor } from "../src/index.ts"
import { quietOnReminder, sent } from "./quiet.ts"
import { newest } from "./newest.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: AgentNotification[]
  errors: unknown[]
  /** Everything `onActivity` was told, in the order it was told. */
  activity: Told[]
  machine: Sandbox
}
type Told = { agentId: string } & AgentActivity
const worlds: World[] = []

function open(directory: string, options: { shell?: "light"; foregroundMs?: number } = {}): World {
  const faux = quietOnReminder(
    fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 }),
  )
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: AgentNotification[] = []
  const errors: unknown[] = []
  const activity: Told[] = []
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
        // Short, so that a command left running is looked at soon after it ends.
        keepAliveMs: 150,
        foregroundMs: options.foregroundMs ?? 400,
        onNotify: (notification) => reports.push(notification),
        onReport: (error) => errors.push(error),
        onActivity: (change) => activity.push(change),
      }),
    onError: (error) => errors.push(error),
  })
  namespace.start()
  const world = { namespace, faux, reports, errors, activity, machine }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

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
  ms = 10_000,
): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`Timed out; last value: ${JSON.stringify(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

const chatState = (world: World, chatId: string) => call<ChatState>(world, `/chats/${chatId}`)
const jobs = async (world: World) => (await call<{ jobs: JobSummary[] }>(world, "/jobs")).jobs

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats/main", "POST", {})
}

const send = (world: World, chatId: string, text: string) =>
  call(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })

const temporary = () => mkdtempSync(join(tmpdir(), "dc-jobs-"))
const notices = (state: ChatState) =>
  state.messages.flatMap((message) =>
    message.parts.filter(
      (part): part is NoticePart => part.type === "notice" && part.kind === "command",
    ),
  )
const said = (state: ChatState) =>
  state.messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    )
const tools = (state: ChatState) =>
  state.messages.flatMap((message) =>
    message.parts.filter((part): part is ToolPart => part.type === "tool"),
  )

type Turn = { seen: string; last: string }

/** Each answer is chosen from what the model was shown, not from a queue. */
function script(world: World, answer: (turn: Turn) => AssistantMessage) {
  const seen: Turn[] = []
  world.faux.setResponses(
    Array.from({ length: 40 }, () => (context: { messages: unknown[] }) => {
      const turn: Turn = {
        seen: JSON.stringify(context.messages),
        // What it was last told, past what changed of its prompt since.
        last: JSON.stringify(newest(context.messages)),
      }
      seen.push(turn)
      return answer(turn)
    }),
  )
  return seen
}

const use = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" })
const afterTool = (turn: Turn) => turn.last.includes('"toolResult"')
/** What the main chat is told of a command that ended: an event. */
const NUDGED = '<event kind=\\"command-ended\\"'
/** And a sub-agent, which is not told it as an event. */
const NUDGED_SUB = "A command you left running in the background has ended"

describe("background commands", () => {
  it("moves a slow command to the background, and gives the agent a turn when it ends", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    const turns = script(world, (turn) => {
      if (afterTool(turn)) return sent("It is still building.")
      if (turn.last.includes(NUDGED)) return sent("The build is done.")
      return use("bash", { command: "echo begun; sleep 1.5; echo built" })
    })

    await send(world, chat.id, "build it")
    const left = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).includes("It is still building."),
    )
    // The call came back with what was printed so far, and the command went on.
    const [step] = tools(left)
    expect(step).toMatchObject({ name: "bash", status: "done", details: { job: "b1" } })
    expect(step!.output).toContain("begun\n")
    expect(step!.output).toContain("moved to the background as b1")
    expect(step!.output).not.toContain("built")
    expect(await jobs(world)).toMatchObject([
      {
        id: "b1",
        chatId: chat.id,
        command: "echo begun; sleep 1.5; echo built",
        status: "running",
      },
    ])
    // Its turn is over while the command runs on, as the hook was told. The turn it is given
    // when the command ends is set going by no request, and the hook is told of that too.
    await until(
      async () => world.activity.at(-1),
      (told) => told?.latest?.kind === "reply" && !told.working,
    )
    const rested = world.activity.length
    await until(
      async () => world.activity.slice(rested),
      (since) => since.some((told) => told.working),
    )

    const ended = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).includes("The build is done."),
    )
    expect(said(ended)).toEqual(["It is still building.", "The build is done."])
    expect(notices(ended)).toMatchObject([
      {
        kind: "command",
        text: "echo begun; sleep 1.5; echo built",
        detail: "begun\nbuilt",
        job: { id: "b1", status: "done", exitCode: 0 },
      },
    ])
    const told = turns.find((turn) => turn.last.includes(NUDGED))!
    expect(told.seen).toContain("Your background command b1")
    expect(told.seen).toContain("finished with exit code 0")
    expect(await jobs(world)).toMatchObject([{ id: "b1", status: "done", exitCode: 0 }])
    // What it said about the command is announced like any answer nobody was there to read.
    expect(world.reports.map((notification) => notification.text)).toContain("The build is done.")
    expect(
      await until(
        async () => world.activity.at(-1),
        (told) => told?.latest?.text === "The build is done.",
      ),
    ).toMatchObject({ working: false, asking: false })
    expect(world.errors).toEqual([])
  })

  it("starts a command in the background when asked, shows what it printed, and stops it", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    script(world, (turn) => {
      if (turn.last.includes("look at it")) {
        return afterTool(turn) ? sent("Looked.") : use("background", { action: "output", id: "b1" })
      }
      if (turn.last.includes("stop it")) {
        return afterTool(turn) ? sent("Stopped.") : use("background", { action: "stop", id: "b1" })
      }
      if (afterTool(turn)) {
        return sent(
          turn.last.includes("Stopped b1")
            ? "Stopped."
            : turn.last.includes("is still running")
              ? "Looked."
              : "Started.",
        )
      }
      return use("bash", {
        command: "echo serving; sleep 2; echo a request; sleep 300",
        run_in_background: true,
      })
    })

    await send(world, chat.id, "serve it")
    const started = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).includes("Started."),
    )
    expect(tools(started)[0]!.output).toContain("Started in the background as b1")
    expect((await jobs(world))[0]).toMatchObject({ id: "b1", status: "running" })
    // Its turn is over: a command it left running is not the agent at work.
    const { agent } = await until(
      () => call<{ agent: AgentSummary }>(world, "/"),
      (state) => state.agent.working === false && state.agent.latest?.kind === "reply",
    )
    expect(agent.latest).toMatchObject({ text: "Started." })

    await new Promise((resolve) => setTimeout(resolve, 1_500))
    await send(world, chat.id, "look at it")
    const looked = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).includes("Looked."),
    )
    const output = tools(looked).find((part) => part.name === "background")!
    expect(output.output).toContain("a request\n")
    expect(output.output).toContain("b1 is still running")
    // A person reading along sees all of it, whatever the agent has seen.
    expect((await call<{ output: string }>(world, "/jobs/b1/output")).output).toBe(
      "serving\na request\n",
    )

    await send(world, chat.id, "stop it")
    const stopped = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).includes("Stopped."),
    )
    expect((await jobs(world))[0]).toMatchObject({ id: "b1", status: "stopped" })
    // The agent stopped it, so it is not told that it stopped.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(notices(await chatState(world, chat.id))).toEqual([])
    expect(said(stopped).at(-1)).toBe("Stopped.")
    expect(world.errors).toEqual([])
  })

  it("tells the agent of a command that failed, and of one a person stopped without a turn", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    const turns = script(world, (turn) => {
      if (turn.last.includes(NUDGED)) return sent("It failed.")
      if (afterTool(turn)) return sent("Started.")
      return use("bash", {
        command: turn.last.includes("serve") ? "sleep 300" : "sleep 2.5; echo no good >&2; exit 7",
        run_in_background: true,
      })
    })

    await send(world, chat.id, "test it")
    const failed = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).includes("It failed."),
    )
    expect(notices(failed)).toMatchObject([
      { kind: "command", detail: "no good", job: { id: "b1", status: "failed", exitCode: 7 } },
    ])
    expect(turns.find((turn) => turn.last.includes(NUDGED))!.seen).toContain(
      "ended with exit code 7",
    )

    await send(world, chat.id, "serve it")
    await until(
      () => jobs(world),
      (all) => all.some((job) => job.id === "b2" && job.status === "running"),
    )
    await until(
      () => chatState(world, chat.id),
      (state) => !state.busy,
    )
    const before = turns.length
    await call(world, "/jobs/b2/stop", "POST")
    const after = await until(
      () => chatState(world, chat.id),
      (state) => notices(state).length === 2,
    )
    expect(notices(after)[1]).toMatchObject({ job: { id: "b2", status: "stopped" } })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(turns.length).toBe(before)
    expect((await jobs(world)).map((job) => job.status)).toEqual(["failed", "stopped"])
    expect(world.errors).toEqual([])
  })

  it("answers for a quick command as it always did, and stops one at its timeout", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    script(world, (turn) => {
      if (afterTool(turn)) return sent("Done.")
      return turn.last.includes("wait")
        ? use("bash", { command: "echo waiting; sleep 30", timeout: 1 })
        : use("bash", { command: "echo out; echo err >&2; exit 3" })
    })

    await send(world, chat.id, "run it")
    const ran = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).length === 1,
    )
    expect(tools(ran)[0]).toMatchObject({ name: "bash", status: "error" })
    expect(tools(ran)[0]!.output).toContain("out\nerr\n")
    expect(tools(ran)[0]!.output).toContain("Command exited with code 3")

    await send(world, chat.id, "wait for it")
    const waited = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).length === 2,
    )
    expect(tools(waited)[1]).toMatchObject({ name: "bash", status: "error" })
    expect(tools(waited)[1]!.output).toContain("waiting\n")
    expect(tools(waited)[1]!.output).toContain("Command timed out after 1 seconds")
    // Neither was left running, and neither left a folder behind.
    expect(await jobs(world)).toEqual([])
    expect((await world.machine.exec("ls .do-computer/jobs/agent-1 | wc -l")).output.trim()).toBe(
      "0",
    )
    expect(world.errors).toEqual([])
  })

  it("stops the command when the turn that waits for it is stopped", async () => {
    const world = open(temporary(), { foregroundMs: 20_000 })
    const chat = await setup(world)
    script(world, (turn) =>
      afterTool(turn)
        ? sent("Done.")
        : use("bash", { command: "echo $$ > pid; echo waiting; sleep 300" }),
    )
    await send(world, chat.id, "run it")
    await until(
      () => chatState(world, chat.id),
      (state) => tools(state)[0]?.output?.includes("waiting") === true,
    )
    const started = Date.now()
    await call(world, `/chats/${chat.id}/abort`, "POST")
    await until(
      () => chatState(world, chat.id),
      (state) => !state.busy,
    )
    expect(Date.now() - started < 5_000).toBe(true)
    await until(
      () => world.machine.exec("kill -0 $(cat pid) 2>/dev/null; echo $?"),
      (outcome) => outcome.output.trim() === "1",
    )
    expect(await jobs(world)).toEqual([])
  })

  it("keeps a sub-agent from reporting until the command it left running has ended", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    script(world, (turn) => {
      if (turn.seen.includes("You are working as a sub-agent")) {
        if (turn.last.includes(NUDGED_SUB)) return fauxAssistantMessage("It built.")
        if (afterTool(turn)) return fauxAssistantMessage("Building, more soon.")
        return use("bash", { command: "sleep 2.5; echo built", run_in_background: true })
      }
      if (afterTool(turn)) return sent("Handed over.")
      if (turn.last.includes("subagent-report")) {
        return sent("The build is in.")
      }
      return use("subagent", { action: "start", title: "Build", task: "Build the site." })
    })
    await send(world, chat.id, "have it built")
    const reported = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).includes("The build is in."),
    )
    // One report, and it is what the sub-agent said once its command had ended.
    const words = reported.messages.flatMap((message) =>
      message.parts.filter(
        (part): part is NoticePart => part.type === "notice" && part.kind === "subagent",
      ),
    )
    expect(words.map((word) => word.detail)).toEqual(["It built."])
    expect(world.errors).toEqual([])
  })

  it("says so where a computer cannot keep a command running", async () => {
    const world = open(temporary(), { shell: "light" })
    const chat = await setup(world)
    script(world, (turn) => {
      if (afterTool(turn)) return sent("Done.")
      return turn.last.includes("background")
        ? use("bash", { command: "echo hi", run_in_background: true })
        : use("bash", { command: "echo hi" })
    })

    await send(world, chat.id, "in the background")
    const refused = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).length === 1,
    )
    expect(tools(refused)[0]).toMatchObject({ name: "bash", status: "error" })
    expect(tools(refused)[0]!.output).toContain("cannot run commands in the background")

    await send(world, chat.id, "plainly")
    const ran = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).length === 2,
    )
    expect(tools(ran)[1]).toMatchObject({ name: "bash", status: "done", output: "hi\n" })
    expect(world.errors).toEqual([])
  })
})
