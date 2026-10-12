import type { LibraryFile, SiteSummary } from "@do-computer/protocol"
import { DotsThreeIcon, GlobeIcon, LinkSimpleIcon } from "@phosphor-icons/react"
import { useAgentsById } from "@/components/computer-requests"
import { Button } from "@/components/ui/button"
import { formatWhen } from "@/lib/library"
import { shownAddress, siteUrl, useSites } from "@/lib/sites"
import { usePeople, useWorkspaceOfAgent } from "@/lib/workspaces"
import { CopyLink, SharePopover, SitePill } from "./share.tsx"

/**
 * What of the library is shared with a link: each with what it shares, who shared it and who
 * can open it, and the way to change that or stop. Nothing at all where nothing is shared.
 */
export function SharedSites({
  agentId,
  files,
}: {
  agentId: string
  files: readonly LibraryFile[]
}) {
  const sites = useSites(agentId)
  const agents = useAgentsById()
  const people = usePeople(useWorkspaceOfAgent(agentId))
  if (sites === undefined || sites.length === 0) return null
  const by = (site: SiteSummary) =>
    site.agentId !== null
      ? (agents.get(site.agentId)?.name ?? "An agent")
      : site.userId !== null
        ? (people.get(site.userId)?.name ?? "Someone")
        : "Someone"
  // A site whose file has gone from the library, or whose folder has nothing in it, shows nothing.
  const empty = (site: SiteSummary) =>
    !files.some((file) => file.path === site.path || file.path.startsWith(`${site.path}/`))
  return (
    <section aria-label="Shared with a link" className="flex flex-col gap-3">
      <h2 className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-muted-foreground">
        <LinkSimpleIcon className="size-3.5" /> Shared with a link
      </h2>
      <ul className="divide-y overflow-hidden rounded-2xl bg-card shadow-raised">
        {sites.map((site) => {
          const url = siteUrl(site.id)
          return (
            <li key={site.id} className="flex items-center gap-3 py-2.5 pr-2.5 pl-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-muted-foreground">
                <GlobeIcon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {site.title}
                </a>
                <span className="block truncate text-xs text-muted-foreground">
                  <span className="font-mono">{site.path}</span>
                  {empty(site) ? (
                    " · no longer in the library"
                  ) : (
                    <>
                      {" · "}
                      <span className="font-mono">{shownAddress(url)}</span>
                    </>
                  )}
                </span>
              </span>
              <span className="hidden shrink-0 text-xs text-muted-foreground lg:block">
                {by(site)} · {formatWhen(site.createdAt)}
              </span>
              <SitePill agentId={agentId} site={site} />
              <CopyLink url={url} iconOnly label={`Copy the link to ${site.title}`} />
              <SharePopover agentId={agentId} site={site} path={site.path}>
                <Button variant="ghost" size="icon-sm" aria-label={`Sharing of ${site.title}`}>
                  <DotsThreeIcon weight="bold" />
                </Button>
              </SharePopover>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
