import { sitePath, type SiteSummary } from "@do-computer/protocol"
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query"
import { client } from "@/lib/client"
import { queryClient } from "@/lib/query"
import { useWorkspaceOfAgent } from "@/lib/workspaces"

export const sitesKey = (agentId: string) => ["agents", agentId, "sites"] as const

/** What of the library of an agent's workspace is shared with a link. */
export const sitesQuery = (agentId: string) =>
  queryOptions({
    queryKey: sitesKey(agentId),
    queryFn: () => client.agent(agentId).sites(),
  })

export const useSites = (agentId: string) => useQuery(sitesQuery(agentId)).data

/**
 * What sharing a file shares: the file, or for a folder's front page the folder, since what
 * such a page links to is in there with it.
 */
export function sharedPathOf(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash !== -1 && /^index\.html?$/i.test(path.slice(slash + 1)) ? path.slice(0, slash) : path
}

/** The site a file is shared as, if it is: by itself, or as the front page of a folder. */
export const siteOfFile = (sites: readonly SiteSummary[] | undefined, path: string) =>
  sites?.find((site) => site.path === sharedPathOf(path))

/** The site a folder is shared as, if it is. */
export const siteOfFolder = (sites: readonly SiteSummary[] | undefined, path: string) =>
  sites?.find((site) => site.path === path)

/**
 * A site's whole address, for opening and for sending to someone. The app asks its own server
 * by path alone, so the address it is at is what the site's begins with.
 */
export const siteUrl = (siteId: string) => new URL(sitePath(siteId), location.origin).href

/** A site's address without its scheme, as it is shown. */
export const shownAddress = (url: string) => url.replace(/^https?:\/\//, "")

/** Put a site as it now is among the ones already known, or take it out. */
function keep(agentId: string, site: SiteSummary | { removed: string }) {
  queryClient.setQueryData<SiteSummary[]>(sitesKey(agentId), (sites = []) =>
    "removed" in site
      ? sites.filter((entry) => entry.id !== site.removed)
      : sites.some((entry) => entry.id === site.id)
        ? sites.map((entry) => (entry.id === site.id ? site : entry))
        : [site, ...sites],
  )
}

/** Sharing a page, changing who can open a site, and stopping one: each shown as soon as it is done. */
export function useSharing(agentId: string) {
  const api = client.agent(agentId)
  const settle = () => void queryClient.invalidateQueries({ queryKey: sitesKey(agentId) })
  const share = useMutation({
    mutationFn: (input: { path: string; title?: string }) => api.shareSite(input.path, input.title),
    onSuccess: (site) => keep(agentId, site),
    onSettled: settle,
  })
  const open = useMutation({
    mutationFn: (input: { siteId: string; public: boolean }) =>
      api.updateSite(input.siteId, { public: input.public }),
    onSuccess: (site) => keep(agentId, site),
    onSettled: settle,
  })
  const stop = useMutation({
    mutationFn: (siteId: string) => api.removeSite(siteId),
    onSuccess: (_done, siteId) => keep(agentId, { removed: siteId }),
    onSettled: settle,
  })
  return { share, open, stop, error: share.error ?? open.error ?? stop.error }
}

/**
 * Who a site that is not public is open to, in a few words: the team by its name, or only the
 * one person whose workspace it is.
 */
export function useAudience(agentId: string): { short: string; long: string; who: string } {
  const workspace = useWorkspaceOfAgent(agentId)
  if (workspace === undefined || workspace.kind === "personal") {
    return { short: "Only you", long: "Only you", who: "Nobody else can open it" }
  }
  return {
    short: `${workspace.name} only`,
    long: `People in ${workspace.name}`,
    who: "Anyone in this workspace who is signed in",
  }
}
