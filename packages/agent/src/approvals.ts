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
import { ChatsDoc } from "./docs.ts"
import { ComputersDoc } from "./paired.ts"

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

/** Tools worth a rule of their own: the ones that change something. */
const TOOL_SUBJECTS: Record<string, string> = {
  bash: "Run commands",
  write: "Create and overwrite files",
  edit: "Edit files",
  send_file: "Send you files",
  schedule: "Create and change automations",
  skill: "Save and change skills",
  memory: "Change what it remembers",
}

/** What the other built-in tools do, for naming a request that a computer's rule raised. */
const OTHER_TOOLS: Record<string, string> = {
  read: "Read files",
  history: "Search your chats",
  set_identity: "Change its name and look",
}

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
  /** Called when the agent has asked for something, to tell the user wherever they are. */
  readonly onRequest?: (request: ApprovalRequest) => void
}

/**
 * Opt-in limits on what the agent does without asking. With no rules, which is the default, the
 * agent is fully trusted and this does nothing. A rule can be set for a tool, for a connector, or
 * for one of the user's own computers: allow, ask first, or never.
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
  ): Promise<{ subjects: ApprovalSubject[]; title: string }> {
    const subjects: ApprovalSubject[] = []
    let title = TOOL_SUBJECTS[call.name] ?? OTHER_TOOLS[call.name] ?? `Use ${call.name}`
    const connector = await this.#options.connectorOf(call.name, context)
    if (connector !== undefined) {
      subjects.push({
        id: `connector:${connector.id}`,
        label: `Use ${connector.name}`,
        kind: "connector",
      })
      title = `Use ${connector.name}`
    } else {
      subjects.push({
        id: `tool:${call.name}`,
        label: TOOL_SUBJECTS[call.name] ?? `Use ${call.name}`,
        kind: "tool",
      })
    }
    const target = (call.arguments as { computer?: unknown }).computer
    if (typeof target === "string" && target.trim() !== "") {
      const computers = (await this.#require().snapshot(ComputersDoc, context))?.computers ?? {}
      const wanted = target.trim().toLowerCase()
      const match = Object.entries(computers).find(
        ([id, computer]) => computer.name.toLowerCase() === wanted || id === target,
      )
      // An unknown name fails in the tool itself; there is nothing to protect.
      if (match !== undefined) {
        subjects.push({
          id: `computer:${match[0]}`,
          label: `Work on ${match[1].name}`,
          kind: "computer",
        })
        title = `${title} on ${match[1].name}`
      }
    }
    return { subjects, title }
  }

  async #check(
    call: ToolCall,
    chatId: string,
    context: Context,
  ): Promise<{ block: string } | undefined> {
    const harness = this.#require()
    const state = await harness.snapshot(ApprovalsDoc, context)
    // No rules: nothing to look up, which is every call on a default agent.
    if (state === undefined || Object.keys(state.rules).length === 0) return undefined
    const { subjects, title: what } = await this.#subjects(call, context)
    const governed = subjects.filter((subject) => (state.rules[subject.id] ?? "allow") !== "allow")
    const decision = strictest(governed.map((subject) => state.rules[subject.id]!))
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

  async pending(context: Context): Promise<ApprovalRequest[]> {
    const harness = this.#require()
    const state = await harness.snapshot(ApprovalsDoc, context)
    const chats = (await harness.snapshot(ChatsDoc, context))?.chats ?? {}
    return Object.entries(state?.requests ?? {})
      .filter(([, request]) => request.status === "pending")
      .map(([id, request]) => ({
        id,
        chatId: request.chatId,
        chatTitle: chats[request.chatId]?.title ?? "A chat",
        chatKind: chats[request.chatId]?.kind ?? "chat",
        title: request.title,
        detail: request.detail,
        createdAt: request.createdAt,
      }))
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Everything a rule can be set for right now, with the rules that are set. */
  async state(context: Context): Promise<ApprovalsState> {
    const harness = this.#require()
    const state = await harness.snapshot(ApprovalsDoc, context)
    const computers = (await harness.snapshot(ComputersDoc, context))?.computers ?? {}
    const subjects: ApprovalSubject[] = [
      ...Object.entries(TOOL_SUBJECTS).map(([name, label]): ApprovalSubject => ({
        id: `tool:${name}`,
        label,
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
   */
  async resolve(id: string, decision: ApprovalDecision, context: Context): Promise<void> {
    if (decision !== "once" && decision !== "always" && decision !== "deny") {
      throw new ApprovalError("The answer is one of: once, always, deny.")
    }
    const harness = this.#require()
    const now = this.#options.now()
    const request = await harness.commit(async (tx) => {
      const doc = await tx.doc(ApprovalsDoc)
      const found = doc.requests[id]
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
    const note =
      decision === "deny"
        ? `<meta kind="approval">The user said no to this. Do not do it, and do not do the same thing another way. Carry on without it, or ask what they would prefer.</meta>`
        : `<meta kind="approval">The user approved this${
            decision === "always" ? ", and you no longer need to ask for it" : ""
          }. Do it now, exactly as you asked, and carry on with what you were doing.</meta>`
    await conversation.submit(
      {
        type: "input",
        requestId: `approval:${id}`,
        content: [
          { type: "text", text: `${decision === "deny" ? "Not allowed" : "Approved"}: ${what}` },
          { type: "text", text: note },
        ],
        whenBusy: "steer",
      },
      context,
    )
  }
}
