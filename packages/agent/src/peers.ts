import { type ChatState, DEFAULT_THINKING, type SubagentStatus } from "@do-computer/protocol"
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
import { agentMeta } from "./caller.ts"
import { ChatsDoc, IdentityDoc, type PeerRecord } from "./docs.ts"
import { parseModel } from "./models.ts"
import { own } from "./own.ts"

const MAX_TITLE_CHARS = 60
const MAX_MESSAGE_CHARS = 20_000
const MAX_NAME_CHARS = 80
/** How many times in a row handing an answer over is tried before it is given up. */
const MAX_DELIVERY_FAILURES = 5

/** Entry kind of another agent's reply, in the chat the message was sent from. */
export const AGENT_ENTRY = "dc.agent"

/** Another agent in the same workspace, as an agent is told of it. */
export type PeerAgent = {
  id: string
  /** Null while it has not named itself. */
  name: string | null
  tagline: string | null
}

/** A message from one agent to another. */
export type PeerMessage = {
  /** Names this message, so that handing it over twice says it once. */
  id: string
  /** The sender's chat it was written in, where the answer is to go. */
  chatId: string
  text: string
  /** What the sender calls itself. */
  from: string | null
}

export type PeerOutcome = "reported" | "failed" | "stopped"

/** An agent's answer to a message, on its way back to the chat the message came from. */
export type PeerReply = {
  /** Names this answer, so that handing it over twice says it once. */
  id: string
  /** The chat the message was sent from. */
  chatId: string
  /** The conversation the answer comes out of, on the agent that answers. */
  threadId: string
  outcome: PeerOutcome
  text: string
  /** What the agent that answers calls itself. */
  from: string | null
}

/**
 * How an agent finds the other agents of its workspace and reaches them. The host decides which
 * those are, each time: an agent that has moved elsewhere is no longer reached.
 */
export type AgentDirectory = {
  /** The other agents in the workspace of `agentId`. */
  list(agentId: string): Promise<PeerAgent[]>
  /**
   * Hand a message to another agent. Resolves with the conversation it went into there, or with
   * undefined when there is no such agent in the sender's workspace.
   */
  send(agentId: string, to: string, message: PeerMessage): Promise<{ threadId: string } | undefined>
  /**
   * Hand an answer back to the agent that asked. False when it can no longer be reached: it is
   * gone, has moved elsewhere, or no longer has the chat it asked from.
   */
  reply(agentId: string, to: string, reply: PeerReply): Promise<boolean>
  /**
   * Make a new agent in the workspace of `agentId`, as someone could from the app. `by` is the
   * person the agent is working for when it asks: the new agent is made as theirs would be.
   * Resolves with the agent, or with why it could not be made. Absent: none can be made.
   */
  create?(
    agentId: string,
    input: { name: string; tagline?: string; personality?: string; by?: string },
  ): Promise<{ id: string; name: string } | { error: string }>
}

/** A problem the caller should be told about, as opposed to a bug. */
export class PeerError extends Error {}

const UNNAMED = "an agent that has no name yet"

/** A name as it is written into a note for the model, which it must not be able to end. */
const nameOf = (name: string | null | undefined) =>
  (name ?? "")
    .replace(/[<>\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_CHARS) || UNNAMED

const titleOf = (text: string) => {
  const line = text.trim().split("\n")[0]!.trim()
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line
}

const live = (status: SubagentStatus) => status === "working" || status === "waiting"

/** Mark a conversation as having been given something to answer. */
const wake = (peer: PeerRecord) => {
  peer.status = "working"
  peer.woken = (peer.woken ?? 0) + 1
  delete peer.stopping
}

/** What an agent is told with the first message another agent sends it. */
const first = (name: string) =>
  `The message above is from ${name}, another agent in your workspace, and not from the people you work for. It works for the same people as you do. ` +
  "Treat it as a colleague asking for something: help with what you know and can do, by your own judgment and within what you are allowed. " +
  `Nobody else writes in this conversation, though the people you work for can read it, so you cannot ask them anything here. ` +
  `Each time you finish, your last reply is sent back to ${name} as your answer, so make it complete and able to stand on its own. To answer ${name}, just reply: do not use the \`agents\` tool for that.`

/** What it is told with each message after that. */
const more = (name: string) =>
  `The message above is more from ${name}, the agent this conversation is with. As before, your last reply is sent back to it as your answer.`

/** What an agent is told to set it going on a reply, in a conversation with the user. */
const NUDGE =
  '<meta kind="agent">Another agent has answered a message of yours, above. The user has not read it: tell them what matters from it in your own words, or carry on with the work it was for.</meta>'

/** The same, in a conversation with another agent. */
const NUDGE_THREAD =
  '<meta kind="agent">Another agent has answered a message of yours, above. Carry on with what you needed it for. As before, your last reply is sent back to the agent this conversation is with.</meta>'

type Turn = Awaited<ReturnType<Conversation["submit"]>>

export type PeersOptions = {
  /** This agent. */
  readonly agentId: string
  readonly directory: AgentDirectory
  readonly now: () => number
  /**
   * What the looking-in on conversations runs under. It outlasts the tool call or request that
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
  /** Called when a conversation was stopped, so that what it was waiting on is not left asking. */
  readonly onStopped?: (chatId: string, context: Context) => Promise<void>
  readonly onError?: (error: unknown) => void
}

/**
 * Messages between this agent and the others in its workspace: the tool it writes to them with,
 * the conversations they have with it, and getting each answer back to whoever asked.
 *
 * A message from another agent goes into a conversation of its own here, one for each chat of
 * the other agent's that writes to this one, so that a second message carries on from the first.
 * This agent works there as it does anywhere, and when it comes to rest its last reply is handed
 * back, written into the chat that asked, where the other agent is given a turn to act on it.
 * The conversation can be read by the user and is written in only by the two agents.
 *
 * How a conversation is getting on is kept on its chat's record. Each step from there is keyed
 * or repeatable, so a crash can delay an answer but not lose it or send it twice.
 */
export class Peers {
  readonly extension: Extension
  readonly #options: PeersOptions
  #harness: Harness | undefined
  #ticking: Promise<void> = Promise.resolve()
  #receiving: Promise<unknown> = Promise.resolve()
  /** Conversations whose coming to rest is being waited for. */
  readonly #watching = new Set<string>()
  /** How often in a row each was found still busy after seeming to rest. */
  readonly #spins = new Map<string, number>()

  constructor(options: PeersOptions) {
    this.#options = options
    this.extension = defineExtension({
      name: "dc.peers",
      tools: [this.#tool()],
      sections: [
        section(
          "agents",
          () =>
            "Other agents may work in this workspace beside you, for the same people. With the `agents` tool you can see who they are and send one a message: for something it knows or can do that you cannot, or when the user asks you to. After sending, say in a sentence what you asked and of whom, and do not wait: its reply reaches you when it is ready.",
        ),
      ],
    })
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  #require(): Harness {
    if (this.#harness === undefined) throw new Error("Peers are not attached to a harness")
    return this.#harness
  }

  /** Whether any conversation with another agent is at work, and so has an answer still to send. */
  async working(context: Context): Promise<boolean> {
    const chats = (await this.#require().snapshot(ChatsDoc, context))?.chats ?? {}
    return Object.values(chats).some((chat) => chat.peer?.status === "working")
  }

  /**
   * Take in a message from the agent `from`. It goes into the conversation that agent's chat
   * already has here, or a new one. Resolves once it has been admitted, not once it is answered.
   */
  receive(from: string, message: PeerMessage, context: Context): Promise<{ threadId: string }> {
    // One at a time, so that two messages from one chat cannot each open a conversation for it.
    const run = () => this.#receive(from, message, context)
    const next = this.#receiving.then(run, run)
    this.#receiving = next.catch(() => {})
    return next
  }

  async #receive(
    from: string,
    message: PeerMessage,
    context: Context,
  ): Promise<{ threadId: string }> {
    const harness = this.#require()
    const now = this.#options.now()
    if (
      typeof message.id !== "string" ||
      message.id === "" ||
      message.id.length > 300 ||
      typeof message.chatId !== "string" ||
      !/^\d+$/.test(message.chatId)
    ) {
      throw new PeerError("That message cannot be read.")
    }
    const said = typeof message.text === "string" ? message.text.trim() : ""
    if (said === "") throw new PeerError("A message needs something to say.")
    if (said.length > MAX_MESSAGE_CHARS) {
      throw new PeerError(`A message can be at most ${MAX_MESSAGE_CHARS} characters.`)
    }
    const name = nameOf(message.from)
    const chats = (await harness.snapshot(ChatsDoc, context))?.chats ?? {}
    let threadId = Object.entries(chats).find(
      ([, chat]) => chat.peer?.agentId === from && chat.peer.chatId === message.chatId,
    )?.[0]
    // Also one that was opened and then never given its message, which a crash can leave.
    const fresh = threadId === undefined || own(chats, threadId)?.peer?.woken === undefined
    if (threadId === undefined) {
      const identity = await harness.snapshot(IdentityDoc, context)
      if (identity === undefined) throw new PeerError("The agent is not set up yet.")
      const created = await harness.createConversation(
        {
          ownership: { kind: "ownerless" },
          agent: {
            model: parseModel(identity.model),
            thinkingLevel: identity.thinking ?? DEFAULT_THINKING,
          },
          init: async (tx, conversationId) => {
            ;(await tx.doc(ChatsDoc)).chats[String(conversationId)] = {
              title: titleOf(said),
              kind: "agent",
              createdAt: now,
              updatedAt: now,
              archived: false,
              // At rest until the message is in, so that a crash in between leaves nothing owed.
              peer: {
                agentId: from,
                name,
                chatId: message.chatId,
                status: "done",
                replied: null,
                replies: 0,
              },
            }
          },
        },
        context,
      )
      threadId = String(created.id)
    }
    const conversation = await harness.conversation(Number(threadId) as ConversationId, context)
    if (conversation === undefined) throw new PeerError("That conversation is gone.")
    // Sent before it is marked as working: marked first, it could be seen at rest and answered
    // for before this reached it.
    await conversation.submit(
      {
        type: "input",
        requestId: `peer-message:${message.id}`,
        content: [
          { type: "text", text: said },
          { type: "text", text: agentMeta({ id: from, name }, fresh ? first(name) : more(name)) },
        ],
        whenBusy: "steer",
      },
      context,
    )
    await this.#change(threadId, context, (peer) => {
      wake(peer)
      peer.name = name
      delete peer.failures
    })
    await this.tick()
    return { threadId }
  }

  /**
   * The agent `from` has answered a message this agent sent. The answer is written into the chat
   * that sent it, and the agent is given a turn there, which is what this resolves with. Both
   * are keyed by the answer, so being told twice does nothing new. Undefined when the chat is
   * gone.
   */
  async replied(
    from: string,
    reply: PeerReply,
    context: Context,
  ): Promise<{ turn: Turn; chatId: string; thread: boolean } | undefined> {
    const harness = this.#require()
    const now = this.#options.now()
    if (
      typeof reply.id !== "string" ||
      reply.id === "" ||
      reply.id.length > 300 ||
      typeof reply.chatId !== "string" ||
      !/^\d+$/.test(reply.chatId) ||
      typeof reply.threadId !== "string" ||
      typeof reply.text !== "string" ||
      !["reported", "failed", "stopped"].includes(reply.outcome)
    ) {
      throw new PeerError("That answer cannot be read.")
    }
    const chatId = reply.chatId
    const chat = own((await harness.snapshot(ChatsDoc, context))?.chats ?? {}, chatId)
    const conversation = await harness.conversation(Number(chatId) as ConversationId, context)
    if (chat === undefined || conversation === undefined) return undefined
    if (chat.kind !== "chat" && chat.kind !== "agent") return undefined
    const name = nameOf(reply.from)
    const told =
      reply.outcome === "reported"
        ? `[${name}, the agent you sent a message to (id ${from}), has replied. This is its reply.]\n\n${reply.text}`
        : reply.outcome === "failed"
          ? `[${name}, the agent you sent a message to (id ${from}), could not answer it: ${reply.text}]`
          : `[Someone stopped ${name}, the agent you sent a message to (id ${from}), before it had answered.]`
    await conversation.submit(
      {
        type: "write",
        requestId: `peer-reply:${reply.id}`,
        entry: {
          kind: AGENT_ENTRY,
          model: [{ role: "user", content: told, timestamp: now }],
          data: {
            agentId: from,
            name,
            chatId: reply.threadId,
            outcome: reply.outcome,
            text: reply.text,
          },
        },
      },
      context,
    )
    const thread = chat.peer !== undefined
    // Sent before the conversation is marked as working, as a message from its agent is.
    const turn = await conversation.submit(
      {
        type: "input",
        requestId: `peer-turn:${reply.id}`,
        content: [{ type: "text", text: thread ? NUDGE_THREAD : NUDGE }],
        whenBusy: "followUp",
      },
      context,
    )
    await harness.commit(async (tx) => {
      const stored = own((await tx.doc(ChatsDoc)).chats, chatId)
      if (stored === undefined) return
      stored.updatedAt = now
      // What it says next goes on to the agent that conversation is with.
      if (stored.peer !== undefined) wake(stored.peer)
    }, context)
    if (thread) await this.tick()
    return { turn, chatId, thread }
  }

  /** Stop a conversation with another agent that is at work. That agent is told. */
  async stop(id: string, context: Context): Promise<void> {
    const harness = this.#require()
    const peer = own((await harness.snapshot(ChatsDoc, context))?.chats ?? {}, id)?.peer
    if (peer === undefined) throw new PeerError(`There is no conversation "${id}".`)
    if (!live(peer.status)) throw new PeerError("That conversation is not at work.")
    await this.#change(id, context, (stored) => {
      stored.stopping = true
    })
    const conversation = await harness.conversation(Number(id) as ConversationId, context)
    await conversation?.abort(context)
    await this.#options.onStopped?.(id, context)
    await this.tick()
  }

  /** Look at each conversation that is at work, and send back the answer of those at rest. */
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

  async #change(id: string, context: Context, change: (peer: PeerRecord) => void): Promise<void> {
    const now = this.#options.now()
    await this.#require().commit(async (tx) => {
      const chat = own((await tx.doc(ChatsDoc)).chats, id)
      if (chat?.peer === undefined) return
      change(chat.peer)
      chat.updatedAt = now
    }, context)
  }

  async #settle(context: Context): Promise<void> {
    const harness = this.#require()
    const chats = (await harness.snapshot(ChatsDoc, context))?.chats ?? {}
    for (const [id, chat] of Object.entries(chats)) {
      const peer = chat.peer
      if (peer === undefined || !live(peer.status)) continue
      const conversation = await harness.conversation(Number(id) as ConversationId, context)
      if (conversation === undefined) continue
      // Anything admitted and not yet answered, whoever sent it: the other agent's message, an
      // answer to one of this agent's own, or the user's answer to something it asked for.
      const inspection = await harness.inspect(context)
      if (inspection.submissions.some((entry) => String(entry.conversationId) === id)) {
        if (peer.status !== "working") {
          await this.#change(id, context, (stored) => {
            stored.status = "working"
          })
        }
        this.#watch(id, conversation, context)
        continue
      }
      this.#spins.delete(id)
      await this.#rested(id, peer, context)
    }
  }

  /** A conversation has nothing left to do: work out what that means and send word of it. */
  async #rested(id: string, peer: PeerRecord, context: Context): Promise<void> {
    // Handing word over takes a while, and more can arrive meanwhile. Then it is at work again,
    // whatever was found here, and the next look deals with it.
    const rest = (stored: PeerRecord, status: SubagentStatus) => {
      if (stored.woken === peer.woken) stored.status = status
    }
    if (peer.stopping === true) {
      const sent = await this.#deliver(id, peer, "stopped", "", context)
      if (sent === "later") return
      await this.#change(id, context, (stored) => {
        if (stored.woken === peer.woken) delete stored.stopping
        rest(stored, "stopped")
        delete stored.failures
        if (sent === "sent") stored.replies += 1
      })
      return
    }
    // What it left running will set it going again, and its reply is what it says then.
    if (await this.#options.running?.(id, context)) return
    // It stopped to ask the user for something. Their answer sets it going again.
    if (await this.#options.waiting(id, context)) {
      if (peer.status !== "waiting") {
        await this.#change(id, context, (stored) => {
          stored.status = "waiting"
        })
      }
      return
    }
    const state = await this.#options.chat(id)
    const last = state?.messages.findLast((message) => message.role === "assistant")
    if (last !== undefined && last.id === peer.replied) {
      await this.#change(id, context, (stored) => rest(stored, "done"))
      return
    }
    const said = (last?.parts ?? [])
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n\n")
      .trim()
    let outcome: PeerOutcome = "reported"
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
    const sent = await this.#deliver(id, peer, outcome, text, context)
    if (sent === "later") return
    await this.#change(id, context, (stored) => {
      // An answer nobody is left to hear is not one that was given.
      rest(stored, sent === "sent" && outcome === "reported" ? "done" : "failed")
      stored.replied = last?.id ?? null
      delete stored.failures
      if (sent === "sent") stored.replies += 1
    })
  }

  /**
   * Hand word of a conversation back to the agent it is with. Keyed by how many times word has
   * been sent, so that trying again after a crash says it once. `gone` is when that agent can no
   * longer be reached, `later` when handing it over failed and is worth another try.
   */
  async #deliver(
    id: string,
    peer: PeerRecord,
    outcome: PeerOutcome,
    text: string,
    context: Context,
  ): Promise<"sent" | "gone" | "later"> {
    const { agentId, directory } = this.#options
    const identity = await this.#require().snapshot(IdentityDoc, context)
    try {
      const sent = await directory.reply(agentId, peer.agentId, {
        id: `${agentId}:${id}:${peer.replies + 1}`,
        chatId: peer.chatId,
        threadId: id,
        outcome,
        text,
        from: identity?.name ?? null,
      })
      return sent ? "sent" : "gone"
    } catch (error) {
      this.#options.onError?.(error)
      const failures = (peer.failures ?? 0) + 1
      if (failures >= MAX_DELIVERY_FAILURES) return "gone"
      // Left as working, so that the next wake-up tries again.
      await this.#change(id, context, (stored) => {
        stored.failures = failures
      })
      return "later"
    }
  }

  /** Come back to a busy conversation when it rests, without waiting for the next wake-up. */
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
      name: "agents",
      description:
        "Work with the other agents in this workspace: each is an agent like you, with a name, memory, skills and computer of its own, working for the same people. " +
        'action "list" shows who they are; "message" needs `to` (a name or id from the list) and `message`. ' +
        (this.#options.directory.create === undefined
          ? ""
          : '"create" makes a new agent in the workspace, when the person asks for one: it needs `name`, and takes `tagline` (one line on what it is for), `personality` (how it should work and what it should know, written to it as "You are...") and `message` (the first thing you want from it, sent as "message" would be). The person meets it in the app like any other agent. ') +
        "The other agent knows nothing of this conversation, so write the message to stand on its own: what you want, and what to send back. " +
        "Sending returns at once. Its reply reaches you later as a message and gives you a turn then, so do not wait for it or send the same thing again. " +
        "What you send to one agent from this conversation carries on one conversation with it, which the user can open and read.",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("list"), Type.Literal("message"), Type.Literal("create")]),
        to: Type.Optional(Type.String({ description: "An agent's name or id, from list" })),
        message: Type.Optional(Type.String({ description: "What to say to it" })),
        name: Type.Optional(Type.String({ description: "For create: the new agent's name" })),
        tagline: Type.Optional(
          Type.String({ description: "For create: one line on what the new agent is for" }),
        ),
        personality: Type.Optional(
          Type.String({
            description:
              'For create: how the new agent should work and what it should know, written to it in the second person ("You are...")',
          }),
        ),
      }),
      execute: async (args, api, context) => {
        const reply = (
          text: string,
          details?: { agentId: string; name: string; chatId: string },
        ) => ({
          output: [{ type: "text" as const, text }],
          ...(details === undefined ? {} : { details }),
        })
        const fail = (text: string) => ({
          isError: true,
          output: [{ type: "text" as const, text }],
        })
        const { agentId, directory } = this.#options
        const called = (peer: PeerAgent) => (peer.name === null ? UNNAMED : `"${peer.name}"`)
        const peers = await directory.list(agentId)
        if (args.action === "list") {
          return reply(
            peers.length === 0
              ? "There are no other agents in this workspace."
              : peers
                  .map(
                    (peer) =>
                      `${peer.name ?? `(${UNNAMED})`} (id ${peer.id})${peer.tagline ? `: ${peer.tagline}` : ""}`,
                  )
                  .join("\n"),
          )
        }
        if (args.action === "create") {
          const create = directory.create
          if (create === undefined) {
            return fail("An agent cannot be made from here. The person can make one in the app.")
          }
          const chatId = String(api.conversationId)
          const chat = own((await api.snapshot(ChatsDoc, context))?.chats ?? {}, chatId)
          if (chat?.kind !== "chat") {
            return fail("Only a conversation with the user can make a new agent.")
          }
          const name = (args.name ?? "").trim()
          if (name === "") return fail('"create" needs name.')
          if (name.length > 40) return fail("A name can be at most 40 characters.")
          if (peers.some((peer) => peer.name?.toLowerCase() === name.toLowerCase())) {
            return fail(`There is already an agent called "${name}" in this workspace.`)
          }
          const first = (args.message ?? "").trim()
          if (first.length > MAX_MESSAGE_CHARS) {
            return fail(`A message can be at most ${MAX_MESSAGE_CHARS} characters.`)
          }
          const identity = await api.snapshot(IdentityDoc, context)
          const made = await create.call(directory, agentId, {
            name,
            ...(args.tagline?.trim() ? { tagline: args.tagline.trim().slice(0, 120) } : {}),
            ...(args.personality?.trim()
              ? { personality: args.personality.trim().slice(0, 4000) }
              : {}),
            by: chat.lastBy ?? chat.createdBy ?? identity?.ownerId,
          })
          if ("error" in made) return fail(made.error)
          const told = `Made the agent "${made.name}" (id ${made.id}). The person finds it with the other agents in the app.`
          if (first === "")
            return reply(`${told} Write to it with "message" when you want something from it.`)
          try {
            const sent = await directory.send(agentId, made.id, {
              id: `${agentId}:${chatId}:${api.callId}`,
              chatId,
              text: first,
              from: identity?.name ?? null,
            })
            if (sent !== undefined) {
              return reply(
                `${told} Your message was sent to it. Its reply will reach you as a message when it is ready: do not wait for it or send it again.`,
                { agentId: made.id, name: made.name, chatId: sent.threadId },
              )
            }
          } catch {
            // Said below: the agent is there, and can be written to again.
          }
          return reply(
            `${told} Your message could not be handed to it; send it again with "message".`,
          )
        }
        const wanted = (args.to ?? "").trim()
        const said = (args.message ?? "").trim()
        if (wanted === "" || said === "") return fail('"message" needs to and message.')
        if (said.length > MAX_MESSAGE_CHARS) {
          return fail(`A message can be at most ${MAX_MESSAGE_CHARS} characters.`)
        }
        const matches = peers.filter(
          (peer) => peer.id === wanted || peer.name?.toLowerCase() === wanted.toLowerCase(),
        )
        if (matches.length === 0) {
          return fail(
            peers.length === 0
              ? `There is no agent "${wanted}": there are no other agents in this workspace.`
              : `There is no agent "${wanted}" in this workspace. There are: ${peers.map((peer) => `${called(peer)} (id ${peer.id})`).join(", ")}.`,
          )
        }
        if (matches.length > 1) {
          return fail(
            `More than one agent is called "${wanted}". Say which by its id: ${matches.map((peer) => peer.id).join(", ")}.`,
          )
        }
        const peer = matches[0]!
        const chatId = String(api.conversationId)
        const kind = own((await api.snapshot(ChatsDoc, context))?.chats ?? {}, chatId)?.kind
        if (kind !== "chat" && kind !== "agent") {
          return fail(
            "Only a conversation with the user, or one with another agent, can send a message to an agent: the reply has to have somewhere to arrive.",
          )
        }
        const identity = await api.snapshot(IdentityDoc, context)
        let sent: { threadId: string } | undefined
        try {
          sent = await directory.send(agentId, peer.id, {
            // The same for this call however often it is run, so that it is said once.
            id: `${agentId}:${chatId}:${api.callId}`,
            chatId,
            text: said,
            from: identity?.name ?? null,
          })
        } catch (error) {
          return fail(
            `The message could not be handed to ${called(peer)}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        if (sent === undefined) {
          return fail(`There is no agent ${called(peer)} in this workspace any more.`)
        }
        return reply(
          `Sent to ${called(peer)}. Its reply will reach you as a message when it is ready, which may take a while: do not wait for it or send this again.`,
          { agentId: peer.id, name: peer.name ?? "A Dood", chatId: sent.threadId },
        )
      },
    })
  }
}
