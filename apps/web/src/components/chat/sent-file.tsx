import type { LibraryFile, ToolPart } from "@do-computer/protocol"
import { createContext, useContext } from "react"
import { FileCard } from "@/components/file-card"

/** The agent whose chat is on screen, for parts that link to its files. */
export const AgentIdContext = createContext<string | undefined>(undefined)

/**
 * Opens a library file beside the chat, by its id. Absent where there is no room for that, and
 * a file then opens in the library.
 */
export const OpenFileContext = createContext<((fileId: string) => void) | undefined>(undefined)

/**
 * The chat on screen, as what is typed for it is kept under: for something in the chat to put
 * words in its message box.
 */
export const DraftKeyContext = createContext<string | undefined>(undefined)

/** Said when words were put in a chat's message box from elsewhere, so that the box takes the caret. */
export const DRAFTED = "dc-drafted"

/** A file the agent delivered, shown as the file. */
export function SentFile({ part }: { part: ToolPart }) {
  const agentId = useContext(AgentIdContext)
  const open = useContext(OpenFileContext)
  if (agentId === undefined) return null
  const file = part.details as unknown as LibraryFile
  return (
    <FileCard
      agentId={agentId}
      file={file}
      onOpen={open === undefined ? undefined : () => open(file.id)}
    />
  )
}
