import { computerSandbox } from "@durable-computer/computers"
import type { ActorNamespace } from "@durable-computer/runtime"
import { SandboxEnv } from "@durable-computer/sandbox"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  defineDoc,
  defineExtension,
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

type ComputersState = { computers: Record<string, PairedComputer> }

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
  #harness: Harness | undefined

  constructor(links: ActorNamespace) {
    this.#links = links
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
      sections: [
        section("computers", async (input, context) => {
          const computers = Object.values(
            (await input.read.snapshot(ComputersDoc, context))?.computers ?? {},
          )
          if (computers.length === 0) return undefined
          const lines = computers
            .sort((a, b) => (a.name < b.name ? -1 : 1))
            .map(
              (computer) =>
                `- ${computer.name}: ${computer.platform}, home ${computer.home}${computer.readOnly ? ", read-only (you can read files there but not run commands or change anything)" : ""}`,
            )
          return `The user has connected these computers of their own. To work on one, pass its name as \`computer\` to read, write, edit or bash; paths are then relative to its home directory. These are the user's real machines with their real files: be careful, and prefer your own computer unless the task is about theirs.\n${lines.join("\n")}`
        }),
      ],
      wraps: [
        target(createReadTool()),
        target(createWriteTool()),
        target(createEditTool()),
        target(createBashTool()),
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
      const { computers } = await tx.doc(ComputersDoc)
      const taken = new Set(
        Object.entries(computers)
          .filter(([other]) => other !== id)
          .map(([, other]) => other.name.toLowerCase()),
      )
      let name = computer.name
      for (let suffix = 2; taken.has(name.toLowerCase()); suffix++)
        name = `${computer.name}-${suffix}`
      const stored = { ...computer, name }
      computers[id] = stored
      return stored
    }, context)
  }

  async remove(id: string, context: Context): Promise<void> {
    await this.#require().commit(async (tx) => {
      delete (await tx.doc(ComputersDoc)).computers[id]
    }, context)
  }
}
