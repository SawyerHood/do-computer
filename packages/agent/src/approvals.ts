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
  createdAt: number
  resolvedAt: number | null
  /** One of its subjects is asked about every time, so "always" is not an answer. */
  onceOnly?: true
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

type Ability = {
  id: string
  label: string
  hint?: string
  tools: string[]
  /** The actions of those tools it covers. Absent: all of them. */
  actions?: string[]
  /**
   * Asked about until someone says otherwise, where everything else is allowed until someone
   * says otherwise: it spends money, or gives the agent more reach than it had.
   */
  ask?: true
  /** Asked about every time, whatever anyone said: it cannot be undone. No rule can be set. */
  locked?: true
}

/**
 * What a rule can be set for among the agent's own abilities, and the tools each one is made of.
 * A rule is about what happens, not which tool does it: tools that can do the same thing answer
 * to the same rule, or the rule would only stop the agent that did not think of the other tool.
 */
const ABILITIES: readonly Ability[] = [
  {
    id: "tool:bash",
    label: "Run commands",
    hint: "Also applies to an automation's check, a command that is run each time before the agent is started.",
    tools: ["bash"],
  },
  {
    id: "tool:files",
    label: "Create and change files",
    hint: "Also applies to running commands and to copying a file from the library, since both can change files.",
    tools: ["write", "edit"],
  },
  { id: "tool:send_file", label: "Send you files", tools: ["send_file"] },
  { id: "tool:visual", label: "Show you visuals", tools: ["visual"] },
  {
    id: "tool:share",
    label: "Share pages with the workspace",
    hint: "A page of the library, given a link that people in the workspace can open.",
    tools: ["share"],
    actions: ["publish", "private", "stop"],
  },
  {
    id: "tool:share_public",
    label: "Make shared pages public",
    hint: "A public page can be opened by anyone who has its link, without signing in.",
    tools: ["share"],
    actions: ["public"],
    ask: true,
  },
  {
    id: "tool:screen",
    label: "Use a computer's screen",
    hint: "The programs on somebody's own computer, worked in their windows or with its mouse and keyboard, where its owner has switched that on.",
    tools: ["screen"],
  },
  {
    id: "tool:browser",
    label: "Use a browser on a computer",
    hint: "On somebody's own computer: their own Chrome where it lets itself be used, with what they are signed in to.",
    tools: ["browser"],
  },
  { id: "tool:web_search", label: "Search the web", tools: ["web_search"] },
  {
    id: "tool:slack_post",
    label: "Write in Slack unasked",
    hint: "Answering where it is spoken to in Slack is not a part of this.",
    tools: ["slack"],
    actions: ["post"],
  },
  { id: "tool:schedule", label: "Create and change automations", tools: ["schedule"] },
  { id: "tool:skill", label: "Save and change skills", tools: ["skill"] },
  {
    id: "tool:memory",
    label: "Change its memory and identity",
    tools: ["memory", "set_identity"],
  },
  {
    id: "tool:machines",
    label: "Add machines to the workspace",
    hint: "A machine costs money to keep. Removing one always asks first.",
    tools: ["computers"],
    actions: ["add"],
    ask: true,
  },
  {
    id: "tool:machines_remove",
    label: "Remove a machine",
    tools: ["computers"],
    actions: ["remove"],
    locked: true,
  },
  {
    id: "tool:connectors_change",
    label: "Add and change connectors",
    hint: "A connector gives the agent the tools of another service.",
    tools: ["connectors"],
    actions: ["add", "add_apps", "reconnect", "enable", "disable", "remove"],
    ask: true,
  },
  {
    id: "tool:settings_change",
    label: "Change its model and settings",
    tools: ["settings"],
    actions: ["set"],
    ask: true,
  },
  {
    id: "tool:agents_create",
    label: "Make new agents",
    tools: ["agents"],
    actions: ["create"],
    ask: true,
  },
]

const abilityOf = (id: string) => ABILITIES.find((ability) => ability.id === id)

/** The rule for a subject that nobody has set one for. */
const defaultRule = (subject: string): ApprovalRule =>
  abilityOf(subject)?.ask === true || abilityOf(subject)?.locked === true ? "ask" : "allow"

/** The rule a subject answers to: the one set for it, or its default. One that is locked asks. */
const ruleOf = (rules: Readonly<Record<string, ApprovalRule>>, subject: string): ApprovalRule =>
  abilityOf(subject)?.locked === true ? "ask" : (own(rules, subject) ?? defaultRule(subject))

/** What each built-in tool does, for naming a request. */
const TOOL_TITLES: Record<string, string> = {
  bash: "Run commands",
  background: "Look in on commands it left running",
  write: "Create or overwrite a file",
  edit: "Edit a file",
  read: "Read files",
  send_file: "Send you a file",
  visual: "Show you a visual",
  share: "See what is shared",
  web_search: "Search the web",
  schedule: "Create or change an automation",
  skill: "Save or change a skill",
  memory: "Change what it remembers",
  set_identity: "Change its name and look",
  history: "Search your chats",
  library: "Use your library",
  computers: "See your computers, and ask to use one",
  connectors: "See its connectors",
  request_secret: "Ask you for a secret",
  settings: "See its settings",
  agents: "Work with the other agents",
  slack: "Read Slack",
}

const actionOf = (call: ToolCall) => (call.arguments as { action?: unknown }).action

/** Whether a call gives an automation a command to run first, each time its time comes. */
const setsCheck = (call: ToolCall) => {
  const check = (call.arguments as { check?: unknown }).check
  return call.name === "schedule" && typeof check === "string" && check.trim() !== ""
}

/** The abilities a call exercises: its own, and any it could stand in for. */
function abilitiesOf(call: ToolCall): string[] {
  const action = actionOf(call)
  const ids = ABILITIES.filter(
    (ability) =>
      ability.tools.includes(call.name) &&
      (ability.actions === undefined ||
        (typeof action === "string" && ability.actions.includes(action))),
  ).map((ability) => ability.id)
  const copiesFile = call.name === "library" && action === "get"
  // A check is a command the agent leaves to be run when nobody is there.
  if (setsCheck(call)) ids.push("tool:bash")
  // A command can write any file, and so can a copy out of the library.
  if (call.name === "bash" || copiesFile || setsCheck(call)) ids.push("tool:files")
  // A tool with no ability of its own can still be given a rule by name.
  return ids.length > 0 ? ids : [`tool:${call.name}`]
}

const word = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 200) : ""

/**
 * What a call that changes the app is asking to do, in words a person can say yes or no to.
 * Undefined for the rest, which are named after their tool and shown by their arguments.
 */
function asked(call: ToolCall): { title: string; detail: string } | undefined {
  const args = call.arguments as Record<string, unknown>
  const action = actionOf(call)
  const name = word(args.name)
  if (call.name === "computers" && action === "add") {
    const kind = word(args.kind)
    return {
      title: "Add a machine to the workspace",
      detail: [name || "computer", kind === "" ? "" : `(${kind})`].filter(Boolean).join(" "),
    }
  }
  if (call.name === "computers" && action === "remove") {
    return {
      title: `Delete the machine ${name || "it named"}, with everything on it`,
      detail: "",
    }
  }
  if (call.name === "slack" && action === "post") {
    return {
      title: "Write in Slack",
      detail: [word(args.channel), word(args.text)].filter(Boolean).join(": "),
    }
  }
  if (call.name === "connectors" && typeof action === "string") {
    const url = word(args.url)
    if (action === "add") {
      return { title: "Add a connector", detail: [name, url].filter(Boolean).join(": ") }
    }
    if (action === "add_apps") {
      return {
        title: "Add a connector",
        detail: "Apps: your accounts on other services, through Composio",
      }
    }
    const verb: Record<string, string> = {
      reconnect: "Reconnect the connector",
      enable: "Turn on the connector",
      disable: "Turn off the connector",
      remove: "Remove the connector",
    }
    return verb[action] === undefined ? undefined : { title: `${verb[action]} ${name}`, detail: "" }
  }
  if (call.name === "settings" && action === "set") {
    const changes = ["model", "thinking", "when_busy", "timezone"].flatMap((key) =>
      word(args[key]) === "" ? [] : [`${key.replace("_", " ")}: ${word(args[key])}`],
    )
    return { title: "Change its settings", detail: changes.join("\n") }
  }
  if (call.name === "share" && typeof action === "string") {
    const site = word(args.site)
    if (action === "public") {
      return {
        title: "Make a shared page public",
        detail: [site, "Anyone who has the link could open it."].filter(Boolean).join("\n"),
      }
    }
    if (action === "publish") {
      return {
        title: "Share a page with the workspace",
        detail: [word(args.title), word(args.path)].filter(Boolean).join(": "),
      }
    }
    if (action === "private") return { title: "Make a shared page private again", detail: site }
    if (action === "stop") return { title: "Stop sharing a page", detail: site }
  }
  if (call.name === "agents" && action === "create") {
    return {
      title: "Make a new agent",
      detail: [name, word(args.tagline)].filter(Boolean).join(": "),
    }
  }
  return undefined
}

/** The tools that always run on a computer, whether or not the call names one. */
const COMPUTER_TOOLS = new Set([
  "bash",
  "read",
  "write",
  "edit",
  "send_file",
  "request_secret",
  "screen",
  "browser",
])
const usesComputer = (call: ToolCall) =>
  COMPUTER_TOOLS.has(call.name) ||
  setsCheck(call) ||
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
  ) => Promise<{ id: string; name: string } | undefined>
  /** Called when the agent has asked for something, to tell the user wherever they are. */
  readonly onRequest?: (request: ApprovalRequest) => void
}

/** What a sub-agent, a scheduled run or a conversation between agents is called, for the agent. */
const KIND_WORDS: Record<string, string> = {
  schedule: "A scheduled run",
  subagent: "A sub-agent",
  agent: "A conversation with another agent",
  slack: "A conversation in Slack",
}

/**
 * Limits on what the agent does without asking. A rule can be set for a tool, for a connector,
 * or for one of the user's own computers: allow, ask first, or never. With no rules, which is the
 * default, the agent is trusted with everything but the few abilities that ask first until
 * someone says otherwise: the ones that spend money or give it more reach.
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
    let title = asked(call)?.title ?? TOOL_TITLES[call.name] ?? `Use ${call.name}`
    const connector = await this.#options.connectorOf(call.name, context)
    if (connector !== undefined) {
      subjects.push({
        id: `connector:${connector.id}`,
        label: `Use ${connector.name}`,
        kind: "connector",
      })
      title = `Use ${connector.name}`
    } else {
      for (const id of abilitiesOf(call)) {
        subjects.push({ id, label: abilityOf(id)?.label ?? `Use ${call.name}`, kind: "tool" })
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
        // Said where the call says it: a call that names none means the one machine there is.
        if (named) title = `${title} on ${match.name}`
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
    const rules = state?.rules ?? {}
    // No rules, and nothing that asks unless told otherwise: nothing to look up, which is nearly
    // every call on a default agent.
    if (
      Object.keys(rules).length === 0 &&
      abilitiesOf(call).every((id) => defaultRule(id) === "allow")
    ) {
      return undefined
    }
    const { subjects, title: what } = await this.#subjects(call, context)
    const holds = (subject: ApprovalSubject): ApprovalRule => ruleOf(rules, subject.id)
    const governed = subjects.filter((subject) => holds(subject) !== "allow")
    const decision = strictest(governed.map(holds))
    if (decision === "allow") return undefined
    if (decision === "deny") {
      return {
        block: `The user has switched this off (${what}). Do not look for another way to do the same thing. If it matters, tell them it is switched off in your Permissions.`,
      }
    }

    // What changes the app is for a person to ask for, and there is nobody in these to ask.
    const kind = own((await harness.snapshot(ChatsDoc, context))?.chats ?? {}, chatId)?.kind
    if (
      kind !== undefined &&
      kind !== "chat" &&
      governed.some((subject) => defaultRule(subject.id) === "ask")
    ) {
      return {
        block: `${KIND_WORDS[kind] ?? "This conversation"} cannot do this (${what}): it changes the app, and only a conversation with the user can ask for that. Say in your answer what you would have done.`,
      }
    }
    const asking = governed.map((subject) => subject.id).sort()
    const onceOnly = asking.some((subject) => abilityOf(subject)?.locked === true)
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
        detail: asked(call)?.detail ?? describe(call.arguments as Record<string, unknown>),
        status: "pending",
        createdAt: now,
        resolvedAt: null,
        ...(onceOnly ? { onceOnly: true as const } : {}),
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

  /** The rule one subject answers to: the one set for it, or its default. */
  async ruleFor(subject: string, context: Context): Promise<ApprovalRule> {
    const state = await this.#require().snapshot(ApprovalsDoc, context)
    return ruleOf(state?.rules ?? {}, subject)
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
        createdAt: request.createdAt,
        ...(request.onceOnly === true ? { onceOnly: true } : {}),
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
      // One that is asked about every time has no rule to set.
      ...ABILITIES.filter((ability) => ability.locked !== true).map(
        ({ id, label, hint }): ApprovalSubject => ({
          id,
          label,
          ...(hint === undefined ? {} : { hint }),
          kind: "tool",
        }),
      ),
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
    // What is said here is what holds: the rules that were set, and the defaults that ask.
    const rules: Record<string, ApprovalRule> = {}
    for (const id of new Set([...Object.keys(state?.rules ?? {}), ...subjects.map((s) => s.id)])) {
      const rule = ruleOf(state?.rules ?? {}, id)
      if (rule !== "allow") rules[id] = rule
    }
    return { rules, subjects, pending: await this.pending(context) }
  }

  /** Set rules by subject id. A rule that is the subject's default is not kept. */
  async setRules(change: Record<string, unknown>, context: Context): Promise<ApprovalsState> {
    for (const [subject, rule] of Object.entries(change)) {
      if (!/^(tool|connector|computer):[\w.-]{1,80}$/.test(subject)) {
        throw new ApprovalError(`"${subject}" is not something a rule can be set for.`)
      }
      if (!RULES.includes(rule as ApprovalRule)) {
        throw new ApprovalError(`A rule is one of: ${RULES.join(", ")}.`)
      }
      if (abilityOf(subject)?.locked === true) {
        throw new ApprovalError("That is asked about every time, and no rule can be set for it.")
      }
    }
    await this.#require().commit(async (tx) => {
      const doc = await tx.doc(ApprovalsDoc)
      for (const [subject, rule] of Object.entries(change)) {
        if (rule === defaultRule(subject)) delete doc.rules[subject]
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
      if (decision === "always") {
        for (const subject of found.subjects) {
          // Allowed from here on: said outright where the default would ask again.
          if (defaultRule(subject) === "allow") delete doc.rules[subject]
          else if (abilityOf(subject)?.locked !== true) doc.rules[subject] = "allow"
        }
      }
      // Keep a short record of what was answered; drop the oldest beyond it.
      const resolved = Object.entries(doc.requests)
        .filter(([, entry]) => entry.status !== "pending")
        .sort(([, a], [, b]) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
      for (const [old] of resolved.slice(MAX_RESOLVED)) delete doc.requests[old]
      return {
        chatId: found.chatId,
        title: found.title,
        detail: found.detail,
        onceOnly: found.onceOnly === true,
      }
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
            decision === "always" && !request.onceOnly
              ? ", and you no longer need to ask for it"
              : ""
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
