import { computerSandbox } from "@durable-computer/computers"
import type { ActorNamespace } from "@durable-computer/runtime"
import { SandboxEnv } from "@durable-computer/sandbox"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  type Conversation,
  type ConversationId,
  defineDoc,
  defineExtension,
  defineTool,
  type Extension,
  type Harness,
  section,
  type ToolRegistration,
  wrapTool,
} from "@earendil-works/pi-durable"
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools"
import { ChatsDoc, IdentityDoc } from "./docs.ts"
import { isInherited, own } from "./own.ts"

/** A computer of the user's that this agent may use. */
export type PairedComputer = {
  /** What the agent calls it. Unique among the agent's computers. */
  name: string
  platform: string
  hostname: string
  /** The home directory there, which relative paths resolve against. */
  home: string
  readOnly: boolean
  pairedAt: number
}

type ComputersState = {
  computers: Record<string, PairedComputer>
  /** Computers the agent asked to use and has not been answered about, by computer id. */
  asked?: Record<string, { name: string; at: number }>
}

/** A computer the agent could be connected to, as the directory describes it. */
export type NearbyComputer = {
  id: string
  name: string
  /** Whose it is, in words: a person's name, or a team's. */
  owner: string
  /** Whether `owner` is a team. */
  team: boolean
  platform: string
  readOnly: boolean
  online: boolean
  /** The agent can work on it already. */
  connected: boolean
  /** The agent asked for it and nobody has answered yet. */
  asked: boolean
}

/**
 * What the agent's host knows about computers beyond the ones connected to the agent: those of
 * the people it works for. The host decides which those are, and who is asked.
 */
export type ComputerDirectory = {
  /**
   * Whether the agent may work on a computer right now. Asked before every use: the agent's own
   * record of its computers is what it was last told, and this is what is so.
   */
  allowed(agentId: string, computerId: string): Promise<boolean>
  list(agentId: string): Promise<NearbyComputer[]>
  /**
   * Ask the people a computer belongs to whether the agent may use it. Resolves with who was
   * asked, in words, and whether this was the first time; undefined when there is no such
   * computer for this agent. The answer arrives later, through the gateway.
   */
  request(
    agentId: string,
    ask: { computerId: string; chatId: string; reason: string; agentName: string | null },
  ): Promise<{ asked: string; fresh: boolean } | undefined>
}

/** The answer to a request, as the gateway tells the agent. */
export type ComputerAnswer = {
  requestId: string
  /** The chat the agent asked from. */
  chatId: string | null
  approved: boolean
  /** Who answered, by name. */
  by: string
  /** What the computer is called. */
  name: string
}

/** Entry kind of the answer to a request for a computer, in the chat that asked. */
export const COMPUTER_ENTRY = "dc.computer-access"

/** What the agent is told to set it going on an answer. Not shown in the chat. */
const NUDGE =
  '<meta kind="computer">Your request to use a computer was answered, above. Carry on with what you wanted the computer for, or tell the user where things stand.</meta>'

const TOOL = "computers"

/** The agent's paired computers, keyed by computer id. Maintained by the gateway. */
export const ComputersDoc = defineDoc<ComputersState>({
  kind: "dc.computers",
  version: 1,
  scope: "session",
  initial: () => ({ computers: {} }),
})

const PARAMETER = Type.Optional(
  Type.String({
    description:
      "Name of one of the user's own computers to do this on. Omit to use your own computer.",
  }),
)

/** The actor name of a computer's link. */
export const computerActorName = (computerId: string) => `computer:${computerId}`

/**
 * Lets the agent's file and shell tools work on the user's own computers: each tool gains an
 * optional `computer` argument naming one, and the call then runs there instead.
 */
export class PairedComputers {
  readonly extension: Extension
  readonly #links: ActorNamespace
  readonly #directory: { agentId: string; lookup: ComputerDirectory } | undefined
  #harness: Harness | undefined

  /**
   * @param extraTools Other tools that act on a computer and should take the same argument.
   * @param directory Where the agent finds computers it is not connected to. Without it, the
   *   agent has only the ones it was given.
   */
  constructor(
    links: ActorNamespace,
    extraTools: readonly ToolRegistration[] = [],
    directory?: { agentId: string; lookup: ComputerDirectory },
  ) {
    this.#links = links
    this.#directory = directory
    const target = <Tool extends ToolRegistration>(tool: Tool) =>
      wrapTool(tool as ToolRegistration, (inner) => ({
        ...inner,
        parameters: Type.Object({
          ...(inner.parameters as unknown as { properties: Record<string, never> }).properties,
          computer: PARAMETER,
        }) as unknown as typeof inner.parameters,
        // The inner tool validates its own arguments shape; drop ours before it sees them.
        prepareArguments: undefined,
        execute: async (args, api, context) => {
          const { computer, ...rest } = args as Record<string, unknown> & { computer?: string }
          if (computer === undefined || computer === "") {
            return inner.execute(rest as never, api, context)
          }
          const found = await this.#find(computer, context)
          if (typeof found === "string") {
            return { isError: true, content: [{ type: "text", text: found }] }
          }
          if (
            this.#directory !== undefined &&
            !(await this.#directory.lookup.allowed(this.#directory.agentId, found.id))
          ) {
            // It was taken away and word of that did not arrive. It arrives now.
            await this.remove(found.id, context)
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `The computer "${found.computer.name}" is no longer connected to you. If you still need it, the \`${TOOL}\` tool can ask for it again.`,
                },
              ],
            }
          }
          const sandbox = computerSandbox({
            id: found.id,
            home: found.computer.home,
            link: this.#links.get(computerActorName(found.id)),
          })
          return inner.execute(rest as never, { ...api, env: new SandboxEnv(sandbox) }, context)
        },
      }))
    this.extension = defineExtension({
      name: "dc.paired-computers",
      ...(directory === undefined ? {} : { tools: [this.#tool()] }),
      sections: [
        section("computers", async (input, context) => {
          const state = await input.read.snapshot(ComputersDoc, context)
          const computers = Object.values(state?.computers ?? {})
          const asked = Object.values(state?.asked ?? {}).map((computer) => computer.name)
          // Said only where there is a way to look: which computers there are is the host's to say.
          const more =
            directory === undefined
              ? []
              : [
                  computers.length === 0
                    ? `None of the user's own computers is connected to you. They may have some: the \`${TOOL}\` tool lists them, and asks whoever one belongs to whether you may use it. Use it when a task is about their machine or their files there.`
                    : `There may be others you are not connected to: the \`${TOOL}\` tool lists them, and asks whoever one belongs to whether you may use it.`,
                  ...(asked.length === 0
                    ? []
                    : [
                        `You have asked to use ${asked.join(", ")} and have not been answered yet. The answer will reach you as a message; do not ask again.`,
                      ]),
                ]
          if (computers.length === 0) return more.length === 0 ? undefined : more.join("\n")
          const lines = computers
            .sort((a, b) => (a.name < b.name ? -1 : 1))
            .map(
              (computer) =>
                `- ${computer.name}: ${computer.platform}, home ${computer.home}${computer.readOnly ? ", read-only (you can read files there but not run commands or change anything)" : ""}`,
            )
          return [
            `The user has connected these computers of their own. To work on one, pass its name as \`computer\` to read, write, edit or bash; paths are then relative to its home directory. These are the user's real machines with their real files: be careful, and prefer your own computer unless the task is about theirs.\n${lines.join("\n")}`,
            ...more,
          ].join("\n")
        }),
      ],
      wraps: [
        target(createReadTool()),
        target(createWriteTool()),
        target(createEditTool()),
        target(createBashTool()),
        ...extraTools.map((tool) => target(tool)),
      ],
    })
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  #require(): Harness {
    if (this.#harness === undefined)
      throw new Error("Paired computers are not attached to a harness")
    return this.#harness
  }

  async #find(
    name: string,
    context: Context,
  ): Promise<{ id: string; computer: PairedComputer } | string> {
    const computers = (await this.#require().snapshot(ComputersDoc, context))?.computers ?? {}
    const wanted = name.trim().toLowerCase()
    const match = Object.entries(computers).find(
      ([id, computer]) => computer.name.toLowerCase() === wanted || id === name,
    )
    if (match !== undefined) return { id: match[0], computer: match[1] }
    const names = Object.values(computers).map((computer) => computer.name)
    return names.length === 0
      ? `There is no computer named "${name}": the user has not connected any of their computers.`
      : `There is no computer named "${name}". Connected computers: ${names.join(", ")}.`
  }

  async list(context: Context): Promise<(PairedComputer & { id: string })[]> {
    const computers = (await this.#require().snapshot(ComputersDoc, context))?.computers ?? {}
    return Object.entries(computers).map(([id, computer]) => ({ id, ...computer }))
  }

  /** Add or replace a computer. A name already used by another computer gets a number appended. */
  async put(id: string, computer: PairedComputer, context: Context): Promise<PairedComputer> {
    return this.#require().commit(async (tx) => {
      const { computers, asked } = await tx.doc(ComputersDoc)
      // It has it now, whatever it had asked.
      if (asked !== undefined) delete asked[id]
      const taken = new Set(
        Object.entries(computers)
          .filter(([other]) => other !== id)
          .map(([, other]) => other.name.toLowerCase()),
      )
      let name = computer.name
      for (let suffix = 2; taken.has(name.toLowerCase()); suffix++)
        name = `${computer.name}-${suffix}`
      const stored = { ...computer, name }
      if (isInherited(id)) throw new Error(`"${id}" cannot be a computer's id`)
      computers[id] = stored
      return stored
    }, context)
  }

  async remove(id: string, context: Context): Promise<void> {
    await this.#require().commit(async (tx) => {
      const state = await tx.doc(ComputersDoc)
      delete state.computers[id]
      if (state.asked !== undefined) delete state.asked[id]
    }, context)
  }

  /**
   * Someone answered the agent's request for a computer. The answer is written into the chat that
   * asked, and the agent is given a turn there, which is what this resolves with. Both are keyed
   * by the request, so being told twice does nothing new.
   */
  async answered(
    id: string,
    answer: ComputerAnswer,
    context: Context,
  ): Promise<Awaited<ReturnType<Conversation["submit"]>> | undefined> {
    const harness = this.#require()
    const name = await harness.commit(async (tx) => {
      const state = await tx.doc(ComputersDoc)
      if (state.asked !== undefined) delete state.asked[id]
      // What the agent calls it, where that differs from what it is called.
      return own(state.computers, id)?.name ?? answer.name
    }, context)
    if (answer.chatId === null || !/^\d+$/.test(answer.chatId)) return undefined
    const chat = own((await harness.snapshot(ChatsDoc, context))?.chats ?? {}, answer.chatId)
    const conversation = await harness.conversation(
      Number(answer.chatId) as ConversationId,
      context,
    )
    if (chat === undefined || conversation === undefined) return undefined
    const by = answer.by.replace(/\s+/g, " ").trim().slice(0, 80) || "Someone"
    await conversation.submit(
      {
        type: "write",
        requestId: `computer-answer:${answer.requestId}`,
        entry: {
          kind: COMPUTER_ENTRY,
          model: [
            {
              role: "user",
              content: answer.approved
                ? `[${by} said yes: you can now use the computer "${name}". Pass that name as \`computer\` to read, write, edit or bash.]`
                : `[${by} said no to your request to use the computer "${name}". Do not ask for it again unless they bring it up.]`,
              timestamp: Date.now(),
            },
          ],
          data: { computerId: id, name, approved: answer.approved, by },
        },
      },
      context,
    )
    return conversation.submit(
      {
        type: "input",
        requestId: `computer-turn:${answer.requestId}`,
        content: [{ type: "text", text: NUDGE }],
        whenBusy: "followUp",
      },
      context,
    )
  }

  /** Keep what the agent believes it has asked for in step with what the directory says. */
  async #noteAsked(
    asked: readonly { id: string; name: string }[],
    context: Context,
  ): Promise<void> {
    const harness = this.#require()
    const known = (await harness.snapshot(ComputersDoc, context))?.asked ?? {}
    const same =
      Object.keys(known).length === asked.length &&
      asked.every(({ id }) => own(known, id) !== undefined)
    if (same) return
    await harness.commit(async (tx) => {
      const state = await tx.doc(ComputersDoc)
      const before = state.asked ?? {}
      state.asked = {}
      for (const { id, name } of asked) {
        if (!isInherited(id)) state.asked[id] = own(before, id) ?? { name, at: Date.now() }
      }
    }, context)
  }

  #tool() {
    return defineTool({
      name: TOOL,
      description:
        "See the computers that the people you work for have connected to this app, and ask to use one you cannot use yet. " +
        'action "list" shows each one: what it is called, whose it is, whether it is online, and whether you can use it. "request" needs `name`, a computer from the list, and takes `reason`, a sentence for whoever it belongs to about what you want it for. ' +
        "Asking returns at once and the answer reaches you later as a message, perhaps much later: say that you asked, do not wait or ask again, and carry on with whatever does not need that computer. Once someone says yes, pass the computer's name as `computer` to read, write, edit or bash.",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("list"), Type.Literal("request")]),
        name: Type.Optional(
          Type.String({ description: "The computer to ask for: its name or id, from list" }),
        ),
        reason: Type.Optional(
          Type.String({ description: "What you want it for, for whoever it belongs to" }),
        ),
      }),
      execute: async (args, api, context) => {
        const reply = (text: string) => ({ content: [{ type: "text" as const, text }] })
        const fail = (text: string) => ({ isError: true, ...reply(text) })
        const { agentId, lookup } = this.#directory!
        const nearby = await lookup.list(agentId)
        const mine = (await api.snapshot(ComputersDoc, context))?.computers ?? {}
        // A computer the agent has is known to it by the name it was given here.
        const named = nearby.map((computer) => ({
          ...computer,
          name: own(mine, computer.id)?.name ?? computer.name,
        }))
        await this.#noteAsked(
          named.filter((computer) => computer.asked && !computer.connected),
          context,
        )
        const whose = (computer: NearbyComputer) =>
          computer.team ? `belongs to the team ${computer.owner}` : `${computer.owner}'s`
        if (args.action === "list") {
          if (named.length === 0) {
            return reply(
              "Nobody you work for has connected a computer. They can connect one from Computers, in the workspace settings of the app.",
            )
          }
          const shared = (name: string) =>
            named.filter((other) => other.name.toLowerCase() === name.toLowerCase()).length > 1
          return reply(
            named
              .map(
                (computer) =>
                  `- ${computer.name}${shared(computer.name) ? ` (id ${computer.id})` : ""}: ${whose(computer)}, ${computer.platform}, ${computer.online ? "online" : "offline"}${computer.readOnly ? ", read-only" : ""}. ${
                    computer.connected
                      ? "You can use it."
                      : computer.asked
                        ? "You asked to use it and have not been answered."
                        : 'You cannot use it yet; "request" asks for it.'
                  }`,
              )
              .join("\n"),
          )
        }
        const wanted = (args.name ?? "").trim().toLowerCase()
        if (wanted === "") return fail('"request" needs the name of a computer, from "list".')
        const matches = named.filter(
          (computer) => computer.id === wanted || computer.name.toLowerCase() === wanted,
        )
        if (matches.length === 0) {
          return fail(
            named.length === 0
              ? `There is no computer named "${args.name}": nobody you work for has connected one.`
              : `There is no computer named "${args.name}". There are: ${named.map((computer) => computer.name).join(", ")}.`,
          )
        }
        if (matches.length > 1) {
          return fail(
            `More than one computer is called "${args.name}". Say which by its id: ${matches.map((computer) => `${computer.id} (${whose(computer)})`).join(", ")}.`,
          )
        }
        const computer = matches[0]!
        if (computer.connected) {
          return reply(
            `You can already use "${computer.name}": pass that name as \`computer\` to read, write, edit or bash.`,
          )
        }
        const chatId = String(api.conversationId)
        if (own((await api.snapshot(ChatsDoc, context))?.chats ?? {}, chatId)?.kind !== "chat") {
          return fail(
            "Only a conversation with the user can ask for a computer: the answer has to have somewhere to arrive.",
          )
        }
        const identity = await api.snapshot(IdentityDoc, context)
        const asked = await lookup.request(agentId, {
          computerId: computer.id,
          chatId,
          reason: (args.reason ?? "").trim(),
          agentName: identity?.name ?? null,
        })
        if (asked === undefined) return fail(`There is no computer named "${args.name}" any more.`)
        await this.#noteAsked(
          [...named.filter((other) => other.asked && !other.connected), computer],
          context,
        )
        return reply(
          asked.fresh
            ? `Asked ${asked.asked} whether you may use "${computer.name}". Their answer will reach you as a message, which may take a while: do not wait for it or ask again. Tell the user that you asked, and who.`
            : `You have already asked to use "${computer.name}", and ${asked.asked} has not answered yet. Do not ask again: the answer will reach you as a message.`,
        )
      },
    })
  }
}
