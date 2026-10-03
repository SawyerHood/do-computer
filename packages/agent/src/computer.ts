import { type Sandbox, SandboxEnv } from "@durable-computer/sandbox"
import type { Context } from "@earendil-works/chord"
import {
  defineExtension,
  type Extension,
  type Harness,
  hook,
  section,
  type ToolDiagnostic,
  ToolTask,
} from "@earendil-works/pi-durable"
import { IdentityDoc } from "./docs.ts"
import { MIRROR_FILES, readMirrorChanges, writeMirror } from "./mirror.ts"

/** Tools that can change files, and so the mirror files. */
const FILE_TOOLS = new Set(["bash", "write", "edit"])
/** Tools that change the identity document, after which the mirror files are out of date. */
const IDENTITY_TOOLS = new Set(["set_identity", "memory"])

/** The call runs on one of the user's computers, so it cannot have touched the workspace. */
const elsewhere = (args: Record<string, unknown>) =>
  typeof args.computer === "string" && args.computer !== ""

/** Tools whose failure can be a file that is not there. */
const LOOKUP_TOOLS = new Set(["read", "edit", "bash"])
const NOT_THERE = /no such file|not found|ENOENT/i

/** Whether a call failed because something it expected on the computer is not there. */
function missingFile(
  tool: string,
  result: { content?: unknown; isError?: boolean; diagnostics?: readonly ToolDiagnostic[] },
): boolean {
  if (!LOOKUP_TOOLS.has(tool)) return false
  const errors = (result.diagnostics ?? []).filter((entry) => entry.severity === "error")
  if (result.isError !== true && errors.length === 0) return false
  const said = Array.isArray(result.content)
    ? result.content.flatMap((block: { type?: string; text?: string }) =>
        block.type === "text" && typeof block.text === "string" ? [block.text] : [],
      )
    : []
  return [...said, ...errors.map((entry) => entry.message)].some((text) => NOT_THERE.test(text))
}

const day = (at: number) => new Date(at).toISOString().slice(0, 10)

/** The name both of these extensions are installed under, whichever computer they are for. */
export const COMPUTER_EXTENSION = "dc.computer"

function describe(sandbox: Sandbox, movedAt: number | undefined): string {
  const lines = [
    `You have your own computer. Your workspace is ${sandbox.home}; files there persist between conversations. Use the read, write, edit and bash tools to work in it.`,
  ]
  if (movedAt !== undefined) {
    // Otherwise it would go looking for files it remembers making, on a machine that never had them.
    lines.push(
      `The user moved you to this computer on ${day(movedAt)}. What you made on a different computer before then stayed there and is not here. When a file you remember is missing, that is the reason: tell the user it is on the computer you had before, and offer to make it again, instead of treating it as lost.`,
    )
  }
  if (!sandbox.capabilities.realBinaries) {
    lines.push(
      "This computer is a lightweight shell: the usual text tools work (ls, cat, grep, sed, awk, jq, find and so on), but there are no real programs such as git, package managers, compilers or a browser. If a task needs one of those, say so instead of working around it.",
    )
  }
  lines.push(
    sandbox.capabilities.network
      ? sandbox.capabilities.realBinaries
        ? "It has internet access."
        : "It has internet access through curl, which is how to fetch a page, call an API or download a file from here."
      : "It has no network access.",
  )
  lines.push(
    `${MIRROR_FILES.join(", ")} in the workspace mirror who you are and what you remember. Editing them changes your identity and memory, and the same limits apply as for the memory tool.`,
  )
  return lines.join("\n")
}

/**
 * Stands where the computer would, for an agent that has none but still has the file and shell
 * tools, for the user's own computers. Without it the agent would learn that from a failed call.
 */
export const WithoutComputer: Extension = defineExtension({
  name: COMPUTER_EXTENSION,
  sections: [
    section(
      "computer",
      () =>
        "You have no computer of your own. The read, write, edit and bash tools work only on a computer the user has connected, named in `computer`, and fail without one. If none is listed here, you cannot keep files or run commands: say so when a task needs that, and that the user can give you a computer on your page in the app.",
    ),
  ],
})

/**
 * The agent's computer as a pi-durable extension: its description in the prompt, and hooks that
 * keep the identity files in the workspace and the identity document in step.
 */
export class Computer {
  readonly sandbox: Sandbox
  /** Installed next to the file and shell tools, which it expects to be there. */
  readonly extension: Extension
  /** When the agent was moved here from another computer, if it was. It is told, in its prompt. */
  movedAt: number | undefined
  /** The workspace files may not reflect the document; rewritten before the next tool runs. */
  #stale = true
  #harness: Harness | undefined
  /** What the identity files held when they were last written or read. */
  #written: Partial<Record<(typeof MIRROR_FILES)[number], string>> | undefined
  /** The write of the identity files that is under way, if one is. */
  #refreshing: Promise<void> | undefined

  constructor(sandbox: Sandbox) {
    this.sandbox = sandbox
    this.extension = defineExtension({
      name: COMPUTER_EXTENSION,
      sections: [section("computer", () => describe(sandbox, this.movedAt))],
      hooks: [
        hook(ToolTask, {
          beforeTool: async (call, _api, context) => {
            if (elsewhere(call.arguments)) return undefined
            if (FILE_TOOLS.has(call.name) || call.name === "read") {
              // A computer that cannot be reached fails the tool itself, with the reason. Failing
              // here instead would report the call as blocked, which it is not. It is still a
              // failure, though, and one nobody would see if it were only swallowed.
              await this.#refresh(context).catch((error) => this.onProblem(error))
            }
            return undefined
          },
          afterTool: async (call, result, _api, context) => {
            if (IDENTITY_TOOLS.has(call.name)) this.#stale = true
            if (elsewhere(call.arguments)) return undefined
            const added: ToolDiagnostic[] = []
            if (this.movedAt !== undefined && missingFile(call.name, result)) {
              // Said here as well as in the prompt: next to the failure is where it is heeded.
              added.push({
                severity: "info",
                message: `The user moved you to this computer on ${day(this.movedAt)}, and what you had made before then stayed on the one you left. If that is why this is missing, tell the user so and offer to make it again here; it was not lost.`,
              })
            }
            if (FILE_TOOLS.has(call.name)) {
              // If the computer cannot be read, the tool's own result already says so.
              const problems = await this.#absorb(context).catch((error) => {
                this.onProblem(error)
                return []
              })
              added.push(...problems.map((message) => ({ severity: "error" as const, message })))
            }
            if (added.length === 0) return undefined
            return { ...result, diagnostics: [...(result.diagnostics ?? []), ...added] }
          },
        }),
      ],
    })
  }

  /**
   * Whether an edit to the mirror files may change the agent's memory and identity right now.
   * The files are another way to do what the memory and identity tools do, so they follow the
   * same rule.
   */
  identityEditable: (context: Context) => Promise<boolean> = async () => true

  /** Told when the identity files could not be written to or read from the computer. */
  onProblem: (error: unknown) => void = () => {}

  /** The harness whose identity document the files mirror. Set once it is open. */
  attach(harness: Harness): void {
    this.#harness = harness
  }

  /** Call after the identity document changed outside a tool, for example from the settings page. */
  markStale(): void {
    this.#stale = true
  }

  env(cwd: string | undefined): SandboxEnv {
    return new SandboxEnv(this.sandbox, cwd)
  }

  /** Write the document's current content into the workspace files, if they may be out of date. */
  async #refresh(context: Context): Promise<void> {
    // Tools of one round start together. They all wait for the one write, or the first would
    // mark the files fresh and the rest would run before the files exist.
    if (this.#refreshing !== undefined) return this.#refreshing
    if (!this.#stale || this.#harness === undefined) return
    const harness = this.#harness
    this.#refreshing = (async () => {
      const identity = await harness.snapshot(IdentityDoc, context)
      if (identity === undefined) return
      this.#stale = false
      try {
        this.#written = await writeMirror(this.sandbox, identity)
      } catch (error) {
        this.#stale = true
        throw error
      }
    })().finally(() => {
      this.#refreshing = undefined
    })
    return this.#refreshing
  }

  /** Take edits the agent made to the workspace files into the document. Returns refused edits. */
  async #absorb(context: Context): Promise<readonly string[]> {
    const harness = this.#harness
    if (harness === undefined) return []
    const identity = await harness.snapshot(IdentityDoc, context)
    if (identity === undefined) return []
    const { change, problems, seen } = await readMirrorChanges(
      this.sandbox,
      identity,
      this.#written,
    )
    // What is there now is what a later edit is measured against.
    this.#written = { ...this.#written, ...seen }
    if (Object.keys(change).length > 0) {
      if (!(await this.identityEditable(context))) {
        // Editing the files would be a way around the rule on the tools that do the same thing.
        this.#stale = true
        await this.#refresh(context)
        return [
          ...problems,
          "Your memory and identity files were put back as they were: the user has limited changes to them. Use the memory or set_identity tool, which asks them first.",
        ]
      }
      await harness.commit(async (tx) => {
        Object.assign(await tx.doc(IdentityDoc), change)
      }, context)
    }
    if (problems.length > 0) {
      // Put the refused files back to what is actually stored.
      this.#stale = true
      await this.#refresh(context)
    }
    return problems
  }
}
