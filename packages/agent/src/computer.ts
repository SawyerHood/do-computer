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
import { CodingTools } from "@earendil-works/pi-durable/tools"
import { IdentityDoc } from "./docs.ts"
import { MIRROR_FILES, readMirrorChanges, writeMirror } from "./mirror.ts"

/** Tools that can change files, and so the mirror files. */
const FILE_TOOLS = new Set(["bash", "write", "edit"])
/** Tools that change the identity document, after which the mirror files are out of date. */
const IDENTITY_TOOLS = new Set(["set_identity", "memory"])

/** The call runs on one of the user's computers, so it cannot have touched the workspace. */
const elsewhere = (args: Record<string, unknown>) =>
  typeof args.computer === "string" && args.computer !== ""

function describe(sandbox: Sandbox): string {
  const lines = [
    `You have your own computer. Your workspace is ${sandbox.home}; files there persist between conversations. Use the read, write, edit and bash tools to work in it.`,
  ]
  if (!sandbox.capabilities.realBinaries) {
    lines.push(
      "This computer is a lightweight shell: the usual text tools work (ls, cat, grep, sed, awk, jq, find and so on), but there are no real programs such as git, package managers, compilers or a browser. If a task needs one of those, say so instead of working around it.",
    )
  }
  if (!sandbox.capabilities.network) lines.push("It has no network access.")
  lines.push(
    `${MIRROR_FILES.join(", ")} in the workspace mirror who you are and what you remember. Editing them changes your identity and memory, and the same limits apply as for the memory tool.`,
  )
  return lines.join("\n")
}

/**
 * The agent's computer as a pi-durable extension: its description in the prompt, and hooks that
 * keep the identity files in the workspace and the identity document in step.
 */
export class Computer {
  readonly sandbox: Sandbox
  readonly extensions: readonly Extension[]
  /** The workspace files may not reflect the document; rewritten before the next tool runs. */
  #stale = true
  #harness: Harness | undefined

  constructor(sandbox: Sandbox) {
    this.sandbox = sandbox
    const sync = defineExtension({
      name: "dc.computer",
      sections: [section("computer", () => describe(sandbox))],
      hooks: [
        hook(ToolTask, {
          beforeTool: async (call, _api, context) => {
            if (elsewhere(call.arguments)) return undefined
            if (FILE_TOOLS.has(call.name) || call.name === "read") {
              // A computer that cannot be reached fails the tool itself, with the reason. Failing
              // here instead would report the call as blocked, which it is not.
              await this.#refresh(context).catch(() => {})
            }
            return undefined
          },
          afterTool: async (call, result, _api, context) => {
            if (IDENTITY_TOOLS.has(call.name)) this.#stale = true
            if (!FILE_TOOLS.has(call.name) || elsewhere(call.arguments)) return undefined
            // If the computer cannot be read, the tool's own result already says so.
            const problems = await this.#absorb(context).catch(() => [])
            if (problems.length === 0) return undefined
            const diagnostics: ToolDiagnostic[] = [
              ...(result.diagnostics ?? []),
              ...problems.map((message) => ({ severity: "error" as const, message })),
            ]
            return { ...result, diagnostics }
          },
        }),
      ],
    })
    this.extensions = [CodingTools, sync]
  }

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
    if (!this.#stale || this.#harness === undefined) return
    const identity = await this.#harness.snapshot(IdentityDoc, context)
    if (identity === undefined) return
    this.#stale = false
    try {
      await writeMirror(this.sandbox, identity)
    } catch (error) {
      this.#stale = true
      throw error
    }
  }

  /** Take edits the agent made to the workspace files into the document. Returns refused edits. */
  async #absorb(context: Context): Promise<readonly string[]> {
    const harness = this.#harness
    if (harness === undefined) return []
    const identity = await harness.snapshot(IdentityDoc, context)
    if (identity === undefined) return []
    const { change, problems } = await readMirrorChanges(this.sandbox, identity)
    if (Object.keys(change).length > 0) {
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
