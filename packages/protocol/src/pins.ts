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
