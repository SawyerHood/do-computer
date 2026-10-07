import { ArrowSquareOutIcon, XIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { libraryKey } from "@/lib/collections"
import { type ViewMode, Viewer } from "./viewer.tsx"

/**
 * A library file open beside a chat, where the agent's panel otherwise is: the document the
 * conversation is about can be read and edited without leaving it.
 */
export function DocPanel({
  agentId,
  agentName,
  fileId,
  onOpen,
  onClose,
}: {
  agentId: string
  agentName: string
  fileId: string
  /** Show another file here instead. */
  onOpen: (fileId: string) => void
  onClose: () => void
}) {
  const { data: listing } = useQuery({
    queryKey: libraryKey(agentId),
    queryFn: () => client.agent(agentId).libraryListing(),
  })
  const [mode, setMode] = useState<ViewMode>("read")
  const file = listing?.files.find((entry) => entry.id === fileId)
  const close = (
    <Button variant="ghost" size="icon-sm" aria-label="Close the document" onClick={onClose}>
      <XIcon />
    </Button>
  )
  return (
    <aside
      aria-label="Document"
      className="hidden w-[min(52%,56rem)] shrink-0 border-l bg-background xl:block"
    >
      {listing === undefined ? null : file === undefined ? (
        <div className="flex h-full flex-col">
          <div className="flex justify-end p-2">{close}</div>
          <p className="m-auto max-w-xs p-8 text-center text-sm text-muted-foreground">
            That file is no longer in the library. If it was deleted, it can be brought back from
            the Library.
          </p>
        </div>
      ) : (
        <Viewer
          key={file.id}
          agentId={agentId}
          agentName={agentName}
          file={file}
          files={listing.files}
          view={listing.view}
          mode={mode}
          onMode={setMode}
          onOpen={(path) => {
            const next = path === undefined ? undefined : listing.files.find((f) => f.path === path)
            if (next === undefined) onClose()
            else onOpen(next.id)
          }}
          compact
          actions={
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open in the Library"
                title="Open in the Library"
                render={
                  <Link to="/a/$agentId/library" params={{ agentId }} search={{ file: file.id }} />
                }
              >
                <ArrowSquareOutIcon />
              </Button>
              {close}
            </>
          }
        />
      )}
    </aside>
  )
}
