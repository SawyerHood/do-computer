import { sharedSite, type ToolPart } from "@durable-computer/protocol"
import { ArrowSquareOutIcon, CaretDownIcon, GlobeIcon } from "@phosphor-icons/react"
import { useContext, useEffect, useRef } from "react"
import { CopyLink, SharePopover, SitePill } from "@/components/sites/share"
import { Button } from "@/components/ui/button"
import { queryClient } from "@/lib/query"
import { shownAddress, siteUrl, sitesKey, useSharing, useSites } from "@/lib/sites"
import { AgentIdContext } from "./sent-file.tsx"

/**
 * A site the agent shared, where it shared it: its address, who can open it now, and the way
 * to change that. It says how the site stands today, not how it stood when it was shared.
 */
export function SiteCard({ part }: { part: ToolPart }) {
  const agentId = useContext(AgentIdContext)
  return agentId === undefined ? null : <CardOf agentId={agentId} part={part} />
}

function CardOf({ agentId, part }: { agentId: string; part: ToolPart }) {
  const then = sharedSite(part)
  const sites = useSites(agentId)
  const { share } = useSharing(agentId)
  // The same place shared again after it was stopped is a site with another address.
  const known =
    sites?.find((site) => site.id === then.id) ?? sites?.find((site) => site.path === then.path)
  // What is known may be from before the agent did this: ask again, once for each thing it did.
  const asked = useRef("")
  useEffect(() => {
    if (sites === undefined || asked.current === part.toolCallId) return
    if (known !== undefined && known.updatedAt >= then.updatedAt) return
    asked.current = part.toolCallId
    void queryClient.invalidateQueries({ queryKey: sitesKey(agentId) })
  }, [sites, known, then.updatedAt, part.toolCallId, agentId])
  // Until the list is here, it is shown as the agent left it.
  const site = sites === undefined ? then : known
  const url = siteUrl((site ?? then).id)
  return (
    <div
      role="group"
      aria-label={`Site: ${then.title}`}
      className="flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border bg-surface py-2.5 pr-2.5 pl-3 text-sm"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-muted-foreground">
          <GlobeIcon className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{(site ?? then).title}</span>
            {site === undefined ? (
              <span className="shrink-0 text-xs text-muted-foreground">Not shared any more</span>
            ) : (
              <SitePill agentId={agentId} site={site} />
            )}
          </span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {site === undefined ? then.path : shownAddress(url)}
          </span>
        </span>
      </span>
      {site === undefined ? (
        <Button
          variant="outline"
          size="sm"
          disabled={share.isPending}
          onClick={() => share.mutate({ path: then.path, title: then.title })}
        >
          Share again
        </Button>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5">
          <CopyLink url={url} />
          <Button
            variant="outline"
            size="sm"
            render={<a href={url} target="_blank" rel="noreferrer" />}
          >
            Open <ArrowSquareOutIcon />
          </Button>
          <SharePopover agentId={agentId} site={site} path={site.path}>
            <Button variant="outline" size="icon-sm" aria-label="Who can open it">
              <CaretDownIcon />
            </Button>
          </SharePopover>
        </span>
      )}
    </div>
  )
}
