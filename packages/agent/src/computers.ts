import { computerSandbox } from "@do-computer/computers"
import type { ActorNamespace } from "@do-computer/runtime"
import { type Sandbox, SandboxEnv } from "@do-computer/sandbox"
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
  type ToolExecutionResult,
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

/** The kind of a computer someone paired, as opposed to a machine the app made at a provider. */
export const PAIRED = "paired"

/**
 * A computer this agent may use: one somebody paired, or a machine of the agent's workspace. An
 * agent has none of its own. It works on these, and is told about them by its host.
 */
export type AgentComputer = {
  /** What the agent calls it. Unique among the agent's computers. */
  name: string
  /** `paired`, or the kind of machine it is. Absent on one from before there were kinds: paired. */
  kind?: string
  /** What the provider's machine is named after. Absent on a paired computer. */
  machineKey?: string
  platform: string
  hostname: string
  /** The home directory there. On a paired computer relative paths resolve against it. */
  home: string
  /**
   * The agent's own folder on a machine, where its calls start. Absent until it first works
   * there, and on a paired computer, where it starts in the home directory.
   */
  folder?: string
  /** The folders of the other agents that work on the machine, as last heard. */
  neighbors?: string[]
  /**
   * The agent's memory used to be mirrored as files in this machine's home directory. They are
   * still there, and are removed the next time the agent works on it.
   */
  mirrored?: boolean
  readOnly: boolean
  pairedAt: number
}

/**
 * What an agent is told about a paired computer that runs Windows, where neither the paths nor
 * the shell are what it would take them to be.
 */
const WINDOWS_NOTE =
  " (Windows: paths there are written like /c/Users/name for C:\\Users\\name, and commands run in Git Bash where it is installed and in PowerShell where it is not)"

/** Whether a computer is somebody's own machine, reached through its daemon. */
export const isPaired = (computer: Pick<AgentComputer, "kind">) =>
  computer.kind === undefined || computer.kind === PAIRED

/** The files an agent's memory was mirrored into, before it stopped being. */
export const MIRROR_FILES = ["SOUL.md", "IDENTITY.md", "USER.md", "MEMORY.md"] as const

type ComputersState = {
  computers: Record<string, AgentComputer>
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
  /** `paired`, or the kind of machine it is. Absent: paired. */
  kind?: string
  readOnly: boolean
  online: boolean
  /** The agent can work on it already. */
  connected: boolean
  /** The agent asked for it and nobody has answered yet. */
  asked: boolean
  /** A machine this agent added itself, and so may remove. */
  mine?: boolean
}

/** A kind of machine that can be added to the agent's workspace. */
export type AddableKind = { id: string; label: string; description: string }

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
  /**
   * The machines of the agent's workspace that it can use right now. This is how an agent
   * catches up when it was not told of one. Absent where the host has no such machines.
   */
  machines?(agentId: string): Promise<(AgentComputer & { id: string })[]>
  /**
   * The agent's own folder on a machine: chosen the first time it is asked for, after the name
   * the agent goes by then, and the same ever after. Resolves with the other agents' folders
   * there too. Undefined when the agent cannot use that machine.
   */
  folder?(
    agentId: string,
    computerId: string,
    agentName: string | null,
  ): Promise<{ folder: string; neighbors: string[] } | undefined>
  /**
   * Record the machines an agent had to itself from before computers belonged to a workspace.
   * Resolves with the ones it goes on using.
   */
  adopt?(
    agentId: string,
    machines: readonly { kind: string; home: string; current: boolean }[],
    agentName: string | null,
  ): Promise<(AgentComputer & { id: string })[]>
  /** The kinds of machine that can be added to the agent's workspace. Absent: none can. */
  kinds?(agentId: string): Promise<AddableKind[]>
  /**
   * Add a machine to the agent's workspace, for its agents to share, as someone could from the
   * app. `by` is the person the agent is working for when it asks: the machine is theirs to
   * remove. Resolves with the machine, or with why it could not be added.
   */
  add?(
    agentId: string,
    input: { kind?: string; name?: string; by?: string },
  ): Promise<{ id: string; name: string; kind: string } | { error: string }>
  /**
   * Delete a machine this agent added, with everything on it. Resolves with why it could not
   * be done, where it could not.
   */
  remove?(agentId: string, computerId: string): Promise<{ ok: true } | { error: string }>
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

/** The computers the agent can use, keyed by computer id. Maintained by its host. */
export const ComputersDoc = defineDoc<ComputersState>({
  kind: "dc.computers",
  version: 1,
  scope: "session",
  initial: () => ({ computers: {} }),
})

const PARAMETER = Type.Optional(
  Type.String({
    description:
      "Name of the computer to do this on. It can be left out when there is only one machine of your workspace that you can use.",
  }),
)

/** The actor name of a computer's link. */
export const computerActorName = (computerId: string) => `computer:${computerId}`

/** A computer a call runs on, ready to be worked on. */
export type ComputerTarget = {
  readonly id: string
  readonly computer: AgentComputer
  readonly sandbox: Sandbox
  /** Where the call starts: the agent's folder on a machine, the home directory on a paired one. */
  readonly cwd: string
  /** A machine of the workspace, as opposed to somebody's own computer. */
  readonly machine: boolean
}

/** What a tool that runs on a computer runs against. It says which computer. */
export class ComputerEnv extends SandboxEnv {
  readonly target: ComputerTarget

  constructor(target: ComputerTarget) {
    super(target.sandbox, target.cwd)
    this.target = target
  }
}

/** What a tool that runs on a machine of the workspace runs against. */
export class MachineEnv extends ComputerEnv {}

/** Something to do before and after every call that runs on a machine of the workspace. */
export type AroundMachine = {
  before?(tool: string, target: ComputerTarget, context: Context): Promise<void>
  /** Resolves with remarks for the model about the call, if there are any. */
  after?(tool: string, target: ComputerTarget, context: Context): Promise<readonly string[]>
}

export type ComputersOptions = {
  /** Where the links to paired computers live. Without it, none can be used. */
  readonly links?: ActorNamespace
  /**
   * The machine of a kind behind a key, or undefined where there is none to be had. Cheap, and
   * starts nothing until it is used. The same kind and key always lead to the same machine.
   */
  readonly machine?: (kind: string, key: string) => Sandbox | undefined
  /** Other tools that act on a computer and should take the same argument. */
  readonly extraTools?: readonly ToolRegistration[]
  /** Tools that use a computer when there is one to use, and run without one otherwise. */
  readonly optionalTools?: readonly ToolRegistration[]
  /**
   * Where the agent finds computers it is not connected to, and what says whether it may use
   * one. Without it, the agent has only the ones it was given.
   */
  readonly directory?: { agentId: string; lookup: ComputerDirectory }
  readonly around?: AroundMachine
  /** Told when something about a machine could not be put right, which did not fail a call. */
  readonly onProblem?: (error: unknown) => void
  /** The address of the app, where it is known: what a person is sent to. */
  readonly appUrl?: () => string | undefined
}

const fail = (text: string): ToolExecutionResult => ({
  isError: true,
  output: [{ type: "text", text }],
})

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

/**
 * The computers an agent works on. It has none of its own: there are the machines of its
 * workspace, which it may share with other agents, and the computers people paired. Each of the
 * file and shell tools takes a `computer` argument naming one, and the call runs there.
 */
export class Computers {
  readonly extension: Extension
  readonly #options: ComputersOptions
  readonly #directory: { agentId: string; lookup: ComputerDirectory } | undefined
  /** The machines built so far, by computer id, with what each was built from. */
  readonly #machines = new Map<string, { from: string; sandbox: Sandbox }>()
  /** The machines whose folder was seen to since this agent was loaded. */
  readonly #ready = new Set<string>()
  #harness: Harness | undefined

  constructor(options: ComputersOptions) {
    this.#options = options
    this.#directory = options.directory
    const directory = options.directory
    const target = <Tool extends ToolRegistration>(tool: Tool, optional: boolean) =>
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
          const named = typeof computer === "string" && computer.trim() !== ""
          const found = await this.resolve(named ? computer : undefined, context)
          if (typeof found === "string") {
            // It had nothing particular in mind, and can do without.
            if (optional && !named) return inner.execute(rest as never, api, context)
            return fail(found) as never
          }
          const around = found.machine ? options.around : undefined
          await around?.before?.(inner.name, found, context)
          const result = await inner.execute(
            rest as never,
            {
              ...api,
              env: found.machine ? new MachineEnv(found) : new ComputerEnv(found),
            },
            context,
          )
          for (const message of (await around?.after?.(inner.name, found, context)) ?? []) {
            api.diagnostic({ severity: "warn", message })
          }
          return result
        },
      }))
    this.extension = defineExtension({
      name: "dc.computers",
      ...(directory === undefined ? {} : { tools: [this.#tool()] }),
      sections: [
        section("computers", async (input, context) => {
          const state = await input.read.snapshot(ComputersDoc, context)
          return this.#describe(state)
        }),
      ],
      wraps: [
        target(createReadTool(), false),
        target(createWriteTool(), false),
        target(createEditTool(), false),
        target(createBashTool(), false),
        ...(options.extraTools ?? []).map((tool) => target(tool, false)),
        ...(options.optionalTools ?? []).map((tool) => target(tool, true)),
      ],
    })
  }

  /** What the agent is told about where it can work. */
  #describe(state: Readonly<ComputersState> | undefined): string {
    const all = Object.entries(state?.computers ?? {}).sort(([, a], [, b]) =>
      a.name < b.name ? -1 : 1,
    )
    const machines = all.filter(([, computer]) => !isPaired(computer))
    const paired = all.filter(([, computer]) => isPaired(computer))
    const asked = Object.values(state?.asked ?? {}).map((computer) => computer.name)
    const lines: string[] = []
    if (machines.length === 0) {
      lines.push(
        "You have no computer of your own, and there is no machine in your workspace that you can use. The read, write, edit and bash tools work only on a computer named in `computer`, and fail without one. When a task needs files or commands and there is nowhere to run them, " +
          (this.#directory?.lookup.add === undefined
            ? "say so, and that a computer can be added from Computers, in the workspace settings of the app."
            : `say so, and offer to add a machine with the \`${TOOL}\` tool. The person can also add one from Computers, in the workspace settings of the app.`),
      )
    } else {
      lines.push(
        "You have no computer of your own. You work on the machines of your workspace with the read, write, edit and bash tools, and what you leave on one is still there in your next conversation.",
      )
      for (const [id, computer] of machines) {
        const sandbox = this.#sandboxOf(id, computer)
        const able =
          sandbox === undefined
            ? ""
            : `${
                sandbox.capabilities.realBinaries
                  ? " It is a full Linux machine: you can install and run real programs."
                  : " It is a lightweight shell: the usual text tools work (ls, cat, grep, sed, awk, jq, find and so on), but there are no real programs such as git, package managers, compilers or a browser. If a task needs one of those, say so instead of working around it."
              } ${
                sandbox.capabilities.network
                  ? sandbox.capabilities.realBinaries
                    ? "It has internet access."
                    : "It has internet access through curl, which is how to fetch a page, call an API or download a file from there."
                  : "It has no network access."
              }`
        const where =
          computer.folder === undefined
            ? `You get a folder of your own under ${computer.home} the first time you work there, and your calls start in it.`
            : computer.folder === computer.home
              ? `Your calls start in ${computer.home}.`
              : `Your folder there is ${computer.folder}, where your calls start. ${computer.home} is its home directory, which \`~\` stands for.`
        const others =
          computer.neighbors !== undefined && computer.neighbors.length > 0
            ? ` Other agents of your workspace work there too, in ${computer.neighbors.join(", ")}.`
            : ""
        lines.push(`- ${computer.name}: ${where}${others}${able}`)
      }
      lines.push(
        machines.length === 1
          ? `Calls run on ${machines[0]![1].name} unless you name another computer in \`computer\`.`
          : "There is more than one, so say which in `computer` on every call.",
        "A machine may be shared with the other agents of your workspace, each in a folder of its own. Work in yours unless a task is about a path you share, and leave alone the files and the running programs that are not yours.",
      )
    }
    if (paired.length > 0) {
      lines.push(
        `These are computers that people connected, their real machines with their real files. To work on one, pass its name as \`computer\`; paths are then relative to its home directory. Be careful there, and work on a machine of your workspace unless the task is about theirs.\n${paired
          .map(
            ([, computer]) =>
              `- ${computer.name}: ${computer.platform}, home ${computer.home}${computer.platform === "win32" ? WINDOWS_NOTE : ""}${computer.readOnly ? ", read-only (you can read files there but not run commands or change anything)" : ""}`,
          )
          .join("\n")}`,
      )
    }
    // Said only where there is a way to look: which computers there are is the host's to say.
    if (this.#directory !== undefined) {
      lines.push(
        all.length === 0
          ? `The people you work for may have computers you are not connected to: the \`${TOOL}\` tool lists them, and asks whoever one belongs to whether you may use it.`
          : `There may be others you are not connected to: the \`${TOOL}\` tool lists them, and asks whoever one belongs to whether you may use it.`,
      )
      if (this.#directory.lookup.add !== undefined) {
        lines.push(
          `The same tool adds a machine to your workspace when the work needs one that is not there, and tells a person how to connect a computer of their own. A machine costs money to keep, so add one for a reason and say what it is.`,
        )
      }
      if (asked.length > 0) {
        lines.push(
          `You have asked to use ${asked.join(", ")} and have not been answered yet. The answer will reach you as a message; do not ask again.`,
        )
      }
    }
    return lines.join("\n")
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  #require(): Harness {
    if (this.#harness === undefined) throw new Error("Computers are not attached to a harness")
    return this.#harness
  }

  /** The computer as something to run on, or undefined where nothing here can reach it. */
  #sandboxOf(id: string, computer: AgentComputer): Sandbox | undefined {
    if (isPaired(computer)) {
      const links = this.#options.links
      return links === undefined
        ? undefined
        : computerSandbox({ id, home: computer.home, link: links.get(computerActorName(id)) })
    }
    const from = `${computer.kind}:${computer.machineKey ?? ""}`
    const built = this.#machines.get(id)
    if (built?.from === from) return built.sandbox
    const sandbox = this.#options.machine?.(computer.kind!, computer.machineKey ?? "")
    if (sandbox !== undefined) this.#machines.set(id, { from, sandbox })
    return sandbox
  }

  /**
   * The computer a call names, or the one it means by naming none: the only machine of the
   * workspace the agent can use. Somebody's own computer is never meant without being named.
   */
  async #find(
    name: string | undefined,
    context: Context,
  ): Promise<{ id: string; computer: AgentComputer } | string> {
    const computers = Object.entries(
      (await this.#require().snapshot(ComputersDoc, context))?.computers ?? {},
    )
    const names = computers.map(([, computer]) => computer.name)
    if (name === undefined) {
      const machines = computers.filter(([, computer]) => !isPaired(computer))
      if (machines.length === 1) return { id: machines[0]![0], computer: machines[0]![1] }
      if (machines.length > 1) {
        return `You can use more than one machine, so say which in \`computer\`: ${machines.map(([, computer]) => computer.name).join(", ")}.`
      }
      return names.length === 0
        ? `There is no computer for you to work on: your workspace has no machine you can use, and nobody has connected one of theirs. ${
            this.#directory?.lookup.add === undefined
              ? "Tell the user, who can add one from Computers, in the workspace settings of the app."
              : `You can add a machine with the \`${TOOL}\` tool, or the user can from Computers, in the workspace settings of the app.`
          }`
        : `Your workspace has no machine you can use, so name the computer to do this on in \`computer\`: ${names.join(", ")}.`
    }
    const wanted = name.trim().toLowerCase()
    const match = computers.find(
      ([id, computer]) => computer.name.toLowerCase() === wanted || id === name,
    )
    if (match !== undefined) return { id: match[0], computer: match[1] }
    return names.length === 0
      ? `There is no computer named "${name}": there is none you can use.`
      : `There is no computer named "${name}". The computers you can use: ${names.join(", ")}.`
  }

  /**
   * The computer a call would run on, by what the agent has been told and nothing more, for
   * something that only needs to know which one is meant.
   */
  async peek(
    name: string | undefined,
    context: Context,
  ): Promise<{ id: string; name: string } | undefined> {
    const found = await this.#find(name, context)
    return typeof found === "string" ? undefined : { id: found.id, name: found.computer.name }
  }

  /** The computer a call is for, checked and ready to work on, or why there is none. */
  async resolve(name: string | undefined, context: Context): Promise<ComputerTarget | string> {
    let found = await this.#find(name, context)
    // What the agent was told can be behind what is so. Its host knows.
    if (typeof found === "string" && (await this.refresh(context))) {
      found = await this.#find(name, context)
    }
    if (typeof found === "string") return found
    const { id, computer } = found
    if (
      this.#directory !== undefined &&
      !(await this.#directory.lookup.allowed(this.#directory.agentId, id))
    ) {
      // It was taken away and word of that did not arrive. It arrives now.
      await this.remove(id, context)
      return `The computer "${computer.name}" is no longer connected to you. If you still need it, the \`${TOOL}\` tool can ask for it again.`
    }
    const sandbox = this.#sandboxOf(id, computer)
    if (sandbox === undefined) {
      return `The computer "${computer.name}" cannot be reached from here.`
    }
    if (isPaired(computer)) return { id, computer, sandbox, cwd: computer.home, machine: false }
    const settled = await this.#settle(id, computer, sandbox, context)
    return { id, computer: settled, sandbox, cwd: settled.folder ?? settled.home, machine: true }
  }

  /**
   * See that the agent has its folder on a machine: which one it is, and that it is there. The
   * first is asked of the host once. The second is looked at once each time the agent is loaded.
   */
  async #settle(
    id: string,
    computer: AgentComputer,
    sandbox: Sandbox,
    context: Context,
  ): Promise<AgentComputer> {
    let settled = computer
    if (computer.folder === undefined) {
      const ask = this.#directory?.lookup.folder
      const identity = await this.#require().snapshot(IdentityDoc, context)
      const given =
        ask === undefined
          ? undefined
          : await ask.call(
              this.#directory!.lookup,
              this.#directory!.agentId,
              id,
              identity?.name ?? null,
            )
      const folder = given?.folder ?? computer.home
      settled = await this.#require().commit(async (tx) => {
        const kept = own((await tx.doc(ComputersDoc)).computers, id)
        if (kept === undefined) return { ...computer, folder }
        kept.folder ??= folder
        if (given !== undefined) kept.neighbors = given.neighbors
        return { ...kept }
      }, context)
    }
    if (this.#ready.has(id)) return settled
    try {
      const folder = settled.folder ?? settled.home
      if (folder !== settled.home) await sandbox.fs.mkdir(folder, { recursive: true })
      if (settled.mirrored === true) {
        // Its memory is no longer kept in these, and a stale copy would only mislead it.
        if (sandbox.capabilities.realBinaries) {
          await sandbox.exec(
            `rm -f ${MIRROR_FILES.map((file) => quote(`${settled.home}/${file}`)).join(" ")}`,
          )
        } else {
          for (const file of MIRROR_FILES) {
            await sandbox.fs.remove(`${settled.home}/${file}`, { recursive: false, force: true })
          }
        }
        settled = await this.#require().commit(async (tx) => {
          const kept = own((await tx.doc(ComputersDoc)).computers, id)
          if (kept === undefined) return settled
          delete kept.mirrored
          return { ...kept }
        }, context)
      }
      this.#ready.add(id)
    } catch (error) {
      // A machine that cannot be reached fails the call itself, with the reason.
      this.#options.onProblem?.(error)
    }
    return settled
  }

  async list(context: Context): Promise<(AgentComputer & { id: string })[]> {
    const computers = (await this.#require().snapshot(ComputersDoc, context))?.computers ?? {}
    return Object.entries(computers).map(([id, computer]) => ({ id, ...computer }))
  }

  /**
   * Ask the host which machines of the workspace the agent can use, and take that as what is
   * so. Resolves with whether anything changed. Does nothing where the host has none to tell of.
   */
  async refresh(context: Context): Promise<boolean> {
    const ask = this.#directory?.lookup.machines
    if (ask === undefined) return false
    const machines = await ask.call(this.#directory!.lookup, this.#directory!.agentId)
    return this.setMachines(machines, context)
  }

  /**
   * The machines of the workspace that the agent can use, all of them: any it had that are not
   * among these are forgotten. The computers people paired are left as they are. Resolves with
   * whether anything changed.
   */
  async setMachines(
    machines: readonly (AgentComputer & { id: string })[],
    context: Context,
  ): Promise<boolean> {
    const wanted = machines.filter((machine) => !isPaired(machine) && !isInherited(machine.id))
    return this.#require().commit(async (tx) => {
      const state = await tx.doc(ComputersDoc)
      const before = JSON.stringify(state.computers)
      const ids = new Set(wanted.map((machine) => machine.id))
      for (const [id, computer] of Object.entries(state.computers)) {
        if (!isPaired(computer) && !ids.has(id)) delete state.computers[id]
      }
      for (const { id, ...told } of wanted) {
        const kept = own(state.computers, id)
        // A kind whose machine is the agent's alone has a home only the agent can say.
        const machine =
          told.home !== ""
            ? told
            : { ...told, home: this.#sandboxOf(id, told)?.home ?? kept?.home ?? "" }
        const taken = new Set(
          Object.entries(state.computers)
            .filter(([other]) => other !== id)
            .map(([, other]) => other.name.toLowerCase()),
        )
        let name = machine.name
        for (let suffix = 2; taken.has(name.toLowerCase()); suffix++) {
          name = `${machine.name}-${suffix}`
        }
        const folder = machine.folder ?? kept?.folder
        const neighbors = machine.neighbors ?? kept?.neighbors
        const mirrored = machine.mirrored ?? kept?.mirrored
        state.computers[id] = {
          ...machine,
          name,
          pairedAt: kept?.pairedAt ?? machine.pairedAt,
          ...(folder === undefined ? {} : { folder }),
          ...(neighbors === undefined ? {} : { neighbors }),
          ...(mirrored === undefined ? {} : { mirrored }),
        }
        if (state.asked !== undefined) delete state.asked[id]
      }
      return JSON.stringify(state.computers) !== before
    }, context)
  }

  /** Add or replace a computer. A name already used by another computer gets a number appended. */
  async put(id: string, computer: AgentComputer, context: Context): Promise<AgentComputer> {
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
        "See the computers there are for you to work on: the machines of your workspace, and the computers that the people you work for have connected to this app. Ask to use one you cannot use yet. " +
        'action "list" shows each one: what it is called, whose it is, whether it is online, and whether you can use it. "request" needs `name`, a computer from the list, and takes `reason`, a sentence for whoever it belongs to about what you want it for. ' +
        "Asking returns at once and the answer reaches you later as a message, perhaps much later: say that you asked, do not wait or ask again, and carry on with whatever does not need that computer. Once someone says yes, pass the computer's name as `computer` to read, write, edit or bash." +
        (this.#directory?.lookup.add === undefined
          ? ""
          : ' "add" adds a machine to your workspace, for you and its other agents to work on: it takes `name` and `kind`, one of the kinds "list" names. A machine costs money to keep, so add one only when the work needs it. "remove" needs `name` and deletes a machine you added, with everything on it; it cannot be undone. "connect_own" gives you what to tell a person who wants to connect a computer of their own.'),
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("list"),
          Type.Literal("request"),
          Type.Literal("add"),
          Type.Literal("remove"),
          Type.Literal("connect_own"),
        ]),
        name: Type.Optional(
          Type.String({
            description:
              "For request and remove: the computer's name or id, from list. For add: what to call the new machine",
          }),
        ),
        reason: Type.Optional(
          Type.String({ description: "What you want it for, for whoever it belongs to" }),
        ),
        kind: Type.Optional(
          Type.String({
            description: "For add: the kind of machine, from list. Default: the usual one",
          }),
        ),
      }),
      execute: async (args, api, context) => {
        const reply = (text: string) => ({ output: [{ type: "text" as const, text }] })
        const fail = (text: string) => ({ isError: true, ...reply(text) })
        const { agentId, lookup } = this.#directory!
        const chatId = String(api.conversationId)
        const chat = own((await api.snapshot(ChatsDoc, context))?.chats ?? {}, chatId)
        if (args.action === "connect_own") {
          const app = this.#options.appUrl?.()
          return reply(
            `A person connects a computer of their own by running one command on it (macOS or Linux, with Node.js 20 or newer):\n\n${
              app === undefined
                ? 'the command shown under Computers in the workspace settings of the app, at "Connect a computer of your own"'
                : `curl -fsSL ${app}/install.sh | sh`
            }\n\nIt prints a short code and a link. They open the link, check the code, and choose which agents may use the computer: that part is theirs to do, and you cannot do it for them. Until they choose you, ask for it with "request". Give them the command as it is, in a code block.`,
          )
        }
        if (args.action === "add") {
          if (lookup.add === undefined || lookup.kinds === undefined) {
            return fail(
              "A machine cannot be added from here. The user can add one from Computers, in the workspace settings of the app.",
            )
          }
          if (chat?.kind !== "chat") {
            return fail("Only a conversation with the user can add a machine.")
          }
          const kinds = await lookup.kinds(agentId)
          if (kinds.length === 0) {
            return fail(
              'This deployment has no kind of machine that can be added. The user can connect a computer of their own instead: "connect_own" says how.',
            )
          }
          const kind = (args.kind ?? "").trim().toLowerCase()
          if (kind !== "" && !kinds.some((offered) => offered.id === kind)) {
            return fail(
              `There is no kind of machine "${args.kind}". The kinds that can be added: ${kinds.map((offered) => `${offered.id} (${offered.label})`).join(", ")}.`,
            )
          }
          const identity = await api.snapshot(IdentityDoc, context)
          const added = await lookup.add(agentId, {
            ...(kind === "" ? {} : { kind }),
            ...((args.name ?? "").trim() === "" ? {} : { name: args.name!.trim() }),
            by: chat.lastBy ?? chat.createdBy ?? identity?.ownerId,
          })
          if ("error" in added) return fail(added.error)
          await this.refresh(context)
          const mine = (await api.snapshot(ComputersDoc, context))?.computers ?? {}
          const name = own(mine, added.id)?.name ?? added.name
          return {
            ...reply(
              `Added the machine "${name}" (${added.kind}) to the workspace. It is made the first time something runs on it, so your first call there may take a little longer. Pass "${name}" as \`computer\` to read, write, edit or bash.`,
            ),
            details: { computerId: added.id, name, kind: added.kind },
          }
        }
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
          computer.kind !== undefined && computer.kind !== PAIRED
            ? `a machine of ${computer.team ? `the team ${computer.owner}` : `${computer.owner}'s workspace`}`
            : computer.team
              ? `belongs to the team ${computer.owner}`
              : `${computer.owner}'s`
        const kinds = (await lookup.kinds?.(agentId)) ?? []
        const addable =
          lookup.add === undefined || kinds.length === 0
            ? ""
            : `Kinds of machine you can add with "add": ${kinds.map((kind) => `${kind.id} (${kind.label}: ${kind.description})`).join("; ")}`
        if (args.action === "list") {
          if (named.length === 0) {
            return reply(
              `There is no computer: your workspace has no machine, and nobody you work for has connected one of theirs. Either can be done from Computers, in the workspace settings of the app.${addable === "" ? "" : `\n${addable}`}`,
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
                  }${computer.mine === true ? " You added it, and can remove it." : ""}`,
              )
              .concat(addable === "" ? [] : [addable])
              .join("\n"),
          )
        }
        const wanted = (args.name ?? "").trim().toLowerCase()
        if (wanted === "") {
          return fail(`"${args.action}" needs the name of a computer, from "list".`)
        }
        const matches = named.filter(
          (computer) => computer.id === wanted || computer.name.toLowerCase() === wanted,
        )
        if (matches.length === 0) {
          return fail(
            named.length === 0
              ? `There is no computer named "${args.name}": there are none.`
              : `There is no computer named "${args.name}". There are: ${named.map((computer) => computer.name).join(", ")}.`,
          )
        }
        if (matches.length > 1) {
          return fail(
            `More than one computer is called "${args.name}". Say which by its id: ${matches.map((computer) => `${computer.id} (${whose(computer)})`).join(", ")}.`,
          )
        }
        const computer = matches[0]!
        if (args.action === "remove") {
          if (lookup.remove === undefined) {
            return fail(
              "A machine cannot be removed from here. The user can remove it from Computers, in the workspace settings of the app.",
            )
          }
          if (chat?.kind !== "chat") {
            return fail("Only a conversation with the user can remove a machine.")
          }
          if (computer.mine !== true) {
            return fail(
              `You can only remove a machine you added, and "${computer.name}" is not one. Whoever it belongs to can remove it from Computers, in the workspace settings of the app.`,
            )
          }
          const removed = await lookup.remove(agentId, computer.id)
          if ("error" in removed) return fail(removed.error)
          await this.refresh(context)
          return reply(`Deleted the machine "${computer.name}", and everything that was on it.`)
        }
        if (computer.connected) {
          return reply(
            `You can already use "${computer.name}": pass that name as \`computer\` to read, write, edit or bash.`,
          )
        }
        if (chat?.kind !== "chat") {
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
