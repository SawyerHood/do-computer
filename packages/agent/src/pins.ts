import {
  type LibraryFile,
  MAX_PIN_TITLE,
  MAX_PINS,
  type Pin,
  PIN_TOOL,
  pinnedFile,
  pinOf,
  pinTitle,
} from "@do-computer/protocol"
import { Type } from "@earendil-works/pi-ai"
import { defineDoc, defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { LIBRARY_FOLDER, type LibraryBackend } from "./library-store.ts"

/** Something about a pin that whoever asked is told in words: there are too many, or no such file. */
export class PinError extends Error {}

export type PinsState = { pins: Pin[] }

/** What is pinned to the agent, in the order it is shown: the first is the one drawn large. */
export const PinsDoc = defineDoc<PinsState>({
  kind: "dc.pins",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ pins: [] }),
})

export type PinsOptions = {
  /** Where the library is kept right now: with the agent, or with its workspace. */
  readonly backend: () => Promise<LibraryBackend>
  readonly read: () => Promise<readonly Pin[]>
  readonly change: (apply: (state: PinsState) => void) => Promise<void>
  readonly now: () => number
}

/** A place in the library as the agent may write it: with or without the folder it is under on a machine. */
const libraryPath = (text: string) =>
  text
    .trim()
    .replace(new RegExp(`^(?:~/|\\./|/)?${LIBRARY_FOLDER}/`), "")
    .replace(/^\.?\//, "")

/**
 * What is pinned to an agent, and the pinning of it: by a person, from the file, and by the
 * agent, with a tool. A pin is of a file of the library; nothing is copied.
 */
export class Pins {
  readonly #options: PinsOptions

  constructor(options: PinsOptions) {
    this.#options = options
  }

  list(): Promise<readonly Pin[]> {
    return this.#options.read()
  }

  /**
   * Pin a file. One that is pinned already stays where it is among the pins, and takes a title
   * if one is given.
   */
  async pin(file: LibraryFile, by: Pin["by"], title?: string): Promise<Pin> {
    const named = title?.replace(/\s+/g, " ").trim().slice(0, MAX_PIN_TITLE)
    let made: Pin | undefined
    let full = false
    await this.#options.change((state) => {
      const existing = pinOf(state.pins, file)
      if (existing !== undefined) {
        existing.fileId = file.id
        existing.path = file.path
        if (named !== undefined && named !== "") existing.title = named
        made = { ...existing }
        return
      }
      if (state.pins.length >= MAX_PINS) {
        full = true
        return
      }
      made = {
        fileId: file.id,
        path: file.path,
        ...(named === undefined || named === "" ? {} : { title: named }),
        by,
        at: this.#options.now(),
      }
      state.pins.push(made)
    })
    if (full || made === undefined) {
      throw new PinError(
        `${MAX_PINS} things are pinned already, which is as many as there can be. Unpin one first.`,
      )
    }
    return made
  }

  /** Take a pin off, by the file it is of. Resolves with whether there was one. */
  async unpin(file: { id: string; path?: string }): Promise<boolean> {
    let found = false
    await this.#options.change((state) => {
      const pin = pinOf(state.pins, file)
      if (pin === undefined) return
      found = true
      state.pins.splice(state.pins.indexOf(pin), 1)
    })
    return found
  }

  /** The file meant by what the agent wrote: a place in the library, a file's name or a pin's title. */
  async #find(wanted: string | undefined): Promise<{ file?: LibraryFile; pin?: Pin } | string> {
    const text = wanted?.trim() ?? ""
    if (text === "") return "Say which file: its path in the library."
    const files = await (await this.#options.backend()).list()
    const pins = await this.#options.read()
    const path = libraryPath(text)
    const file =
      files.find((entry) => entry.path === path) ??
      files.find((entry) => entry.path.toLowerCase() === path.toLowerCase())
    if (file !== undefined) return { file, ...this.#pinOf(pins, file) }
    const titled =
      pins.find((pin) => pinTitle(pin).toLowerCase() === text.toLowerCase()) ??
      pins.find((pin) => pin.path === path)
    if (titled !== undefined) {
      const of = pinnedFile(titled, files)
      return { pin: titled, ...(of === undefined ? {} : { file: of }) }
    }
    const named = files.filter((entry) => entry.name.toLowerCase() === text.toLowerCase())
    if (named.length === 1) return { file: named[0]!, ...this.#pinOf(pins, named[0]!) }
    return `There is no file "${text}" in the library. A pin is of a file that is there: write it first, under ~/${LIBRARY_FOLDER} on a machine, and give its path as it is in the library.`
  }

  #pinOf(pins: readonly Pin[], file: LibraryFile): { pin?: Pin } {
    const pin = pinOf(pins, file)
    return pin === undefined ? {} : { pin }
  }

  get extension(): Extension {
    const fail = (text: string) => ({ isError: true, output: [{ type: "text" as const, text }] })
    const say = (text: string) => ({ output: [{ type: "text" as const, text }] })
    const tool = defineTool({
      name: PIN_TOOL,
      // Described to the model only once it loads it (`deferred.ts`).
      deferred: true,
      description:
        "Pin something from the library beside your chat, under your face, where the person keeps it in view: the first thing pinned is shown small as what it is, and stays current as the file changes, and any of them opens beside the chat at a press. " +
        "Pin what they ask to have pinned, and what you make for them to keep an eye on over time: a board or a tracker you keep up to date, a plan the two of you work from. A page (an HTML file) shows best. Do not pin what is read once. " +
        'action "pin" needs `path`, a file as it is in the library, and takes a short `title`. ' +
        `Pinning copies nothing: change the file and what is pinned changes. "unpin" takes it off again, and "list" says what is pinned: they pin and unpin things too, so look before you rely on it. At most ${MAX_PINS} things are pinned at once.`,
      parameters: Type.Object({
        action: Type.Union([Type.Literal("pin"), Type.Literal("unpin"), Type.Literal("list")]),
        path: Type.Optional(
          Type.String({
            description: `For pin and unpin: the file, as it is in the library (under ~/${LIBRARY_FOLDER} on a machine)`,
          }),
        ),
        title: Type.Optional(
          Type.String({
            description: "For pin: what it is called where it is pinned, in a few words",
          }),
        ),
      }),
      execute: async (args) => {
        try {
          if (args.action === "list") {
            const pins = await this.#options.read()
            if (pins.length === 0) return say("Nothing is pinned.")
            const files = await (await this.#options.backend()).list()
            return say(
              pins
                .map((pin) => {
                  const file = pinnedFile(pin, files)
                  const where =
                    file === undefined
                      ? `${pin.path}, which is no longer in the library`
                      : file.path
                  return `${pinTitle(pin, file)}: ${where} (pinned by ${pin.by === "agent" ? "you" : "the person"})`
                })
                .join("\n"),
            )
          }
          const found = await this.#find(args.path)
          if (typeof found === "string") return fail(found)
          if (args.action === "unpin") {
            if (found.pin === undefined)
              return fail(`${found.file?.path ?? args.path} is not pinned.`)
            await this.unpin({ id: found.pin.fileId, path: found.pin.path })
            return say(
              `“${pinTitle(found.pin, found.file)}” is no longer pinned. The file is still in the library.`,
            )
          }
          if (found.file === undefined) {
            return fail(
              `${found.pin?.path ?? args.path} is no longer in the library, so it cannot be pinned.`,
            )
          }
          const pin = await this.pin(found.file, "agent", args.title)
          return {
            output: [
              {
                type: "text" as const,
                text: `Pinned ${found.file.path} as “${pinTitle(pin, found.file)}”. The person sees it under your face beside the chat, and the chat says that you pinned it, so do not say where it is. It shows the file as it is: keep the file up to date and what is pinned follows.`,
              },
            ],
            details: { pin, file: found.file },
          }
        } catch (error) {
          if (error instanceof PinError) return fail(error.message)
          throw error
        }
      },
    })
    // No section: the tool is loaded on demand, the prompt names it, and it says when to pin.
    return defineExtension({ name: "dc.pins", tools: [tool] })
  }
}
