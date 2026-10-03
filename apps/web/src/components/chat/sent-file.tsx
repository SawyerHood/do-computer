import type { LibraryFile, ToolPart } from "@durable-computer/protocol"
import { createContext, useContext } from "react"
import { FileCard } from "@/components/file-card"

/** The agent whose chat is on screen, for parts that link to its files. */
export const AgentIdContext = createContext<string | undefined>(undefined)

/** A file the agent delivered, shown as the file. */
export function SentFile({ part }: { part: ToolPart }) {
  const agentId = useContext(AgentIdContext)
  if (agentId === undefined) return null
  return <FileCard agentId={agentId} file={part.details as unknown as LibraryFile} />
}
