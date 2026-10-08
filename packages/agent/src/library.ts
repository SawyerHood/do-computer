import type { LibraryFile } from "@durable-computer/protocol"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  defineExtension,
  defineTool,
  type Extension,
  section,
  type ToolRegistration,
} from "@earendil-works/pi-durable"
import { getOrThrow } from "@earendil-works/pi-durable/env"
import { type AroundMachine, type ComputerTarget, MachineEnv } from "./computers.ts"
import {
  LIBRARY_FOLDER,
  type LibraryBackend,
  LibraryError,
  type LibraryPass,
  MAX_LIBRARY_FILE_BYTES,
  UPLOADS_FOLDER,
} from "./library-store.ts"
import { syncFolder } from "./library-sync.ts"

export * from "./library-store.ts"

/** The tools after which a library folder may have changed, and before which it must be right. */
const WRITING_TOOLS = new Set(["bash", "write", "edit"])
const READING_TOOLS = new Set(["bash", "write", "edit", "read"])

/** How long an agent waits for another's pass over the same folder to end, and how often it looks. */
const PASS_WAIT_MS = 20_000
const PASS_POLL_MS = 200
/** How often a pass that takes long says it is still going. */
const PASS_RENEW_MS = 30_000

/** What the agent keeps in mind about one machine's copy of the library. */
type Copy = {
  /** Where the library stood when this folder was last seen to match it. Undefined: unknown. */
  seen?: number
  syncing?: Promise<readonly string[]>
  /** A pass that will start when the one under way ends, which callers arriving meanwhile share. */
  queued?: Promise<readonly string[]>
  /** What the agent has already been told could not be taken in. */
  reported: Set<string>
}

export type LibraryOptions = {
  /**
   * Where the library is kept right now: with the agent, or with its workspace. Asked each time,
   * since an agent can be moved to another workspace.
   */
  readonly backend: () => Promise<LibraryBackend>
  /** Whether other agents keep their files in the same library. */
  readonly shared: boolean
  /** The agent, which the files it makes are put down to where the library is shared. */
  readonly agentId?: string
  /** Whether the agent has a machine of its workspace to work on, which has a library folder. */
  readonly hasMachine: (context: Context) => Promise<boolean>
  /** Told when a folder could not be brought into step with the library. */
  readonly onProblem?: (error: unknown) => void
}

/**
 * The agent's side of the library: the tools that put a file in it and take one out, what the
 * agent is told about it, and keeping the `library` folder on each machine of the workspace in
 * step with what is kept.
 */
export class Library {
  readonly extension: Extension
  readonly sendFileTool: ToolRegistration
  /** Lets the agent see the library and bring a file from it onto a computer. */
  readonly libraryTool: ToolRegistration
  /** Brings a machine's library folder into step around the calls that run there. */
  readonly around: AroundMachine
  readonly #options: LibraryOptions
  readonly #copies = new Map<string, Copy>()

  constructor(options: LibraryOptions) {
    this.#options = options
    const fail = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] })
    const made = (file: { source: "agent" | "user"; agentId?: string | null }) =>
      file.source === "user"
        ? "uploaded by the user"
        : options.shared && file.agentId != null && file.agentId !== options.agentId
          ? "made by another agent"
          : "made by you"
    this.around = {
      before: async (tool, target) => {
        if (!READING_TOOLS.has(tool)) return
        // A machine that cannot be reached fails the tool itself, with the reason.
        await this.#syncIfBehind(target).catch((error) => options.onProblem?.(error))
      },
      after: async (tool, target) => {
        if (!WRITING_TOOLS.has(tool)) return []
        return this.sync(target).catch((error) => {
          options.onProblem?.(error)
          return []
        })
      },
    }
    this.sendFileTool = defineTool({
      name: "send_file",
      description:
        "Put a file from a computer in front of the user: a document, image, export or anything else they should have. It appears in the chat, where they can open it, and is kept in their library. Use it instead of pasting long file contents into a reply.",
      parameters: Type.Object({
        path: Type.String({ description: "Path of the file to send" }),
        name: Type.Optional(Type.String({ description: "File name to give it, if not its own" })),
      }),
      execute: async (args, api, context) => {
        if (api.env === undefined) return fail("There is no computer to send a file from.")
        const absolute = getOrThrow(await api.env.absolutePath(args.path, context))
        const info = await api.env.fileInfo(absolute, context)
        if (!info.ok) return fail(`Could not find ${args.path}: ${info.error.message}`)
        if (info.value.kind !== "file") return fail(`${args.path} is not a file.`)
        if (info.value.size > MAX_LIBRARY_FILE_BYTES) {
          return fail(
            `${args.path} is ${Math.round(info.value.size / (1024 * 1024))} MB; files up to ${MAX_LIBRARY_FILE_BYTES / (1024 * 1024)} MB can be sent.`,
          )
        }
        try {
          const backend = await options.backend()
          // A file in the library folder is in the library already, or is once the folder is read.
          const target = api.env instanceof MachineEnv ? api.env.target : undefined
          const folder = target === undefined ? undefined : folderOn(target)
          if (
            target !== undefined &&
            args.name === undefined &&
            absolute.startsWith(`${folder}/`)
          ) {
            await this.sync(target)
            const path = absolute.slice(folder!.length + 1)
            const kept = (await backend.list()).find((file) => file.path === path)
            if (kept !== undefined) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Showed the user ${kept.path} (${kept.size} bytes) from the library.`,
                  },
                ],
                details: kept,
              }
            }
          }
          const bytes = await api.env.readBinaryFile(absolute, context)
          if (!bytes.ok) return fail(`Could not read ${args.path}: ${bytes.error.message}`)
          const file = await backend.add({
            name: args.name ?? info.value.name,
            bytes: bytes.value,
            source: "agent",
            chatId: String(api.conversationId),
            agentId: options.agentId,
            // Sending a newer copy of what it sent before updates that file.
            whenTaken: "replace",
          })
          return {
            content: [
              { type: "text", text: `Sent ${file.name} (${file.size} bytes) to the user.` },
            ],
            details: file,
          }
        } catch (error) {
          if (error instanceof LibraryError) return fail(error.message)
          throw error
        }
      },
    })
    this.libraryTool = defineTool({
      name: "library",
      description:
        "The user's library: files they uploaded for you, and files that were made for them. `list` shows what is there, newest first. `get` copies one onto a computer so you can read it or work on it there.",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("list"), Type.Literal("get")]),
        file: Type.Optional(
          Type.String({ description: "For get: the file's path, name or id, as `list` shows it" }),
        ),
        path: Type.Optional(
          Type.String({ description: "For get: where to put it. Default: uploads/<name>" }),
        ),
      }),
      execute: async (args, api, context) => {
        const backend = await options.backend()
        const files = await backend.list()
        if (args.action === "list") {
          const lines = files.map(
            (file) =>
              `${file.path} (${file.size} bytes, ${made(file)}, ${new Date(file.createdAt)
                .toISOString()
                .slice(0, 10)}, id ${file.id})`,
          )
          return {
            content: [
              {
                type: "text",
                text: lines.length === 0 ? "The library is empty." : lines.join("\n"),
              },
            ],
          }
        }
        const wanted = args.file?.trim() ?? ""
        if (wanted === "") return fail("`get` needs the file's path, name or id.")
        const lower = wanted.toLowerCase()
        // `list` is newest first, so a name used twice means the latest one.
        const file =
          files.find((entry) => entry.id === wanted || entry.path.toLowerCase() === lower) ??
          files.find((entry) => entry.name.toLowerCase() === lower)
        if (file === undefined) {
          return fail(`There is no "${wanted}" in the library. Use the list action to see it.`)
        }
        if (api.env === undefined) return fail("There is no computer to put the file on.")
        const bytes = await backend.bytes(file)
        if (bytes === undefined) return fail(`The contents of ${file.name} are missing.`)
        const target = getOrThrow(
          await api.env.absolutePath(args.path?.trim() || `uploads/${file.name}`, context),
        )
        const written = await api.env.writeFile(target, bytes, context)
        if (!written.ok) return fail(`Could not write ${target}: ${written.error.message}`)
        return {
          content: [
            { type: "text", text: `Copied ${file.name} (${file.size} bytes) to ${target}.` },
          ],
          details: { path: target, file },
        }
      },
    })
    this.extension = defineExtension({
      name: "dc.library",
      tools: [this.sendFileTool, this.libraryTool],
      sections: [
        section("library", async (_input, context) => {
          const among = options.shared
            ? " The other agents of your workspace keep their documents in the same library, so give yours folders and names that say what they are, and leave theirs as they are unless you are asked."
            : ""
          if (!(await options.hasMachine(context))) {
            return `The user can upload files to their library for you. When they mention a file they uploaded or attached, find it with the \`library\` tool and copy it onto a computer with its \`get\` action before answering; do not ask them to paste it.${among}`
          }
          const folder = `~/${LIBRARY_FOLDER}`
          return [
            `On a machine of your workspace, the folder ${folder} is the user's library. Whatever you put there is kept safe outside the machine and appears in the Library of their app, in the folders you gave it, where they can read it, edit it, and open it while the machine is off. Their edits and the files they add arrive in the same folder, and files they attach in a chat are in ${folder}/${UPLOADS_FOLDER}; read those there, and do not ask them to paste a file.${among}`,
            "Write anything they should read or keep as a document in that folder: Markdown for writing, HTML for pages, charts and anything laid out. An HTML page is shown as a page, and the styles, scripts and images it links to with relative paths work when they are in the folder beside it. Use folders and plain file names, since those are what the user sees. Hidden files, `node_modules` and files over 25 MB are left out, so keep scratch work in your own folder.",
            "After making or changing a document they asked for, show it to them with `send_file`, which puts it in the chat for them to open.",
          ].join("\n")
        }),
      ],
    })
  }

  /**
   * Keep a file someone gave the agent somewhere other than the app, such as one attached to a
   * message in Slack: with the uploads, as a file attached in a chat is.
   */
  async keep(file: {
    name: string
    bytes: Uint8Array
    contentType?: string | undefined
    chatId: string
  }): Promise<LibraryFile> {
    return (await this.#options.backend()).add({
      name: file.name,
      bytes: file.bytes,
      source: "user",
      chatId: file.chatId,
      ...(this.#options.agentId === undefined ? {} : { agentId: this.#options.agentId }),
      ...(file.contentType === undefined ? {} : { contentType: file.contentType }),
    })
  }

  /** What is in a file of the library, as it was at the revision named. */
  async contents(file: { id: string; rev: number }): Promise<Uint8Array | undefined> {
    return (await this.#options.backend()).bytes(file)
  }

  #copy(computer: string): Copy {
    let copy = this.#copies.get(computer)
    if (copy === undefined) {
      copy = { reported: new Set() }
      this.#copies.set(computer, copy)
    }
    return copy
  }

  /** What is kept may be somewhere else now, or a machine may have been replaced: look again. */
  forget(): void {
    this.#copies.clear()
  }

  /** Bring a machine's folder into step unless it is known to match what is kept. */
  async #syncIfBehind(target: ComputerTarget): Promise<void> {
    const seen = this.#copy(target.id).seen
    if (seen !== undefined && seen === (await (await this.#options.backend()).rev())) return
    await this.sync(target)
  }

  /** Start a pass, waiting a while for one that another agent has under way on the same machine. */
  async #begin(backend: LibraryBackend, computer: string): Promise<LibraryPass> {
    const deadline = Date.now() + PASS_WAIT_MS
    for (;;) {
      const pass = await backend.beginPass(computer)
      if (pass !== undefined) return pass
      if (Date.now() > deadline) {
        throw new Error(
          "Another agent has been bringing this machine's library folder into step for a long time.",
        )
      }
      await new Promise((resolve) => setTimeout(resolve, PASS_POLL_MS))
    }
  }

  /**
   * Bring the library folder on a machine and the library into step, both ways. Returns what
   * could not be taken in, in words for the agent.
   */
  sync(target: ComputerTarget): Promise<readonly string[]> {
    const copy = this.#copy(target.id)
    if (copy.queued !== undefined) return copy.queued
    const run = async () => {
      copy.seen = undefined
      const backend = await this.#options.backend()
      const { pass, base } = await this.#begin(backend, target.id)
      const alive = setInterval(
        () => void backend.renewPass(target.id, pass).catch(() => {}),
        PASS_RENEW_MS,
      )
      let outcome: Awaited<ReturnType<typeof syncFolder>> | undefined
      try {
        outcome = await syncFolder({
          library: backend,
          pass,
          agentId: this.#options.agentId,
          sandbox: target.sandbox,
          folder: folderOn(target),
          base,
        })
      } finally {
        clearInterval(alive)
        const ended = await backend.endPass(
          target.id,
          pass,
          outcome?.changed === true ? outcome.base : undefined,
        )
        if (outcome !== undefined && outcome.failed === undefined && ended.clean) {
          copy.seen = ended.rev
        }
      }
      if (outcome.failed !== undefined) throw outcome.failed
      // Said once each. A file that stays where it is would otherwise be reported after every tool.
      const fresh = outcome.problems.filter((problem) => !copy.reported.has(problem))
      for (const problem of fresh) copy.reported.add(problem)
      return fresh
    }
    if (copy.syncing === undefined) {
      const pass = run().finally(() => {
        if (copy.syncing === pass) copy.syncing = undefined
      })
      copy.syncing = pass
      return pass
    }
    // One is under way and may already be past what this caller changed, so another follows it.
    const queued: Promise<readonly string[]> = copy.syncing
      .catch(() => {})
      .then(() => {
        copy.queued = undefined
        copy.syncing = queued
        return run()
      })
      .finally(() => {
        if (copy.syncing === queued) copy.syncing = undefined
      })
    copy.queued = queued
    return queued
  }
}

/** The library folder on a machine. One to a machine, whichever agents work there. */
const folderOn = (target: ComputerTarget) => `${target.computer.home}/${LIBRARY_FOLDER}`
