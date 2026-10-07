import type { LibraryFile } from "@durable-computer/protocol"
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  CaretRightIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  CodeIcon,
  ColumnsIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  EyeIcon,
  FileIcon,
  GlobeIcon,
  LockIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { client } from "@/lib/client"
import { libraryKey, libraryVersionsKey } from "@/lib/collections"
import { formatBytes, formatFull, formatWhen, kindOf } from "@/lib/library"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"
import { DocMarkdown } from "./doc-markdown.tsx"
import { type SaveState, useDocument } from "./use-document.ts"

/** How a file is being looked at. Which of these a file has depends on its kind. */
export type ViewMode = "read" | "edit" | "split" | "source"

const who = (by: "agent" | "user", agentName: string) => (by === "agent" ? agentName : "You")

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: readonly (readonly [value: T, label: string, icon: ReactNode])[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 rounded-lg bg-accent p-0.5">
      {options.map(([option, text, icon]) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&_svg]:size-3.5",
            option === value && "bg-background text-foreground shadow-sm",
          )}
        >
          {icon}
          <span className="hidden sm:inline">{text}</span>
        </button>
      ))}
    </div>
  )
}

const SAVE_WORDS: Record<SaveState, string> = {
  clean: "",
  dirty: "Saving…",
  saving: "Saving…",
  saved: "Saved",
  conflict: "Not saved",
  error: "Could not save",
}

/** The versions of a file that are still kept, each of which it can be put back to. */
function History({
  agentId,
  agentName,
  file,
}: {
  agentId: string
  agentName: string
  file: LibraryFile
}) {
  const api = client.agent(agentId)
  const [open, setOpen] = useState(false)
  const { data: versions } = useQuery({
    queryKey: libraryVersionsKey(agentId, file.id),
    queryFn: () => api.libraryVersions(file.id),
    enabled: open,
  })
  const revert = useMutation({
    mutationFn: (rev: number) => api.revertLibraryFile(file.id, rev),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: libraryKey(agentId) })
      void queryClient.invalidateQueries({ queryKey: libraryVersionsKey(agentId, file.id) })
    },
  })
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="History" title="History" />}
      >
        <ClockCounterClockwiseIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Versions</DropdownMenuLabel>
          <DropdownMenuItem disabled>
            <CheckIcon />
            <span>
              <span className="block">Current</span>
              <span className="block text-xs font-normal text-muted-foreground">
                {who(file.updatedBy, agentName)} · {formatFull(file.updatedAt)}
              </span>
            </span>
          </DropdownMenuItem>
          {(versions ?? []).map((version) => (
            <DropdownMenuItem key={version.rev} onClick={() => revert.mutate(version.rev)}>
              <ClockCounterClockwiseIcon />
              <span>
                <span className="block">Put back this version</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {who(version.by, agentName)} · {formatFull(version.at)} ·{" "}
                  {formatBytes(version.size)}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
          {versions !== undefined && versions.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              It has not been changed since it was made.
            </p>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const FORMATS: readonly (readonly [label: string, title: string, before: string, after: string])[] =
  [
    ["B", "Bold", "**", "**"],
    ["I", "Italic", "*", "*"],
    ["H", "Heading", "## ", ""],
    ["•", "List item", "- ", ""],
    ["☑", "Task", "- [ ] ", ""],
    ["<>", "Code", "`", "`"],
    ["Link", "Link", "[", "](https://)"],
  ]

/** A plain text editor. With `markdown` it has a row of buttons that write the common marks. */
function Editor({
  text,
  onChange,
  markdown,
  label,
}: {
  text: string
  onChange: (text: string) => void
  markdown: boolean
  label: string
}) {
  const area = useRef<HTMLTextAreaElement>(null)
  const format = (before: string, after: string) => {
    const element = area.current
    if (element === null) return
    const { selectionStart: start, selectionEnd: end, value } = element
    const chosen = value.slice(start, end) || "text"
    onChange(value.slice(0, start) + before + chosen + after + value.slice(end))
    // Once the new text is in the box, leave what was wrapped selected.
    requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(start + before.length, start + before.length + chosen.length)
    })
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {markdown ? (
        <div className="flex shrink-0 items-center gap-0.5 border-b px-3 py-1.5">
          {FORMATS.map(([label, title, before, after]) => (
            <button
              key={title}
              type="button"
              title={title}
              aria-label={title}
              onClick={() => format(before, after)}
              className="h-7 min-w-7 rounded-md px-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {label}
            </button>
          ))}
          <span className="ml-auto pr-1 text-xs text-muted-foreground">
            {text.split(/\s+/).filter(Boolean).length} words
          </span>
        </div>
      ) : null}
      <textarea
        ref={area}
        aria-label={label}
        spellCheck={markdown}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-0 w-full flex-1 resize-none bg-transparent px-6 py-6 font-mono text-[0.8125rem] leading-relaxed outline-none"
      />
    </div>
  )
}

/** An HTML document shown as the page it is, in a frame that keeps it apart from the app. */
function PageView({
  agentId,
  file,
  view,
  stamp,
  onOpen,
}: {
  agentId: string
  file: LibraryFile
  view: string
  /** Changes when the page or anything beside it does, so that what is shown is what is there. */
  stamp: number
  onOpen: (path: string) => void
}) {
  const url = client.agent(agentId).libraryViewUrl(view, file.path)
  const frame = useRef<HTMLIFrameElement>(null)
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    // A link from the page to a document that is not a page asks to be opened here.
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      const data = event.data as { type?: unknown; path?: unknown } | null
      if (data?.type === "dc-library-open" && typeof data.path === "string") onOpen(data.path)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [onOpen])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reload"
          title="Reload"
          onClick={() => setReloads((count) => count + 1)}
        >
          <ArrowClockwiseIcon />
        </Button>
        <p className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-accent px-3 text-xs text-muted-foreground">
          <LockIcon className="size-3.5 shrink-0" />
          <span className="truncate">{file.path}</span>
        </p>
        <span
          className="hidden shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] text-muted-foreground sm:inline"
          title="A page runs on its own, apart from the app and your account. It can load what is in the library beside it."
        >
          sandboxed
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open in a new tab"
          title="Open in a new tab"
          render={<a href={url} target="_blank" rel="noreferrer" />}
        >
          <ArrowSquareOutIcon />
        </Button>
      </div>
      <iframe
        key={`${stamp}:${reloads}`}
        ref={frame}
        src={url}
        title={file.name}
        // No `allow-same-origin`: the page must not be the app, though the app serves it.
        sandbox="allow-scripts allow-popups allow-forms allow-modals"
        className="min-h-0 w-full flex-1 bg-white"
      />
    </div>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">
      <div className="flex max-w-xs flex-col items-center gap-3">{children}</div>
    </div>
  )
}

/** A file that is text of some kind: read, edited, or both side by side. */
function TextBody({
  agentId,
  agentName,
  file,
  view,
  paths,
  mode,
  stamp,
  onOpen,
  onState,
}: {
  agentId: string
  agentName: string
  file: LibraryFile
  view: string
  paths: ReadonlySet<string>
  mode: ViewMode
  stamp: number
  onOpen: (path: string) => void
  onState: (state: SaveState) => void
}) {
  const kind = kindOf(file)
  const document = useDocument(agentId, file)
  const { state } = document
  useEffect(() => onState(state), [state, onState])

  if (kind === "page" && mode === "read") {
    return <PageView agentId={agentId} file={file} view={view} stamp={stamp} onOpen={onOpen} />
  }
  if (document.failed) return <Notice>This file could not be read. Try again.</Notice>
  if (document.text === undefined) return <Notice>Loading…</Notice>
  const { text } = document

  const rendered = (
    <DocMarkdown
      agentId={agentId}
      file={file}
      text={text}
      view={view}
      paths={paths}
      className="mx-auto max-w-3xl px-6 pt-10 pb-24 md:px-9"
    />
  )
  const editor = (
    <Editor
      text={text}
      onChange={document.edit}
      markdown={kind === "markdown"}
      label={`Edit ${file.name}`}
    />
  )
  return (
    <div className="flex h-full min-h-0 flex-col">
      {state === "conflict" ? (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-surface px-4 py-2 text-sm"
        >
          <span className="min-w-0 flex-1">
            {agentName} changed this file while you were editing it. Your changes are not saved.
          </span>
          <Button size="sm" variant="outline" onClick={document.takeTheirs}>
            Show theirs
          </Button>
          <Button size="sm" onClick={document.keepMine}>
            Keep mine
          </Button>
        </div>
      ) : null}
      {kind === "markdown" && mode === "read" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">{rendered}</div>
      ) : kind === "markdown" && mode === "split" ? (
        <div className="grid min-h-0 flex-1 grid-cols-2">
          {editor}
          <div className="min-h-0 overflow-y-auto border-l">{rendered}</div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">{editor}</div>
      )}
    </div>
  )
}

/**
 * One file from the library, shown as what it is: a document to read and edit, a page, a
 * picture, text, or for anything else its name and a way to download it.
 */
export function Viewer({
  agentId,
  agentName,
  file,
  files,
  view,
  mode,
  onMode,
  onOpen,
}: {
  agentId: string
  agentName: string
  file: LibraryFile
  files: readonly LibraryFile[]
  view: string
  mode: ViewMode
  onMode: (mode: ViewMode) => void
  /** Open another file, or with nothing, go back to the library's front page. */
  onOpen: (path?: string) => void
}) {
  const api = client.agent(agentId)
  const kind = kindOf(file)
  const [saveState, setSaveState] = useState<SaveState>("clean")
  const [renaming, setRenaming] = useState<string>()
  const paths = useMemo(() => new Set(files.map((entry) => entry.path)), [files])
  // A page shows what is beside it, so it is as new as the newest file in its top folder.
  const stamp = useMemo(() => {
    const top = file.path.includes("/") ? `${file.path.split("/")[0]}/` : ""
    return Math.max(
      ...files.filter((entry) => entry.path.startsWith(top)).map((entry) => entry.updatedAt),
    )
  }, [files, file.path])

  const refresh = () => queryClient.invalidateQueries({ queryKey: libraryKey(agentId) })
  const move = useMutation({
    mutationFn: (path: string) => api.moveLibraryFile(file.id, path),
    onSuccess: async (moved) => {
      setRenaming(undefined)
      await refresh()
      onOpen(moved.path)
    },
  })
  const remove = useMutation({
    mutationFn: () => api.removeLibraryFile(file.id),
    onSuccess: async () => {
      await refresh()
      onOpen()
    },
  })

  const parts = file.path.split("/")
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b pr-2 pl-3">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label="Back to the library"
          onClick={() => onOpen()}
        >
          <ArrowLeftIcon />
        </Button>
        {renaming === undefined ? (
          <nav
            aria-label="Where this file is"
            className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground"
          >
            <Link
              to="/a/$agentId/library"
              params={{ agentId }}
              search={{}}
              className="hidden hover:text-foreground md:inline"
            >
              Library
            </Link>
            {parts.map((part, index) => (
              <span
                key={`${index}:${part}`}
                className={cn(
                  "flex min-w-0 items-center gap-1",
                  index < parts.length - 1 && "hidden md:flex",
                )}
              >
                <CaretRightIcon className="hidden size-3 shrink-0 md:block" />
                {index === parts.length - 1 ? (
                  // Not a heading: a document brings its own, and this is only its file name.
                  <span aria-current="page" className="truncate font-medium text-foreground">
                    {part}
                  </span>
                ) : (
                  <span className="truncate">{part}</span>
                )}
              </span>
            ))}
          </nav>
        ) : (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (renaming.trim() === file.path) setRenaming(undefined)
              else move.mutate(renaming)
            }}
          >
            <Input
              autoFocus
              aria-label="Folder and name"
              value={renaming}
              onChange={(event) => setRenaming(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setRenaming(undefined)
              }}
              className="h-8 max-w-md text-sm"
            />
            <Button type="submit" size="sm" disabled={move.isPending}>
              Save
            </Button>
          </form>
        )}
        {renaming === undefined ? (
          <p className="hidden shrink-0 pl-1 text-xs text-muted-foreground lg:block">
            {who(file.updatedBy, agentName)} · {formatWhen(file.updatedAt)} ·{" "}
            {formatBytes(file.size)}
          </p>
        ) : null}
        <p
          aria-live="polite"
          className={cn(
            "shrink-0 text-xs text-muted-foreground",
            (saveState === "error" || saveState === "conflict") && "text-destructive",
          )}
        >
          {move.isError ? move.error.message : SAVE_WORDS[saveState]}
        </p>
        <div className="flex-1" />
        {kind === "markdown" ? (
          <Segmented
            label="How to show it"
            value={mode === "source" ? "read" : mode}
            onChange={onMode}
            options={[
              ["read", "Read", <EyeIcon key="i" />],
              ["edit", "Edit", <PencilSimpleIcon key="i" />],
              ["split", "Split", <ColumnsIcon key="i" />],
            ]}
          />
        ) : kind === "page" ? (
          <Segmented
            label="How to show it"
            value={mode === "read" ? "read" : "source"}
            onChange={onMode}
            options={[
              ["read", "Page", <GlobeIcon key="i" />],
              ["source", "Source", <CodeIcon key="i" />],
            ]}
          />
        ) : null}
        <History agentId={agentId} agentName={agentName} file={file} />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="More" title="More" />}
          >
            <DotsThreeIcon weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => setRenaming(file.path)}>
              <PencilSimpleIcon /> Rename or move
            </DropdownMenuItem>
            <DropdownMenuItem
              render={<a href={api.libraryFileUrl(file.id)} download={file.name} />}
            >
              <DownloadSimpleIcon /> Download
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => remove.mutate()}>
              <TrashIcon /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="min-h-0 flex-1">
        {kind === "image" ? (
          <div className="grid h-full place-items-center overflow-auto bg-[repeating-conic-gradient(var(--surface)_0_25%,transparent_0_50%)] bg-size-[22px_22px] p-8">
            <img
              // The revision is only there so that a changed picture is fetched again.
              src={`${api.libraryViewUrl(view, file.path)}?v=${file.rev}`}
              alt={file.name}
              className="max-h-full max-w-full rounded-lg shadow-lg"
            />
          </div>
        ) : kind === "other" ? (
          <Notice>
            <FileIcon className="size-10" />
            <p className="text-base font-medium text-foreground">{file.name}</p>
            <p>{formatBytes(file.size)} · This kind of file cannot be shown here yet.</p>
            <Button
              variant="outline"
              render={<a href={api.libraryFileUrl(file.id)} download={file.name} />}
            >
              <DownloadSimpleIcon /> Download
            </Button>
          </Notice>
        ) : (
          <TextBody
            // A different file is a different edit: nothing typed carries over.
            key={file.id}
            agentId={agentId}
            agentName={agentName}
            file={file}
            view={view}
            paths={paths}
            mode={mode}
            stamp={stamp}
            onOpen={onOpen}
            onState={setSaveState}
          />
        )}
      </div>
    </div>
  )
}
