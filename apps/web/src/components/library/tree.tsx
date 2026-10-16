import type { DeletedLibraryFile, LibraryFile } from "@do-computer/protocol"
import {
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  CloudCheckIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FilePdfIcon,
  FileTextIcon,
  FileVideoIcon,
  FolderIcon,
  FolderOpenIcon,
  GlobeIcon,
  LockIcon,
  NotePencilIcon,
  ShareNetworkIcon,
  TableIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import { useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { SharePopover } from "@/components/sites/share"
import { type Folder, formatBytes, formatWhen, kindOf, treeOf } from "@/lib/library"
import { siteOfFile, siteOfFolder, useSites } from "@/lib/sites"
import { cn } from "@/lib/utils"

/** The picture that stands for a file of each kind. Documents and pages get a little color. */
export function KindIcon({ file, className }: { file: LibraryFile; className?: string }) {
  const kind = kindOf(file)
  const size = cn("size-4 shrink-0", className)
  if (kind === "markdown") return <FileTextIcon className={cn(size, "text-primary")} />
  if (kind === "page")
    return <GlobeIcon className={cn(size, "text-amber-600 dark:text-amber-400")} />
  if (kind === "image") {
    return <FileImageIcon className={cn(size, "text-violet-600 dark:text-violet-400")} />
  }
  if (kind === "video") {
    return <FileVideoIcon className={cn(size, "text-rose-600 dark:text-rose-400")} />
  }
  if (kind === "audio") {
    return <FileAudioIcon className={cn(size, "text-sky-600 dark:text-sky-400")} />
  }
  if (kind === "table") {
    return <TableIcon className={cn(size, "text-emerald-600 dark:text-emerald-400")} />
  }
  if (kind === "pdf") return <FilePdfIcon className={cn(size, "text-red-600 dark:text-red-400")} />
  if (kind === "text") return <FileCodeIcon className={size} />
  return <FileIcon className={size} />
}

const ROW =
  "flex h-8 w-full items-center gap-1.5 rounded-lg pr-2 text-left text-sm text-muted-foreground outline-none hover:bg-foreground/6 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"

function FileRow({
  agentId,
  file,
  depth,
  selected,
  label,
}: {
  agentId: string
  file: LibraryFile
  depth: number
  selected: boolean
  label?: string
}) {
  const site = siteOfFile(useSites(agentId), file.path)
  return (
    <li>
      <Link
        to="/a/$agentId/library"
        params={{ agentId }}
        search={{ path: file.path }}
        title={file.path}
        aria-current={selected ? "page" : undefined}
        className={cn(ROW, selected && "bg-card text-foreground shadow-raised hover:bg-card")}
        style={{ paddingLeft: 8 + depth * 14 + 18 }}
      >
        <KindIcon file={file} />
        <span className="truncate">{label ?? file.name}</span>
        {site === undefined ? null : (
          <span
            role="img"
            aria-label={site.public ? "Shared with anyone who has the link" : "Shared with a link"}
            title={site.public ? "Shared with anyone who has the link" : "Shared with a link"}
            className="ml-auto shrink-0"
          >
            {site.public ? <GlobeIcon className="size-3.5" /> : <LockIcon className="size-3.5" />}
          </span>
        )}
      </Link>
    </li>
  )
}

function FolderRows({
  agentId,
  folder,
  depth,
  selected,
  closed,
  toggle,
  dir,
}: {
  agentId: string
  folder: Folder
  depth: number
  selected: string | undefined
  closed: ReadonlySet<string>
  toggle: (path: string) => void
  dir: string
}) {
  const sites = useSites(agentId)
  return (
    <>
      {folder.folders.map((child) => {
        const open = !closed.has(child.path)
        const site = siteOfFolder(sites, child.path)
        return (
          <Collapsible
            key={child.path}
            open={open}
            onOpenChange={() => toggle(child.path)}
            render={<li />}
          >
            <div className="group/folder relative">
              <CollapsibleTrigger
                className={cn(ROW, "pr-8 text-foreground", dir === child.path && "bg-foreground/5")}
                style={{ paddingLeft: 8 + depth * 14 }}
              >
                {open ? (
                  <CaretDownIcon className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
                )}
                {open ? (
                  <FolderOpenIcon className="size-4 shrink-0" />
                ) : (
                  <FolderIcon className="size-4 shrink-0" />
                )}
                <span className="truncate">{child.name}</span>
              </CollapsibleTrigger>
              {/* A folder is shared from its row: the way to is there when it is pointed at,
                and the mark that it is shared is there always. */}
              <SharePopover agentId={agentId} site={site} path={child.path} align="start">
                <button
                  type="button"
                  aria-label={
                    site === undefined
                      ? `Share the folder ${child.name}`
                      : `The folder ${child.name} is shared with a link`
                  }
                  title={site === undefined ? "Share with a link" : "Shared with a link"}
                  className={cn(
                    "absolute top-1 right-1 grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40",
                    site === undefined &&
                      "opacity-0 group-hover/folder:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100",
                  )}
                >
                  {site === undefined ? (
                    <ShareNetworkIcon className="size-3.5" />
                  ) : site.public ? (
                    <GlobeIcon className="size-3.5" />
                  ) : (
                    <LockIcon className="size-3.5" />
                  )}
                </button>
              </SharePopover>
            </div>
            <CollapsibleContent render={<ul />}>
              <FolderRows
                agentId={agentId}
                folder={child}
                depth={depth + 1}
                selected={selected}
                closed={closed}
                toggle={toggle}
                dir={dir}
              />
            </CollapsibleContent>
          </Collapsible>
        )
      })}
      {folder.files.map((file) => (
        <FileRow
          key={file.id}
          agentId={agentId}
          file={file}
          depth={depth}
          selected={file.path === selected}
        />
      ))}
    </>
  )
}

/**
 * The library as a tree of folders, with what can be done to it as a whole: starting a
 * document, uploading, filtering, and bringing back what was deleted.
 */
export function LibraryTree({
  agentId,
  files,
  deleted,
  selected,
  dir,
  onDir,
  onNew,
  onUpload,
  onRestore,
  busy,
  doing,
  restoring,
  title = "Library",
}: {
  agentId: string
  files: readonly LibraryFile[]
  deleted: readonly DeletedLibraryFile[]
  /** The path of the file that is open, if one is. */
  selected: string | undefined
  /** The folder new documents and uploads go into. */
  dir: string
  onDir: (dir: string) => void
  onNew: () => void
  onUpload: (file: File) => void
  onRestore: (fileId: string) => void
  busy: boolean
  /** Which of the two is on its way, so that its button says so. */
  doing?: "new" | "upload" | undefined
  /** The deleted file that is being put back, by id. */
  restoring?: string | undefined
  /** What the list is called, over it. */
  title?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  // Folders start open: a library is small, and what is in it is the point.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const tree = useMemo(() => treeOf(files), [files])
  const toggle = (path: string) => {
    onDir(path)
    setClosed((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }
  const wanted = query.trim().toLowerCase()
  const matches =
    wanted === ""
      ? []
      : files
          .filter((file) => file.path.toLowerCase().includes(wanted))
          .sort((a, b) => a.path.localeCompare(b.path))
  const total = files.reduce((sum, file) => sum + file.size, 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-0.5 pt-3 pr-2 pb-2 pl-4">
        <h2 className="flex-1 text-sm font-medium">
          <Link to="/a/$agentId/library" params={{ agentId }} search={{}}>
            {title}
          </Link>
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New document"
          title={dir === "" ? "New document" : `New document in ${dir}`}
          disabled={busy}
          aria-busy={doing === "new"}
          onClick={onNew}
        >
          {doing === "new" ? <Spinner /> : <NotePencilIcon />}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          aria-label="Choose a file to upload"
          onChange={(event) => {
            for (const file of event.target.files ?? []) onUpload(file)
            event.target.value = ""
          }}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Upload"
          title={dir === "" ? "Upload" : `Upload into ${dir}`}
          disabled={busy}
          aria-busy={doing === "upload"}
          onClick={() => input.current?.click()}
        >
          {doing === "upload" ? <Spinner /> : <UploadSimpleIcon />}
        </Button>
      </div>
      <div className="px-3 pb-2">
        <Input
          type="search"
          aria-label="Filter files"
          placeholder="Filter files"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 text-sm"
        />
      </div>
      <nav aria-label="Files" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {files.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">Nothing here yet.</p>
        ) : wanted !== "" ? (
          matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Nothing matches.</p>
          ) : (
            <ul>
              {matches.map((file) => (
                <FileRow
                  key={file.id}
                  agentId={agentId}
                  file={file}
                  depth={-1}
                  selected={file.path === selected}
                  label={file.path}
                />
              ))}
            </ul>
          )
        ) : (
          <ul>
            <FolderRows
              agentId={agentId}
              folder={tree}
              depth={0}
              selected={selected}
              closed={closed}
              toggle={toggle}
              dir={dir}
            />
          </ul>
        )}
      </nav>
      <div className="flex flex-col gap-1 border-t px-3 py-2.5 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5 px-1">
          <CloudCheckIcon className="size-4 shrink-0" />
          <span>
            Kept safe · {files.length} {files.length === 1 ? "file" : "files"} ·{" "}
            {formatBytes(total)}
          </span>
        </p>
        {deleted.length === 0 ? null : (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40">
              <TrashIcon className="size-4 shrink-0" />
              Recently deleted · {deleted.length}
            </CollapsibleTrigger>
            <CollapsibleContent
              render={<ul aria-label="Recently deleted" />}
              className="max-h-44 overflow-y-auto"
            >
              {deleted.map((file) => (
                <li key={file.id} className="flex items-center gap-1 py-0.5 pl-1">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground" title={file.path}>
                      {file.path}
                    </span>
                    <span>
                      {file.deletedBy === "agent" ? "by a Dood" : "by you"} ·{" "}
                      {formatWhen(file.deletedAt)}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Restore ${file.name}`}
                    title="Restore"
                    disabled={restoring !== undefined}
                    aria-busy={restoring === file.id}
                    onClick={() => onRestore(file.id)}
                  >
                    {restoring === file.id ? <Spinner /> : <ArrowCounterClockwiseIcon />}
                  </Button>
                </li>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  )
}
