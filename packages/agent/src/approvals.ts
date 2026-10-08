import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRule,
  ApprovalsState,
  ApprovalSubject,
} from "@durable-computer/protocol"
import type { Context } from "@earendil-works/chord"
import type { ToolCall } from "@earendil-works/pi-ai"
import {
  type ConversationId,
  defineDoc,
  defineExtension,
  type Extension,
  type Harness,
  hook,
  ToolTask,
} from "@earendil-works/pi-durable"
import { type Caller, sentMeta } from "./caller.ts"
import { ChatsDoc } from "./docs.ts"
import { ComputersDoc } from "./computers.ts"
import { own } from "./own.ts"
import { formatTime } from "./schedule.ts"

/** How long an "allow once" waits for the agent to use it. */
const GRANT_TTL_MS = 15 * 60_000
/** Answered requests kept for the record. */
const MAX_RESOLVED = 50
const MAX_DETAIL = 600

type StoredRequest = {
  chatId: string
  /** The tool call that raised it, so a retried call does not ask twice. */
  callKey: string
  subjects: string[]
  title: string
  detail: string
  status: "pending" | "approved" | "denied"
  /** Who it is for, where it is asked because they are not one of the agent's people. */
  guest?: string
  createdAt: number
  resolvedAt: number | null
}

type Grant = { chatId: string; subjects: string[]; expiresAt: number }

type State = {
  rules: Record<string, ApprovalRule>
  requests: Record<string, StoredRequest>
  /** Passes for one use each, from "allow once". */
  grants: Record<string, Grant>
}

/** The agent's approval rules, what it has asked for, and what it has been let through once. */
export const ApprovalsDoc = defineDoc<State>({
  kind: "dc.approvals",
  version: 1,
  scope: "session",
  initial: () => ({ rules: {}, requests: {}, grants: {} }),
})

export class ApprovalError extends Error {}

/**
 * What a rule can be set for among the agent's own abilities, and the tools each one is made of.
 * A rule is about what happens, not which tool does it: tools that can do the same thing answer
 * to the same rule, or the rule would only stop the agent that did not think of the other tool.
 */
const ABILITIES: readonly { id: string; label: string; hint?: string; tools: string[] }[] = [
  { id: "tool:bash", label: "Run commands", tools: ["bash"] },
  {
    id: "tool:files",
    label: "Create and change files",
    hint: "Also applies to running commands and to copying a file from the library, since both can change files.",
    tools: ["write", "edit"],
  },
  { id: "tool:send_file", label: "Send you files", tools: ["send_file"] },
  { id: "tool:web_search", label: "Search the web", tools: ["web_search"] },
  { id: "tool:schedule", label: "Create and change automations", tools: ["schedule"] },
  { id: "tool:skill", label: "Save and change skills", tools: ["skill"] },
  {
    id: "tool:memory",
    label: "Change its memory and identity",
    tools: ["memory", "set_identity"],
  },
]
/** What each built-in tool does, for naming a request. */
const TOOL_TITLES: Record<string, string> = {
  bash: "Run commands",
  write: "Create or overwrite a file",
  edit: "Edit a file",
  read: "Read files",
  send_file: "Send you a file",
  web_search: "Search the web",
  schedule: "Create or change an automation",
  skill: "Save or change a skill",
  memory: "Change what it remembers",
  set_identity: "Change its name and look",
  history: "Search your chats",
  library: "Use your library",
  computers: "See your computers, and ask to use one",
}

/** The abilities a call exercises: its own, and any it could stand in for. */
function abilitiesOf(call: ToolCall): string[] {
  const ids = ABILITIES.filter((ability) => ability.tools.includes(call.name)).map(
    (ability) => ability.id,
  )
  const copiesFile =
    call.name === "library" && (call.arguments as { action?: unknown }).action === "get"
  // A command can write any file, and so can a copy out of the library.
  if (call.name === "bash" || copiesFile) ids.push("tool:files")
  // A tool with no ability of its own can still be given a rule by name.
  return ids.length > 0 ? ids : [`tool:${call.name}`]
}

/** The tools that always run on a computer, whether or not the call names one. */
const COMPUTER_TOOLS = new Set(["bash", "read", "write", "edit", "send_file"])
const usesComputer = (call: ToolCall) =>
  COMPUTER_TOOLS.has(call.name) ||
  (call.name === "library" && (call.arguments as { action?: unknown }).action === "get")

const RULES: readonly ApprovalRule[] = ["allow", "ask", "deny"]
const strictest = (rules: readonly ApprovalRule[]): ApprovalRule =>
  rules.includes("deny") ? "deny" : rules.includes("ask") ? "ask" : "allow"

/** The part of a call's arguments a person would want to see before saying yes. */
function describe(args: Record<string, unknown>): string {
  const { computer: _computer, ...rest } = args
  const lead = ["command", "path", "prompt", "content"].find((key) => typeof rest[key] === "string")
  const text =
    lead !== undefined && Object.keys(rest).length <= 2
      ? String(rest[lead])
      : Object.keys(rest).length === 0
        ? ""
        : JSON.stringify(rest, null, 1)
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text
}

export type ApprovalsOptions = {
  readonly now: () => number
  /** The connector a tool belongs to, if it is a connector's tool. */
  readonly connectorOf: (
    toolName: string,
    context: Context,
  ) => Promise<{ id: string; name: string } | undefined>
  /** The connectors and what they are called, for listing subjects. */
  readonly connectors: (context: Context) => Promise<{ id: string; name: string }[]>
  /**
   * The computer a call would run on: the one it names, or the one it means by naming none.
   * Undefined where there is no such computer.
   */
  readonly computerOf?: (
    name: string | undefined,
    context: Context,
  ) => Promise<{ id: string; name: string; paired?: boolean } | undefined>
  /**
   * Who a chat is working for, by name, where that is someone who is not one of the agent's
   * people, such as someone who wrote to it in Slack. For them a connector, or a computer one
   * of its people paired, is asked about first, whatever the rules say.
   */
  readonly guest?: (chatId: string, context: Context) => Promise<string | undefined>
  /** Called when the agent has asked for something, to tell the user wherever they are. */
  readonly onRequest?: (request: ApprovalRequest) => void
}

/**
 * Opt-in limits on what the agent does without asking. With no rules, which is the default, the
 * agent is fully trusted and this does nothing. A rule can be set for a tool, for a connector, or
 * for one of the user's own computers: allow, ask first, or never.
 *
 * One limit is not opt-in. Work done for someone who is not one of the agent's people asks before
 * it uses a connector or a paired computer: those are its people's, and act as them.
 *
 * "Ask" does not hold the agent's work open while the user is away. The call is refused with an
 * explanation, the request is shown to the user, and their answer is sent to the chat, where an
 * approval lets the agent's next attempt through.
 */
export class Approvals {
  readonly #options: ApprovalsOptions
  readonly extension: Extension
  #harness: Harness | undefined

  constructor(options: ApprovalsOptions) {
    this.#options = options
    this.extension = defineExtension({
      name: "dc.approvals",
      hooks: [
        hook(ToolTask, {
          beforeTool: (call, api, context) =>
            this.#check(call, String(api.conversationId), context),
        }),
      ],
    })
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  #require(): Harness {
    if (this.#harness === undefined) throw new Error("Approvals are not attached to a harness")
    return this.#harness
  }

  /** What a call touches, as subjects rules can be set for, and what to call it when asking. */
  async #subjects(
    call: ToolCall,
    context: Context,
  ): Promise<{ subjects: ApprovalSubject[]; title: string; theirs: Set<string> }> {
    const subjects: ApprovalSubject[] = []
    // The subjects that are the agent's people's own: a connector, and a computer they paired.
    const theirs = new Set<string>()
    let title = TOOL_TITLES[call.name] ?? `Use ${call.name}`
    const connector = await this.#options.connectorOf(call.name, context)
    if (connector !== undefined) {
      subjects.push({
        id: `connector:${connector.id}`,
        label: `Use ${connector.name}`,
        kind: "connector",
      })
      theirs.add(`connector:${connector.id}`)
      title = `Use ${connector.name}`
    } else {
      for (const id of abilitiesOf(call)) {
        const ability = ABILITIES.find((entry) => entry.id === id)
        subjects.push({ id, label: ability?.label ?? `Use ${call.name}`, kind: "tool" })
      }
    }
    const target = (call.arguments as { computer?: unknown }).computer
    const named = typeof target === "string" && target.trim() !== ""
    // A call that names no computer still runs on one, where it is a tool that works on them.
    if (named || usesComputer(call)) {
      const match = await this.#options.computerOf?.(
        named ? (target as string) : undefined,
        context,
      )
      // An unknown name fails in the tool itself; there is nothing to protect.
      if (match !== undefined) {
        subjects.push({
          id: `computer:${match.id}`,
          label: `Work on ${match.name}`,
          kind: "computer",
        })
        if (match.paired === true) theirs.add(`computer:${match.id}`)
        // Said where the call says it: a call that names none means the one machine there is.
        if (named) title = `${title} on ${match.name}`
      }
    }
    return { subjects, title, theirs }
  }

  async #check(
    call: ToolCall,
    chatId: string,
    context: Context,
  ): Promise<{ block: string } | undefined> {
    const harness = this.#require()
    const state = await harness.snapshot(ApprovalsDoc, context)
    const guest = await this.#options.guest?.(chatId, context)
    // No rules: nothing to look up, which is every call on a default agent.
    if (guest === undefined && (state === undefined || Object.keys(state.rules).length === 0)) {
      return undefined
    }
    const { subjects, title: what, theirs } = await this.#subjects(call, context)
    const set = (subject: ApprovalSubject) => own(state?.rules, subject.id) ?? "allow"
    // Asked on the guest's account alone: no rule of the user's own asks for it.
    const forGuest = (subject: ApprovalSubject) =>
      guest !== undefined && set(subject) === "allow" && theirs.has(subject.id)
    const ruleOf = (subject: ApprovalSubject): ApprovalRule =>
      forGuest(subject) ? "ask" : set(subject)
    const governed = subjects.filter((subject) => ruleOf(subject) !== "allow")
    const decision = strictest(governed.map(ruleOf))
    if (decision === "allow") return undefined
    if (decision === "deny") {
      return {
        block: `The user has switched this off (${what}). Do not look for another way to do the same thing. If it matters, tell them it is switched off in your Permissions.`,
      }
    }

    const asking = governed.map((subject) => subject.id).sort()
    const callKey = `${call.name}:${JSON.stringify(call.arguments)}`
    const now = this.#options.now()
    const outcome = await harness.commit(async (tx) => {
      const doc = await tx.doc(ApprovalsDoc)
      for (const [id, grant] of Object.entries(doc.grants)) {
        if (grant.expiresAt <= now) delete doc.grants[id]
      }
      // A pass from "allow once" covers this call if it covers everything this call asks about.
      const pass = Object.entries(doc.grants).find(
        ([, grant]) =>
          grant.chatId === chatId && asking.every((subject) => grant.subjects.includes(subject)),
      )
      if (pass !== undefined) {
        delete doc.grants[pass[0]]
        return { allowed: true as const }
      }
      // The same call again, by a retry or an impatient model, is the same question.
      const existing = Object.entries(doc.requests).find(
        ([, request]) =>
          request.status === "pending" && request.chatId === chatId && request.callKey === callKey,
      )
      if (existing !== undefined) return { allowed: false as const, id: existing[0], isNew: false }
      const id = `a${crypto.randomUUID().slice(0, 8)}`
      doc.requests[id] = {
        chatId,
        callKey,
        subjects: asking,
        title: what,
        detail: describe(call.arguments as Record<string, unknown>),
        status: "pending",
        ...(guest !== undefined && governed.some(forGuest) ? { guest } : {}),
        createdAt: now,
        resolvedAt: null,
      }
      return { allowed: false as const, id, isNew: true }
    }, context)
    if (outcome.allowed) return undefined
    if (outcome.isNew) {
      const request = (await this.pending(context)).find((entry) => entry.id === outcome.id)
      if (request !== undefined) this.#options.onRequest?.(request)
    }
    return {
      block: `This needs the user's approval first (${what}), and they have now been asked. Stop here: do not try it again and do not look for another way to do the same thing. Tell the user in a sentence what you want to do and why, then wait. You will be told when they have answered.`,
    }
  }

  /** The rule set for one subject. `allow` when there is none. */
  async ruleFor(subject: string, context: Context): Promise<ApprovalRule> {
    const state = await this.#require().snapshot(ApprovalsDoc, context)
    return own(state?.rules, subject) ?? "allow"
  }

  async pending(context: Context): Promise<ApprovalRequest[]> {
    const harness = this.#require()
    const state = await harness.snapshot(ApprovalsDoc, context)
    const chats = (await harness.snapshot(ChatsDoc, context))?.chats ?? {}
    return Object.entries(state?.requests ?? {})
      .filter(([, request]) => request.status === "pending")
      .map(([id, request]) => ({
        id,
        chatId: request.chatId,
        chatTitle: own(chats, request.chatId)?.title ?? "A chat",
        chatKind: own(chats, request.chatId)?.kind ?? "chat",
        title: request.title,
        detail: request.detail,
        ...(request.guest === undefined ? {} : { guest: request.guest }),
        createdAt: request.createdAt,
      }))
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Take back what a chat asked for and was not answered, when its work has been stopped. */
  async withdraw(chatId: string, context: Context): Promise<void> {
    const now = this.#options.now()
    await this.#require().commit(async (tx) => {
      const doc = await tx.doc(ApprovalsDoc)
      for (const request of Object.values(doc.requests)) {
        if (request.chatId !== chatId || request.status !== "pending") continue
        request.status = "denied"
        request.resolvedAt = now
      }
    }, context)
  }

  /** Everything a rule can be set for right now, with the rules that are set. */
  async state(context: Context): Promise<ApprovalsState> {
    const harness = this.#require()
    const state = await harness.snapshot(ApprovalsDoc, context)
    const computers = (await harness.snapshot(ComputersDoc, context))?.computers ?? {}
    const subjects: ApprovalSubject[] = [
      ...ABILITIES.map(({ id, label, hint }): ApprovalSubject => ({
        id,
        label,
        ...(hint === undefined ? {} : { hint }),
        kind: "tool",
      })),
      ...(await this.#options.connectors(context)).map((connector): ApprovalSubject => ({
        id: `connector:${connector.id}`,
        label: `Use ${connector.name}`,
        kind: "connector",
      })),
      ...Object.entries(computers).map(([id, computer]): ApprovalSubject => ({
        id: `computer:${id}`,
        label: `Work on ${computer.name}`,
        kind: "computer",
      })),
    ]
    return { rules: { ...state?.rules }, subjects, pending: await this.pending(context) }
  }

  /** Set rules by subject id. `allow` removes a rule, since allowing is the default. */
  async setRules(change: Record<string, unknown>, context: Context): Promise<ApprovalsState> {
    for (const [subject, rule] of Object.entries(change)) {
      if (!/^(tool|connector|computer):[\w.-]{1,80}$/.test(subject)) {
        throw new ApprovalError(`"${subject}" is not something a rule can be set for.`)
      }
      if (!RULES.includes(rule as ApprovalRule)) {
        throw new ApprovalError(`A rule is one of: ${RULES.join(", ")}.`)
      }
    }
    await this.#require().commit(async (tx) => {
      const doc = await tx.doc(ApprovalsDoc)
      for (const [subject, rule] of Object.entries(change)) {
        if (rule === "allow") delete doc.rules[subject]
        else doc.rules[subject] = rule as ApprovalRule
      }
    }, context)
    return this.state(context)
  }

  /**
   * Record the user's answer and tell the agent, in the chat it asked from. An approval lets its
   * next attempt at the same kind of thing through; "always" also lifts the rules that asked.
   * Where a team shares the agent, `by` is whoever answered: anyone in the team may, and the
   * agent and the others are told who did.
   */
  async resolve(
    id: string,
    decision: ApprovalDecision,
    context: Context,
    by?: Caller,
  ): Promise<void> {
    if (decision !== "once" && decision !== "always" && decision !== "deny") {
      throw new ApprovalError("The answer is one of: once, always, deny.")
    }
    const harness = this.#require()
    const now = this.#options.now()
    const request = await harness.commit(async (tx) => {
      const doc = await tx.doc(ApprovalsDoc)
      const found = own(doc.requests, id)
      if (found === undefined || found.status !== "pending") return undefined
      found.status = decision === "deny" ? "denied" : "approved"
      found.resolvedAt = now
      if (decision !== "deny") {
        doc.grants[id] = {
          chatId: found.chatId,
          subjects: [...found.subjects],
          expiresAt: now + GRANT_TTL_MS,
        }
      }
      if (decision === "always") for (const subject of found.subjects) delete doc.rules[subject]
      // Keep a short record of what was answered; drop the oldest beyond it.
      const resolved = Object.entries(doc.requests)
        .filter(([, entry]) => entry.status !== "pending")
        .sort(([, a], [, b]) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
      for (const [old] of resolved.slice(MAX_RESOLVED)) delete doc.requests[old]
      return { chatId: found.chatId, title: found.title, detail: found.detail }
    }, context)
    if (request === undefined) throw new ApprovalError("That request has already been answered.")

    const conversation = await harness.conversation(
      Number(request.chatId) as ConversationId,
      context,
    )
    if (conversation === undefined) return
    const what = request.detail === "" ? request.title : `${request.title}: ${request.detail}`
    // Their name is in the note that follows, where it cannot be taken for part of this one.
    const who = by === undefined ? "The user" : "The person named below"
    const note =
      decision === "deny"
        ? `<meta kind="approval">${who} said no to this. Do not do it, and do not do the same thing another way. Carry on without it, or ask what they would prefer.</meta>`
        : `<meta kind="approval">${who} approved this${
            decision === "always" ? ", and you no longer need to ask for it" : ""
          }. Do it now, exactly as you asked, and carry on with what you were doing.</meta>`
    await conversation.submit(
      {
        type: "input",
        requestId: `approval:${id}`,
        content: [
          { type: "text", text: `${decision === "deny" ? "Not allowed" : "Approved"}: ${what}` },
          { type: "text", text: note },
          ...(by === undefined
            ? []
            : [{ type: "text" as const, text: sentMeta(formatTime(now, null), by) }]),
        ],
        whenBusy: "steer",
      },
      context,
    )
  }
}
