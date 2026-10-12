import { type ChatState, DEFAULT_THINKING, type SubagentStatus } from "@durable-computer/protocol"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  type Conversation,
  type ConversationId,
  defineExtension,
  defineTool,
  type Extension,
  type Harness,
  section,
} from "@earendil-works/pi-durable"
import { ChatsDoc, IdentityDoc, type SubagentRecord } from "./docs.ts"
import { parseModel } from "./models.ts"
import { own } from "./own.ts"

/** How many sub-agents of one agent can be at work at once. */
export const MAX_WORKING_SUBAGENTS = 6
const MAX_TITLE_CHARS = 60
const MAX_TASK_CHARS = 8_000

/** Entry kind of word from a sub-agent, in the chat that started it. */
export const SUBAGENT_ENTRY = "dc.subagent"

export type SubagentOutcome = "reported" | "failed" | "stopped"

export type SubagentReport = {
  /** The sub-agent's own chat. */
  chatId: string
  /** The chat it was started in. */
  parentId: string
  title: string
  outcome: SubagentOutcome
  text: string
  /** The turn the report gives the agent in the parent chat, when it gives one. */
  turn: Awaited<ReturnType<Conversation["submit"]>> | undefined
}

export type SubagentSummary = {
  id: string
  title: string
  parentId: string
  status: SubagentStatus
}

/** What a sub-agent is told with its task. Not shown in its chat, where the task is. */
const preamble = (title: string) =>
  `<meta kind="subagent">You are working as a sub-agent: a copy of yourself that your main conversation with the user started to do one piece of work, "${title}", which is the message above. ` +
  "The user is not in this conversation, so you cannot ask them anything: make reasonable choices and say which you made. " +
  "Your final reply is sent back to the main conversation as your report, so make it complete and able to stand on its own: what you found or did, and anything left undone. " +
  "You cannot start sub-agents or change schedules from here.</meta>"

const MORE =
  '<meta kind="subagent">The message above is more from your main conversation with the user, which started you as a sub-agent. As before, your final reply is your report.</meta>'

/** What the agent is told to set it going on a report. Not shown in the chat. */
const NUDGE =
  '<meta kind="subagent">A sub-agent of yours has sent word, above. The user has not read it: tell them what matters from it in your own words, or carry on with the work it was for. You do not need to wait for sub-agents that are still working.</meta>'

const titleOf = (task: string) => {
  const line = task.trim().split("\n")[0]!.trim()
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line
}

const live = (status: SubagentStatus) => status === "working" || status === "waiting"

/** A problem the caller should be told about, as opposed to a bug. */
export class SubagentError extends Error {}

export type SubagentsOptions = {
  readonly now: () => number
  /**
   * What the looking-in on sub-agents runs under. It outlasts the tool call or request that
   * set it off, whose own context ends with it.
   */
  readonly context: Context
  /** A chat as a client would see it. */
  readonly chat: (chatId: string) => Promise<ChatState | undefined>
  /** Whether a chat has asked the user for something and not been answered. */
  readonly waiting: (chatId: string, context: Context) => Promise<boolean>
  /**
   * Whether something a chat left running will give the agent a turn there when it ends, such
   * as a command in the background. Until then the chat has not come to rest.
   */
  readonly running?: (chatId: string, context: Context) => Promise<boolean>
  /** Called when a sub-agent was stopped, so that what it was waiting on is not left asking. */
  readonly onStopped?: (chatId: string, context: Context) => Promise<void>
  /** Called when word of a sub-agent has been sent to its parent chat. */
  readonly onReport?: (report: SubagentReport) => void
  /** Called when what is kept of a sub-agent has changed, such as whether it is at work. */
  readonly onChanged?: () => void
  readonly onError?: (error: unknown) => void
}

/**
 * The agent's sub-agents: the tool it starts them with, and getting their reports back.
 *
 * A sub-agent is a conversation of its own, with the agent's memory, skills and computer. It
 * works in the background: starting one returns at once, and when it comes to rest its last
 * answer is written into the chat that started it, where the agent is given a turn to act on it.
 * Its chat can be read by the user and is written in only by the agent.
 *
 * What a sub-agent is doing is kept on its chat's record. Each step from there is keyed or
 * repeatable, so a crash can delay a report but not lose it or send it twice.
 */
export class Subagents {
  readonly extension: Extension
  readonly #options: SubagentsOptions
  #harness: Harness | undefined
  #ticking: Promise<void> = Promise.resolve()
  /** Sub-agents whose coming to rest is being waited for. */
  readonly #watching = new Set<string>()
  /** How often in a row each was found still busy after seeming to rest. */
  readonly #spins = new Map<string, number>()

  constructor(options: SubagentsOptions) {
    this.#options = options
    this.extension = defineExtension({
      name: "dc.subagents",
      tools: [this.#tool()],
      sections: [
        section(
          "subagents",
          () =>
            "In a conversation with the user you can hand work to sub-agents with the `subagent` tool. Use one for a piece of work that takes many steps and stands on its own, such as research, comparing options or a long job on files, and start several when the pieces do not depend on each other. Do not use one for something quick, or for something you must know before you can reply. After starting them, say in a sentence what you started, and do not wait: each report reaches you when it is ready.",
        ),
      ],
    })
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  #require(): Harness {
    if (this.#harness === undefined) throw new Error("Sub-agents are not attached to a harness")
    return this.#harness
  }

  /** The sub-agents started in one chat, oldest first. */
  async list(parentId: string, context: Context): Promise<SubagentSummary[]> {
    const chats = (await this.#require().snapshot(ChatsDoc, context))?.chats ?? {}
    return Object.entries(chats)
      .filter(([, chat]) => chat.subagent?.parentId === parentId)
      .sort(([, a], [, b]) => a.createdAt - b.createdAt)
      .map(([id, chat]) => ({ id, title: chat.title, parentId, status: chat.subagent!.status }))
  }

  /** Whether any sub-agent is at work, and so has a report still to come. */
  async working(context: Context): Promise<boolean> {
    const chats = (await this.#require().snapshot(ChatsDoc, context))?.chats ?? {}
    return Object.values(chats).some((chat) => chat.subagent?.status === "working")
  }

  /** Start a sub-agent on a task, from the chat `parentId`. Returns once it has been set going. */
  async start(
    input: { task: string; title?: string },
    parentId: string,
    context: Context,
  ): Promise<SubagentSummary> {
    const harness = this.#require()
    const now = this.#options.now()
    const task = input.task.trim()
    if (task === "") throw new SubagentError("A task is required: what should the sub-agent do?")
    if (task.length > MAX_TASK_CHARS) {
      throw new SubagentError(`A task can be at most ${MAX_TASK_CHARS} characters.`)
    }
    const title = (input.title?.trim() || titleOf(task)).slice(0, MAX_TITLE_CHARS)
    const identity = await harness.snapshot(IdentityDoc, context)
    if (identity === undefined) throw new SubagentError("The agent is not set up yet.")
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: parseModel(identity.model),
          thinkingLevel: identity.thinking ?? DEFAULT_THINKING,
        },
        init: async (tx, conversationId) => {
          const { chats } = await tx.doc(ChatsDoc)
          if (own(chats, parentId)?.kind !== "chat") {
            throw new SubagentError("Only a conversation with the user can start sub-agents.")
          }
          const working = Object.values(chats).filter(
            (chat) => chat.subagent !== undefined && live(chat.subagent.status),
          ).length
          if (working >= MAX_WORKING_SUBAGENTS) {
            throw new SubagentError(
              `There are already ${MAX_WORKING_SUBAGENTS} sub-agents at work. Wait for one to report, or stop one.`,
            )
          }
          chats[String(conversationId)] = {
            title,
            kind: "subagent",
            createdAt: now,
            updatedAt: now,
            archived: false,
            subagent: { parentId, task, status: "working", reported: null, reports: 0 },
          }
        },
      },
      context,
    )
    await this.tick()
    return { id: String(conversation.id), title, parentId, status: "working" }
  }

  /** Give a sub-agent more to do, whether it is at work or has finished. */
  async message(id: string, text: string, parentId: string, context: Context): Promise<void> {
    const harness = this.#require()
    const said = text.trim()
    if (said === "") throw new SubagentError("A message needs something to say.")
    if (said.length > MAX_TASK_CHARS) {
      throw new SubagentError(`A message can be at most ${MAX_TASK_CHARS} characters.`)
    }
    await this.#find(id, parentId, context)
    const conversation = await harness.conversation(Number(id) as ConversationId, context)
    if (conversation === undefined) throw new SubagentError(`There is no sub-agent "${id}".`)
    // Sent before it is marked as working: marked first, it could be seen at rest and reported
    // as done before this reached it.
    await conversation.submit(
      {
        type: "input",
        requestId: `subagent-message:${id}:${crypto.randomUUID()}`,
        content: [
          { type: "text", text: said },
          { type: "text", text: MORE },
        ],
        whenBusy: "steer",
      },
      context,
    )
    await this.#change(id, context, (subagent) => {
      subagent.status = "working"
      delete subagent.stopping
    })
    await this.tick()
  }

  /**
   * Stop a sub-agent that is at work. Stopped by the user, its agent is told; stopped by the
   * agent, which then knows, nothing more is said. `parentId` limits it to one chat's own.
   */
  async stop(id: string, by: "user" | "agent", context: Context, parentId?: string): Promise<void> {
    const harness = this.#require()
    const { subagent } = await this.#find(id, parentId, context)
    if (!live(subagent.status)) throw new SubagentError("That sub-agent is not at work.")
    await this.#change(id, context, (stored) => {
      stored.stopping = by
    })
    const conversation = await harness.conversation(Number(id) as ConversationId, context)
    await conversation?.abort(context)
    await this.#options.onStopped?.(id, context)
    await this.tick()
  }

  /** Look at each sub-agent that is at work, and send word of those that have come to rest. */
  tick(): Promise<void> {
    const context = this.#options.context
    const run = async () => {
      try {
        await this.#settle(context)
      } catch (error) {
        this.#options.onError?.(error)
      }
    }
    this.#ticking = this.#ticking.then(run, run)
    return this.#ticking
  }

  async #find(id: string, parentId: string | undefined, context: Context) {
    const chats = (await this.#require().snapshot(ChatsDoc, context))?.chats ?? {}
    const chat = own(chats, id)
    const subagent = chat?.subagent
    if (chat === undefined || subagent === undefined) {
      throw new SubagentError(`There is no sub-agent "${id}".`)
    }
    if (parentId !== undefined && subagent.parentId !== parentId) {
      throw new SubagentError(`Sub-agent "${id}" was started in another chat.`)
    }
    return { chat, subagent }
  }

  async #change(
    id: string,
    context: Context,
    change: (subagent: SubagentRecord) => void,
  ): Promise<void> {
    const now = this.#options.now()
    await this.#require().commit(async (tx) => {
      const chat = own((await tx.doc(ChatsDoc)).chats, id)
      if (chat?.subagent === undefined) return
      change(chat.subagent)
      chat.updatedAt = now
    }, context)
    this.#options.onChanged?.()
  }

  async #settle(context: Context): Promise<void> {
    const harness = this.#require()
    const chats = (await harness.snapshot(ChatsDoc, context))?.chats ?? {}
    for (const [id, chat] of Object.entries(chats)) {
      const subagent = chat.subagent
      if (subagent === undefined || !live(subagent.status)) continue
      const conversation = await harness.conversation(Number(id) as ConversationId, context)
      if (conversation === undefined) continue
      if (subagent.started !== true) {
        // Keyed, so sending it again after a crash between these two steps starts nothing new.
        await conversation.submit(
          {
            type: "input",
            requestId: `subagent:${id}`,
            content: [
              { type: "text", text: subagent.task },
              { type: "text", text: preamble(chat.title) },
            ],
          },
          context,
        )
        await this.#change(id, context, (stored) => {
          stored.started = true
        })
      }
      // Anything admitted and not yet answered, whoever sent it: the task, more from the
      // agent, or the user's answer to something it asked for.
      const inspection = await harness.inspect(context)
      if (inspection.submissions.some((entry) => String(entry.conversationId) === id)) {
        if (subagent.status !== "working") {
          await this.#change(id, context, (stored) => {
            stored.status = "working"
          })
        }
        this.#watch(id, conversation, context)
        continue
      }
      this.#spins.delete(id)
      await this.#rested(id, chat.title, subagent, context)
    }
  }

  /** A sub-agent has nothing left to do: work out what that means and send word of it. */
  async #rested(
    id: string,
    title: string,
    subagent: SubagentRecord,
    context: Context,
  ): Promise<void> {
    if (subagent.stopping !== undefined) {
      const told = subagent.stopping === "user"
      if (told) await this.#deliver(id, title, subagent, "stopped", "", context)
      await this.#change(id, context, (stored) => {
        stored.status = "stopped"
        delete stored.stopping
        if (told) stored.reports += 1
      })
      return
    }
    // What it left running will set it going again, and its report is what it says then.
    if (await this.#options.running?.(id, context)) return
    // It stopped to ask the user for something. Their answer sets it going again.
    if (await this.#options.waiting(id, context)) {
      if (subagent.status !== "waiting") {
        await this.#change(id, context, (stored) => {
          stored.status = "waiting"
        })
      }
      return
    }
    const state = await this.#options.chat(id)
    const last = state?.messages.findLast((message) => message.role === "assistant")
    if (last !== undefined && last.id === subagent.reported) {
      await this.#change(id, context, (stored) => {
        stored.status = "done"
      })
      return
    }
    const said = (last?.parts ?? [])
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n\n")
      .trim()
    let outcome: SubagentOutcome = "reported"
    let text = said
    if (last === undefined || last.status === "error" || last.status === "aborted" || said === "") {
      outcome = "failed"
      text =
        last?.status === "error"
          ? (last.error ?? "The model could not be reached.")
          : last?.status === "aborted"
            ? "It was interrupted."
            : "It ended without an answer."
    }
    await this.#deliver(id, title, subagent, outcome, text, context)
    await this.#change(id, context, (stored) => {
      stored.status = outcome === "reported" ? "done" : "failed"
      stored.reported = last?.id ?? null
      stored.reports += 1
    })
  }

  /**
   * Write word of a sub-agent into the chat that started it, and give the agent a turn there
   * unless it was the user who stopped it. Both are keyed, so repeating them does nothing new.
   */
  async #deliver(
    id: string,
    title: string,
    subagent: SubagentRecord,
    outcome: SubagentOutcome,
    text: string,
    context: Context,
  ): Promise<void> {
    const harness = this.#require()
    const now = this.#options.now()
    const parentId = subagent.parentId
    const parent = await harness.conversation(Number(parentId) as ConversationId, context)
    if (parent === undefined) return
    const key = `${id}:${subagent.reports + 1}`
    const told =
      outcome === "reported"
        ? `[Your sub-agent "${title}" (id ${id}) has reported back. This is its report.]\n\n${text}`
        : outcome === "failed"
          ? `[Your sub-agent "${title}" (id ${id}) failed before it could report: ${text}]`
          : `[The user stopped your sub-agent "${title}" (id ${id}) before it had finished.]`
    await parent.submit(
      {
        type: "write",
        requestId: `subagent-report:${key}`,
        entry: {
          kind: SUBAGENT_ENTRY,
          model: [{ role: "user", content: told, timestamp: now }],
          data: { chatId: id, title, outcome, text },
        },
      },
      context,
    )
    const turn =
      outcome === "stopped"
        ? undefined
        : await parent.submit(
            {
              type: "input",
              requestId: `subagent-turn:${key}`,
              content: [{ type: "text", text: NUDGE }],
              whenBusy: "followUp",
            },
            context,
          )
    await harness.commit(async (tx) => {
      const chat = own((await tx.doc(ChatsDoc)).chats, parentId)
      if (chat !== undefined) chat.updatedAt = now
    }, context)
    this.#options.onReport?.({ chatId: id, parentId, title, outcome, text, turn })
  }

  /** Come back to a busy sub-agent when it rests, without waiting for the next wake-up. */
  #watch(id: string, conversation: Conversation, context: Context): void {
    if (this.#watching.has(id)) return
    this.#watching.add(id)
    const spins = this.#spins.get(id) ?? 0
    this.#spins.set(id, spins + 1)
    void (async () => {
      try {
        // It can seem at rest a moment before what is queued for it is taken up. Looking again
        // at once, over and over, would spin.
        if (spins > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, 25 * 2 ** spins)))
        }
        await conversation.waitForIdle(context)
      } catch {
        // The agent was closed. Whoever opens it next looks again.
        this.#watching.delete(id)
        return
      }
      this.#watching.delete(id)
      await this.tick()
    })()
  }

  #tool() {
    return defineTool({
      name: "subagent",
      description:
        "Hand work to sub-agents: copies of you that work in the background, each in a conversation of its own, while you stay free to talk with the user. " +
        'action "start" needs `task`, and takes `title` (a few words to call it by); "message" needs `id` and `task` (more for one that is at work, or something new for one that has finished); "stop" needs `id`; "list" shows the ones started in this conversation. ' +
        "A sub-agent has your memory, skills and computer but knows nothing of this conversation, so write the task to stand on its own and say what to report back. " +
        "Starting one returns at once. Its report reaches you later as a message and gives you a turn then, so do not wait for it, check on it, or do the same work yourself in the meantime. The user can open a sub-agent's conversation and read along.",
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("start"),
          Type.Literal("message"),
          Type.Literal("stop"),
          Type.Literal("list"),
        ]),
        id: Type.Optional(Type.String({ description: "A sub-agent's id, from start or list" })),
        title: Type.Optional(Type.String({ description: "A few words to call it by" })),
        task: Type.Optional(Type.String({ description: "What it should do and report back" })),
      }),
      execute: async (args, api, context) => {
        const reply = (text: string, details?: { chatId: string; title: string }) => ({
          content: [{ type: "text" as const, text }],
          ...(details === undefined ? {} : { details }),
        })
        const fail = (text: string) => ({
          isError: true,
          content: [{ type: "text" as const, text }],
        })
        const chatId = String(api.conversationId)
        try {
          const chats = (await api.snapshot(ChatsDoc, context))?.chats ?? {}
          if (own(chats, chatId)?.kind !== "chat") {
            return fail("Only a conversation with the user can use sub-agents.")
          }
          switch (args.action) {
            case "list": {
              const mine = await this.list(chatId, context)
              return reply(
                mine.length === 0
                  ? "No sub-agents have been started in this conversation."
                  : mine.map((one) => `${one.id}: "${one.title}", ${one.status}`).join("\n"),
              )
            }
            case "start": {
              if (!args.task) return fail('"start" needs a task.')
              const started = await this.start(
                { task: args.task, title: args.title },
                chatId,
                context,
              )
              return reply(
                `Started sub-agent ${started.id}, "${started.title}". It is working in the background and its report will reach you when it is ready. Do not wait for it.`,
                { chatId: started.id, title: started.title },
              )
            }
            case "message": {
              if (!args.id || !args.task) return fail('"message" needs id and task.')
              await this.message(args.id, args.task, chatId, context)
              const title = own(chats, args.id)?.title ?? args.id
              return reply(
                `Sent to sub-agent ${args.id}. Its next report will reach you when it is ready.`,
                { chatId: args.id, title },
              )
            }
            case "stop": {
              if (!args.id) return fail('"stop" needs id.')
              await this.stop(args.id, "agent", context, chatId)
              return reply(`Stopped sub-agent ${args.id}.`, {
                chatId: args.id,
                title: own(chats, args.id)?.title ?? args.id,
              })
            }
          }
        } catch (error) {
          if (error instanceof SubagentError) return fail(error.message)
          throw error
        }
      },
    })
  }
}
