/**
 * Something from the library pinned to an agent: a board it keeps up to date, a plan, anything
 * worth keeping an eye on. What is pinned stays beside the agent's chat, under its face, where
 * it is shown small and can be opened. An agent's pins are the agent's, so everyone who shares
 * the agent sees the same ones.
 */
export type Pin = {
  /** The file, by its id in the library: it stays pinned when it is renamed or moved. */
  fileId: string
  /**
   * Where the file was when it was pinned. A file that is deleted and made again has another
   * id, and the pin is then of whatever is at this place.
   */
  path: string
  /** What it goes by where it is pinned. Without one, the file's own name. */
  title?: string
  /** Who pinned it. */
  by: "agent" | "user"
  at: number
}

/** The agent's tool for pinning. */
export const PIN_TOOL = "pin"
/** How many things one agent can have pinned. They are for a glance, not a second library. */
export const MAX_PINS = 8
export const MAX_PIN_TITLE = 80

/** The file a pin is of, among the files of the library, or undefined when it is gone. */
export function pinnedFile<File extends { id: string; path: string }>(
  pin: Pick<Pin, "fileId" | "path">,
  files: readonly File[],
): File | undefined {
  return (
    files.find((file) => file.id === pin.fileId) ?? files.find((file) => file.path === pin.path)
  )
}

/** The pin of a file, if it is pinned. */
export function pinOf<P extends Pick<Pin, "fileId" | "path">>(
  pins: readonly P[] | undefined,
  file: { id: string; path?: string },
): P | undefined {
  return (
    pins?.find((pin) => pin.fileId === file.id) ??
    (file.path === undefined ? undefined : pins?.find((pin) => pin.path === file.path))
  )
}

/** What a pin is called: its title, or the name of the file it is of. */
export const pinTitle = (pin: Pick<Pin, "title" | "path">, file?: { name: string }): string =>
  pin.title ?? file?.name ?? pin.path.slice(pin.path.lastIndexOf("/") + 1)

/** Whether a Dood has as many things pinned as it can have, so that another must wait. */
export const pinsFull = (pins: readonly unknown[] | undefined): boolean =>
  (pins?.length ?? 0) >= MAX_PINS

/** One thing pinned, with the file it is of now. A file that was deleted leaves `file` empty. */
export type PinnedEntry<File> = { pin: Pin; file: File | undefined; title: string }

/**
 * What is pinned, in the order it is shown, each with its file and what it is called. A pin
 * whose file is gone stays in its place, so that it can say so until it is taken off.
 */
export function pinnedEntries<File extends { id: string; path: string; name: string }>(
  pins: readonly Pin[],
  files: readonly File[],
): PinnedEntry<File>[] {
  return pins.map((pin) => {
    const file = pinnedFile(pin, files)
    return { pin, file, title: pinTitle(pin, file) }
  })
}

/**
 * How something a Dood pinned in a chat stands now: its pin, or undefined once it was taken
 * off. Until what is pinned is known it is taken to stand as the Dood left it, so that a chat
 * does not say "no longer pinned" for a moment as it opens.
 */
export function pinStanding(
  then: { pin: Pin; file: { id: string; path?: string } },
  pins: readonly Pin[] | undefined,
): Pin | undefined {
  return pins === undefined ? then.pin : pinOf(pins, then.file)
}
