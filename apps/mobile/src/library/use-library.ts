import type { LibraryFile, LibraryListing, SiteSummary } from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { useMemo, useState } from "react"
import { openLibraryFile } from "@/lib/files"
import { keys, useAgentLive, useAgents, useWorkspaces } from "@/lib/queries"
import { useSession } from "@/lib/use-session"
import { confirm, errorText, haptic, tell } from "@/ui"
import { dirOf, documentName, joinPath, nameOf, tidyPath } from "./model"
import { usePrompt } from "./prompt"

/**
 * The library an agent has, which is its workspace's: the files, the ones deleted lately, what
 * is shared with a link, and whose it all is. Kept current by the agent's event socket.
 */
export function useLibrary(agentId: string) {
  const { client } = useSession()
  useAgentLive(agentId)
  const api = useMemo(() => client.agent(agentId), [client, agentId])
  const listing = useQuery<LibraryListing>({
    queryKey: keys.library(agentId),
    queryFn: () => api.libraryListing(),
  })
  const sites = useQuery<SiteSummary[]>({
    queryKey: keys.sites(agentId),
    queryFn: () => api.sites(),
  })
  const agents = useAgents().data
  const workspaces = useWorkspaces().data
  const agent = agents?.find((each) => each.id === agentId)
  const workspace = workspaces?.workspaces.find((each) => each.id === agent?.workspaceId)
  const team = workspace?.kind === "team"
  /** The agents that share this library: every one in the workspace. */
  const sharers = (agents ?? []).filter((each) => each.workspaceId === agent?.workspaceId)
  const agentName = agent?.name ?? "Your Dood"

  /** Who last changed a file, or deleted it: the agent by its name, or "you". */
  const by = (who: "agent" | "user", file: Pick<LibraryFile, "agentId">) =>
    who === "user"
      ? "you"
      : ((file.agentId === undefined
          ? undefined
          : agents?.find((each) => each.id === file.agentId)?.name) ?? agentName)

  return {
    api,
    listing,
    sites,
    files: listing.data?.files ?? [],
    deleted: listing.data?.deleted ?? [],
    view: listing.data?.view,
    agentName,
    workspaceName: team ? workspace.name : "Personal",
    sharers,
    by,
    /** Who a site that is not public is open to, as the web app says it. */
    audience: team
      ? { long: `People in ${workspace.name}`, who: "They sign in first" }
      : { long: "Only you", who: "Nobody else can open it" },
  }
}

/** A file picked from Photos, Files or the camera, on its way to the library. */
export type Picked = { uri: string; name: string; type: string }

/**
 * What can be done to the files of a library from any of its screens. Each thing asks first
 * where it should, says so when it fails, and leaves the list of files to be asked for again.
 * `element` must be drawn by the screen: it is where a name is asked for off iOS.
 */
export function useLibraryActions(agentId: string) {
  const session = useSession()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [ask, element] = usePrompt()
  const [busy, setBusy] = useState(false)
  const api = useMemo(() => session.client.agent(agentId), [session, agentId])
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.library(agentId) })

  /** Move a file to another place in the library. Resolves with the file where it now is. */
  const moveTo = async (file: LibraryFile, path: string): Promise<LibraryFile | undefined> => {
    const wanted = tidyPath(path)
    if (wanted === "" || wanted === file.path) return undefined
    try {
      const moved = await api.moveLibraryFile(file.id, wanted)
      haptic.done()
      await refresh()
      return moved
    } catch (error) {
      haptic.fail()
      tell(`${file.name} could not be moved`, errorText(error))
      return undefined
    }
  }

  return {
    element,
    busy,

    share: (path: string) =>
      router.push(`/a/${agentId}/library/share?path=${encodeURIComponent(path)}`),

    shareFile: (file: LibraryFile) => router.push(`/a/${agentId}/library/share?fileId=${file.id}`),

    /** Ask for a new name, and give the file it where it is. */
    rename: async (file: LibraryFile) => {
      const typed = await ask({
        title: "Rename",
        value: file.name,
        action: "Rename",
        label: "Name",
      })
      if (typed === undefined) return undefined
      const name = typed.trim().replace(/[\\/]+/g, "-")
      return name === "" ? undefined : moveTo(file, joinPath(dirOf(file.path), name))
    },

    /** Ask for the folder and name together, as the web app's "Rename or move" does. */
    renameOrMove: async (file: LibraryFile) => {
      const typed = await ask({
        title: "Rename or move",
        message: "Its folder and name. A folder that is not there yet is made.",
        value: file.path,
        action: "Move",
        label: "Folder and name",
      })
      return typed === undefined ? undefined : moveTo(file, typed)
    },

    /** Move a file into a folder ("" is the top), keeping its name. */
    moveInto: (file: LibraryFile, dir: string) => moveTo(file, joinPath(dir, file.name)),

    download: (file: LibraryFile) => {
      openLibraryFile(session, agentId, file).catch((error) =>
        tell(`${file.name} could not be downloaded`, errorText(error)),
      )
    },

    /** Delete a file, after asking. Resolves true if it was deleted. */
    remove: async (file: LibraryFile): Promise<boolean> => {
      const sure = await confirm({
        title: `Delete ${file.name}?`,
        message: "It stays in Recently deleted for a while, where it can be restored.",
        action: "Delete",
      })
      if (!sure) return false
      try {
        await api.removeLibraryFile(file.id)
        haptic.done()
        await refresh()
        return true
      } catch (error) {
        haptic.fail()
        tell(`${file.name} could not be deleted`, errorText(error))
        return false
      }
    },

    restore: async (file: Pick<LibraryFile, "id" | "name">) => {
      try {
        await api.restoreLibraryFile(file.id)
        haptic.done()
        await refresh()
      } catch (error) {
        haptic.fail()
        tell(`${file.name} could not be restored`, errorText(error))
      }
    },

    /** Ask for a name, start a document of that name in a folder, and open it to be written in. */
    newDocument: async (dir: string) => {
      const typed = await ask({
        title: "New document",
        message: dir === "" ? undefined : `In ${dir}`,
        value: "",
        action: "Create",
        label: "Name",
      })
      if (typed === undefined) return
      const name = documentName(typed)
      setBusy(true)
      try {
        const title = name.replace(/\.(md|markdown)$/i, "")
        const file = await api.createLibraryFile(joinPath(dir, name), `# ${title}\n\n`)
        await refresh()
        haptic.done()
        router.push(`/a/${agentId}/library/${file.id}?mode=edit`)
      } catch (error) {
        haptic.fail()
        tell("The document could not be made", errorText(error))
      } finally {
        setBusy(false)
      }
    },

    /** Put picked files into a folder, one after another. Says which could not be put there. */
    upload: async (dir: string, picked: readonly Picked[]) => {
      if (picked.length === 0) return
      setBusy(true)
      const failed: string[] = []
      for (const each of picked) {
        try {
          // A picked file is a local address on a phone and a blob in a browser: both can be fetched.
          const body = await (await fetch(each.uri)).blob()
          await api.upload({ name: each.name, type: each.type, body }, undefined, dir)
        } catch {
          failed.push(each.name)
        }
      }
      await refresh()
      setBusy(false)
      if (failed.length === 0) return haptic.done()
      haptic.fail()
      tell(
        failed.length === 1
          ? `${failed[0]} could not be uploaded`
          : "Some files could not be uploaded",
        failed.length === 1 ? "Try again." : failed.map(nameOf).join(", "),
      )
    },
  }
}
