import type { LibraryFile } from "@do-computer/protocol"
import { NotePencilIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { useAtomValue } from "jotai"
import { AgentAside } from "@/components/chat/agent-aside"
import { DocMarkdown } from "@/components/library/doc-markdown"
import { KindIcon, LibraryTree } from "@/components/library/tree"
import { Loads } from "@/components/loads"
import { DocPlaceholder, Placeholder, TreePlaceholder } from "@/components/placeholders"
import { type ViewMode, Viewer } from "@/components/library/viewer"
import { SharedSites } from "@/components/sites/shared-sites"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { sidebarSlotAtom } from "@/lib/atoms"
import { client } from "@/lib/client"
import { agentQuery, libraryKey, libraryQuery, libraryTextKey } from "@/lib/collections"
import { dirOf, formatWhen, kindOf } from "@/lib/library"
import { queryClient } from "@/lib/query"
import { sitesQuery } from "@/lib/sites"
import { cn } from "@/lib/utils"
import { useListedAgent } from "@/lib/workspaces"

type LibrarySearch = {
  /** The file that is open, by where it is in the library. */
  path?: string
  /** The file that is open, by its id: how a chat links to a file, wherever it has moved to. */
  file?: string
  mode?: Exclude<ViewMode, "read">
}

const MODES = new Set(["edit", "split", "source"])

export const Route = createFileRoute("/_app/a/$agentId/library")({
  validateSearch: (search: Record<string, unknown>): LibrarySearch => ({
    ...(typeof search.path === "string" && search.path !== "" ? { path: search.path } : {}),
    ...(typeof search.file === "string" && search.file !== "" ? { file: search.file } : {}),
    ...(typeof search.mode === "string" && MODES.has(search.mode)
      ? { mode: search.mode as LibrarySearch["mode"] }
      : {}),
  }),
  // Started and not waited for: the page is drawn at once, and its files when they are here.
  // Pointing at the tab runs this too.
  loader: ({ params }) => {
    void queryClient.prefetchQuery(libraryQuery(params.agentId))
    void queryClient.prefetchQuery(sitesQuery(params.agentId))
  },
  component: LibraryPage,
})

/** A recent file as a card: a picture of it where there is one to show. */
function RecentCard({
  agentId,
  agentName,
  file,
  view,
  paths,
}: {
  agentId: string
  agentName: string
  file: LibraryFile
  view: string
  paths: ReadonlySet<string>
}) {
  const api = client.agent(agentId)
  const kind = kindOf(file)
  // Only a short document is fetched for its card. A long one would be read to show its first lines.
  const preview = kind === "markdown" && file.size < 64 * 1024
  const { data: text } = useQuery({
    queryKey: libraryTextKey(agentId, file.id, file.rev),
    queryFn: () => api.libraryText(file.id, file.rev),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: preview,
  })
  return (
    <Link
      to="/a/$agentId/library"
      params={{ agentId }}
      search={{ path: file.path }}
      className="flex flex-col overflow-hidden rounded-2xl bg-card shadow-raised outline-none hover:shadow-card focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <div className="relative h-32 overflow-hidden border-b bg-background">
        {kind === "image" ? (
          <img
            src={`${api.libraryViewUrl(view, file.path)}?v=${file.rev}`}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : preview && text !== undefined ? (
          <div aria-hidden className="pointer-events-none w-[182%] origin-top-left scale-55 p-5">
            <DocMarkdown agentId={agentId} file={file} text={text} view={view} paths={paths} />
          </div>
        ) : (
          <div className="grid size-full place-items-center">
            <KindIcon file={file} className="size-9 opacity-70" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <KindIcon file={file} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {file.updatedBy === "agent" ? agentName : "You"} · {formatWhen(file.updatedAt)}
            {dirOf(file.path) === "" ? "" : ` · ${dirOf(file.path)}`}
          </p>
        </div>
      </div>
    </Link>
  )
}

/**
 * The library of the agent's workspace, which its agents share: documents and files they have
 * made, and ones people have given them, as a tree of folders beside whichever one is open.
 */
const DESKTOP = "(min-width: 48rem)"

/** Whether the screen is wide enough for the sidebar to be beside the page. */
function useDesktop(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = matchMedia(DESKTOP)
      query.addEventListener("change", changed)
      return () => query.removeEventListener("change", changed)
    },
    () => matchMedia(DESKTOP).matches,
    () => false,
  )
}

/** What the library is, at the top of its front page. */
function LibraryHeading() {
  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold tracking-tight">Library</h1>
      <p className="text-sm text-muted-foreground">
        Documents and files made by the agents of this workspace, and ones you have given them.
        Every agent in the workspace shares this library, and what is in it is kept here whatever
        happens to a computer.
      </p>
    </div>
  )
}

/**
 * The library's place until its list of files is here: the list where the list goes, and beside
 * it the file that was asked for, or the front page with nothing on it yet.
 */
function LibraryPlaceholder({ opening }: { opening: boolean }) {
  const desktop = useDesktop()
  const slot = useAtomValue(sidebarSlotAtom)
  return (
    <>
      {desktop ? (
        slot === null ? null : (
          createPortal(<TreePlaceholder />, slot)
        )
      ) : opening ? null : (
        <aside className="w-full shrink-0">
          <TreePlaceholder />
        </aside>
      )}
      <section className={cn("min-w-0 flex-1", !desktop && !opening && "hidden")}>
        {opening ? (
          <DocPlaceholder />
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 pt-10 pb-24">
            <LibraryHeading />
            <Placeholder className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3.5">
              {[0, 1, 2].map((card) => (
                <Skeleton key={card} className="h-45 rounded-2xl" />
              ))}
            </Placeholder>
          </div>
        )}
      </section>
    </>
  )
}

function LibraryPage() {
  const { agentId } = Route.useParams()
  const search = Route.useSearch()
  // Shares the layout's query, so this never fetches on its own.
  const { data: state } = useQuery(agentQuery(agentId))
  const listed = useListedAgent(agentId)
  const agent = state?.agent ?? listed
  return (
    <div className="flex h-full min-h-0">
      <Loads
        key={agentId}
        className="p-8"
        fallback={
          <LibraryPlaceholder opening={search.path !== undefined || search.file !== undefined} />
        }
      >
        <Library agentId={agentId} agentName={agent?.name ?? "Your agent"} />
      </Loads>
      {agent === undefined ? null : <AgentAside agent={agent} />}
    </div>
  )
}

/** The list of files and whichever one is open. It waits for the list. */
function Library({ agentId, agentName }: { agentId: string; agentName: string }) {
  const desktop = useDesktop()
  const slot = useAtomValue(sidebarSlotAtom)
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const api = client.agent(agentId)
  const { data: listing } = useSuspenseQuery(libraryQuery(agentId))
  const files = listing.files
  const paths = useMemo(() => new Set(files.map((file) => file.path)), [files])
  const selected =
    files.find((file) => file.path === search.path) ??
    (search.file === undefined ? undefined : files.find((file) => file.id === search.file))

  const open = useCallback(
    (path?: string, mode?: LibrarySearch["mode"]) =>
      navigate({ search: path === undefined ? {} : { path, ...(mode ? { mode } : {}) } }),
    [navigate],
  )
  // A link by id is settled into the file's place, so the address says where it is.
  useEffect(() => {
    if (selected !== undefined && search.path !== selected.path) {
      void navigate({ search: { ...search, file: undefined, path: selected.path }, replace: true })
    }
  }, [selected, search, navigate])

  // Where new documents and uploads go: the folder last clicked, or the open file's.
  const [chosenDir, setChosenDir] = useState<string>()
  const lastOpen = useRef(selected?.path)
  if (lastOpen.current !== selected?.path) {
    lastOpen.current = selected?.path
    if (chosenDir !== undefined) setChosenDir(undefined)
  }
  const dir = chosenDir ?? (selected === undefined ? "" : dirOf(selected.path))

  const refresh = () => queryClient.invalidateQueries({ queryKey: libraryKey(agentId) })
  const upload = useMutation({
    mutationFn: (file: File) =>
      api.upload({ name: file.name, type: file.type, body: file }, undefined, dir),
    onSettled: refresh,
  })
  const create = useMutation({
    mutationFn: () =>
      api.createLibraryFile(dir === "" ? "Untitled.md" : `${dir}/Untitled.md`, "# Untitled\n\n"),
    onSuccess: async (file) => {
      await refresh()
      await open(file.path, "split")
    },
  })
  const restore = useMutation({
    mutationFn: (fileId: string) => api.restoreLibraryFile(fileId),
    onSuccess: async (file) => {
      await refresh()
      await open(file.path)
    },
  })
  const failure = upload.error ?? create.error ?? restore.error

  const recent = useMemo(
    () => [...files].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8),
    [files],
  )

  const tree = (
    <LibraryTree
      agentId={agentId}
      files={files}
      deleted={listing.deleted}
      selected={selected?.path}
      dir={dir}
      onDir={setChosenDir}
      onNew={() => create.mutate()}
      onUpload={(file) => upload.mutate(file)}
      onRestore={(fileId) => restore.mutate(fileId)}
      busy={upload.isPending || create.isPending}
    />
  )

  return (
    <>
      {/* On a wide screen the list is in the sidebar, in place of the agents and their chats,
          and with the sidebar hidden it is hidden too. On a narrow one it is here, until a file
          is opened. */}
      {desktop ? (
        slot === null ? null : (
          createPortal(tree, slot)
        )
      ) : (
        <aside className={cn("shrink-0", selected === undefined ? "w-full" : "hidden")}>
          {tree}
        </aside>
      )}
      <section className={cn("min-w-0 flex-1", !desktop && selected === undefined && "hidden")}>
        {selected !== undefined ? (
          <Viewer
            // Another file starts afresh: nothing of the last one's editing carries over.
            key={selected.id}
            agentId={agentId}
            agentName={agentName}
            file={selected}
            files={files}
            view={listing.view}
            mode={search.mode ?? "read"}
            onMode={(mode) =>
              void navigate({
                search: { path: selected.path, ...(mode === "read" ? {} : { mode }) },
                replace: true,
              })
            }
            onOpen={(path) => void open(path)}
          />
        ) : (
          <div className="h-full overflow-y-auto">
            <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 pt-10 pb-24">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <LibraryHeading />
                <Button disabled={create.isPending} onClick={() => create.mutate()}>
                  <NotePencilIcon /> New document
                </Button>
              </div>
              {failure ? (
                <p role="alert" className="text-sm text-destructive">
                  {failure.message}
                </p>
              ) : null}
              {search.path !== undefined || search.file !== undefined ? (
                <p role="alert" className="text-sm text-muted-foreground">
                  That file is no longer in the library. If it was deleted, it may be under
                  “Recently deleted”.
                </p>
              ) : null}
              <SharedSites agentId={agentId} files={files} />
              {files.length === 0 ? (
                <p className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  <UploadSimpleIcon className="size-5" />
                  Nothing here yet. Ask your agent to write you something, or start a document
                  yourself.
                </p>
              ) : (
                <section aria-label="Recent" className="flex flex-col gap-3">
                  <h2 className="text-[0.8125rem] font-medium text-muted-foreground">Recent</h2>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3.5">
                    {recent.map((file) => (
                      <RecentCard
                        key={file.id}
                        agentId={agentId}
                        agentName={agentName}
                        file={file}
                        view={listing.view}
                        paths={paths}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  )
}
