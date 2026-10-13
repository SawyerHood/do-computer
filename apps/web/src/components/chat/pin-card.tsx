import { pinned, pinOf, pinTitle, type ToolPart } from "@do-computer/protocol"
import { PushPinIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import { useContext } from "react"
import { Button } from "@/components/ui/button"
import { usePinning, usePins } from "@/lib/pins"
import { useListedAgent } from "@/lib/workspaces"
import { AgentIdContext, OpenFileContext } from "./sent-file.tsx"

/**
 * Something the agent pinned, where it pinned it: what it is, the way to open it, and the way
 * to take the pin off. It says how the pin stands today, not how it stood when it was made.
 */
export function PinCard({ part }: { part: ToolPart }) {
  const agentId = useContext(AgentIdContext)
  return agentId === undefined ? null : <CardOf agentId={agentId} part={part} />
}

function CardOf({ agentId, part }: { agentId: string; part: ToolPart }) {
  const then = pinned(part)
  const open = useContext(OpenFileContext)
  const name = useListedAgent(agentId)?.name ?? "Your Dood"
  const pins = usePins(agentId)
  const { pin, unpin, pending, error } = usePinning(agentId)
  // Until what is pinned is known, it is shown as the agent left it.
  const now = pins === undefined ? then.pin : pinOf(pins, then.file)
  const title = pinTitle(now ?? then.pin, then.file)
  return (
    <div
      role="group"
      aria-label={`Pinned: ${title}`}
      className="flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-card py-2.5 pr-2.5 pl-3 text-sm shadow-raised"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-muted-foreground">
          <PushPinIcon className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">
            {now === undefined ? `${title} is no longer pinned` : `${name} pinned ${title}`}
          </span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {error?.message ?? then.file.path}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {now === undefined ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            // Back as the agent pinned it, under the title it gave.
            onClick={() => pin.mutate({ fileId: then.file.id, title: then.pin.title })}
          >
            Pin it again
          </Button>
        ) : (
          <>
            {open === undefined ? (
              <Button
                variant="outline"
                size="sm"
                render={
                  <Link
                    to="/a/$agentId/library"
                    params={{ agentId }}
                    search={{ file: then.file.id }}
                  />
                }
              >
                Open
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => open(now.fileId)}>
                Open
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => unpin.mutate(now.fileId)}
            >
              Unpin
            </Button>
          </>
        )}
      </span>
    </div>
  )
}
