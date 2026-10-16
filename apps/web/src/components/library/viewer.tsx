import { type LibraryFile, visualThemeFragment } from "@do-computer/protocol"
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowSquareOutIcon,
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
  PushPinIcon,
  ShareNetworkIcon,
  TableIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { DocPlaceholder } from "@/components/placeholders"
import { Badge } from "@/components/ui/badge"
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { client } from "@/lib/client"
import { libraryKey, libraryVersionsKey } from "@/lib/collections"
import { formatBytes, formatFull, formatWhen, kindOf, shownAt } from "@/lib/library"
import { usePin } from "@/lib/pins"
import { queryClient } from "@/lib/query"
import { siteOfFile, useSites } from "@/lib/sites"
import { useThemedFrame } from "@/lib/visual-theme"
import { cn } from "@/lib/utils"
import { SharePopover } from "@/components/sites/share"
import { LibraryEmbed, LibraryTable } from "@/components/embed/library-embed"
import { DocMarkdown } from "./doc-markdown.tsx"
import { type SaveState, useDocument } from "./use-document.ts"

/** How a file is being looked at. Which of these a file has depends on its kind. */
export type ViewMode = "read" | "edit" | "split" | "source"

/** A table's file is edited as text, which a long one is too slow for. */
const MAX_EDITED_BYTES = 1024 * 1024

const who = (by: "agent" | "user", agentName: string) => (by === "agent" ? agentName : "You")

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  wordless = false,
}: {
  value: T
  options: readonly (readonly [value: T, label: string, icon: ReactNode])[]
  onChange: (value: T) => void
  label: string
  /** Only the pictures, however much room there is: where it floats, and is kept small. */
  wordless?: boolean
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      // Pressing the one that is chosen leaves it chosen: a file is always shown some way.
      onValueChange={([next]) => {
        if (next !== undefined) onChange(next as T)
      }}
      className="shrink-0 gap-0 rounded-lg bg-accent p-0.5"
    >
      {options.map(([option, text, icon]) => (
        <ToggleGroupItem
          key={option}
          value={option}
          // Where the bar is narrow only the picture is shown, so the word is its name too.
          aria-label={text}
          title={text}
          className={cn(
            "h-7 min-w-0 gap-1.5 rounded-md px-2 text-xs font-normal text-muted-foreground hover:bg-transparent aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm aria-pressed:hover:bg-background",
            !wordless && "@xl/viewer:px-2.5",
          )}
        >
          {icon}
          {wordless ? null : <span className="hidden @xl/viewer:inline">{text}</span>}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
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
    // The menu stays while it is put back, and says so. It goes once the file is as it was.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryKey(agentId) })
      setOpen(false)
    },
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: libraryVersionsKey(agentId, file.id) }),
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
            <DropdownMenuItem
              key={version.rev}
              closeOnClick={false}
              disabled={revert.isPending}
              onClick={() => revert.mutate(version.rev)}
            >
              {revert.isPending && revert.variables === version.rev ? (
                <Spinner />
              ) : (
                <ClockCounterClockwiseIcon />
              )}
              <span>
                <span className="block">
                  {revert.isPending && revert.variables === version.rev
                    ? "Putting it back…"
                    : "Put back this version"}
                </span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {who(version.by, agentName)} · {formatFull(version.at)} ·{" "}
                  {formatBytes(version.size)}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
          {versions === undefined ? (
            <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Spinner className="size-3" /> Looking for earlier versions…
            </p>
          ) : versions.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              It has not been changed since it was made.
            </p>
          ) : null}
          {revert.isError ? (
            <p role="alert" className="px-3 py-2 text-xs text-destructive">
              {revert.error.message}
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
            <Button
              key={title}
              variant="ghost"
              size="xs"
              title={title}
              aria-label={title}
              onClick={() => format(before, after)}
              className="h-7 min-w-7 px-1.5 font-semibold text-muted-foreground"
            >
              {label}
            </Button>
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
  className,
}: {
  agentId: string
  file: LibraryFile
  view: string
  /** Changes when the page or anything beside it does, so that what is shown is what is there. */
  stamp: number
  onOpen: (path: string) => void
  className?: string | undefined
}) {
  const url = client.agent(agentId).libraryViewUrl(view, file.path)
  const [reloads, setReloads] = useState(0)
  const loaded = `${stamp}:${reloads}`
  // Every page is told the app's colors, and told again when they change. One written for
  // them follows; any other is its own, and does nothing with what it is told.
  const { frame, src, onLoad, theme } = useThemedFrame(url, loaded)
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
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
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
        <p className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs text-muted-foreground">
          <LockIcon className="size-3.5 shrink-0" />
          <span className="truncate">{file.path}</span>
        </p>
        <Badge
          variant="outline"
          className="hidden text-[0.6875rem] font-normal text-muted-foreground sm:inline-flex"
          title="A page runs on its own, apart from the app and your account. It can load what is in the library beside it."
        >
          sandboxed
        </Badge>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open in a new tab"
          title="Open in a new tab"
          // In a tab of its own it starts as it is here, and not as the device is set.
          render={
            <a href={`${url}${visualThemeFragment(theme)}`} target="_blank" rel="noreferrer" />
          }
        >
          <ArrowSquareOutIcon />
        </Button>
      </div>
      <iframe
        key={loaded}
        ref={frame}
        src={src}
        onLoad={onLoad}
        title={file.name}
        // No `allow-same-origin`: the page must not be the app, though the app serves it.
        sandbox="allow-scripts allow-popups allow-forms allow-modals"
        className="min-h-0 w-full flex-1 bg-white"
      />
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
  inPlace,
  floating,
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
  /** Links to other files open here, where this is shown, and not in the library. */
  inPlace: boolean
  /** The Dood's name and the file's buttons float over the top of this, and it keeps clear. */
  floating: boolean
  onOpen: (path: string) => void
  onState: (state: SaveState) => void
}) {
  const kind = kindOf(file)
  const document = useDocument(agentId, file)
  const { state } = document
  useEffect(() => onState(state), [state, onState])

  // A document that is read runs under what floats over it, and is scrolled out from under.
  // Anything with a bar of its own, or that cannot be scrolled so, starts below.
  const below = floating ? "pt-13" : undefined
  if (kind === "page" && mode === "read") {
    return (
      <PageView
        agentId={agentId}
        file={file}
        view={view}
        stamp={stamp}
        onOpen={onOpen}
        className={below}
      />
    )
  }
  if (document.failed) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyDescription>This file could not be read. Try again.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  if (document.text === undefined) {
    return <DocPlaceholder className={floating ? "pt-19" : undefined} />
  }
  const { text } = document

  const rendered = (
    <DocMarkdown
      agentId={agentId}
      file={file}
      text={text}
      view={view}
      paths={paths}
      onOpen={inPlace ? onOpen : undefined}
      className={cn(
        "mx-auto max-w-3xl px-6 pb-24 md:px-9",
        // Under what floats over it, it starts clear of that.
        floating && mode === "read" && state !== "conflict" ? "pt-19" : "pt-10",
      )}
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
  const reading = kind === "markdown" && mode === "read"
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col",
        reading && state !== "conflict" ? undefined : below,
      )}
    >
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
      {reading ? (
        <div className="relative min-h-0 flex-1">
          {/* What is read goes out of sight at the top, behind what floats there. */}
          {floating ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-linear-to-b from-background to-transparent" />
          ) : null}
          <div className="h-full overflow-y-auto">{rendered}</div>
        </div>
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
  compact = false,
  floating = false,
  slot,
  actions,
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
  /** Shown in a narrow place, such as beside a chat: only the file's name, not where it is. */
  compact?: boolean
  /**
   * The file has the page to its top, under the Dood's name, and what is done to it floats over
   * its corner. Otherwise it has a bar of its own, with its name in it.
   */
  floating?: boolean
  /** Where what floats is put: the end of the row the Dood's name is in, which it keeps clear of. */
  slot?: HTMLElement | null
  /** Buttons for wherever this is shown, after its own. */
  actions?: ReactNode
}) {
  const api = client.agent(agentId)
  const kind = kindOf(file)
  const [saveState, setSaveState] = useState<SaveState>("clean")
  const [renaming, setRenaming] = useState<string>()
  const paths = useMemo(() => new Set(files.map((entry) => entry.path)), [files])
  // The site this file is shared as, if it is: alone, or as the front page of its folder.
  const site = siteOfFile(useSites(agentId), file.path)
  // A page shows what is beside it, so it is as new as the newest file in its top folder.
  const stamp = useMemo(() => shownAt(files, file), [files, file])
  // Pinned to the Dood, it stays beside its chat, under its face.
  const pin = usePin(agentId, file)

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

  // What it is being renamed to, while it is: in place of its name, or of its buttons.
  const rename =
    renaming === undefined ? null : (
      <form
        className={cn("flex items-center gap-2", floating ? "min-w-0" : "min-w-40 flex-1")}
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
          className={cn("h-8 text-sm", floating ? "w-64 min-w-0 shrink" : "max-w-md")}
        />
        <Button type="submit" size="sm" disabled={move.isPending}>
          {move.isPending ? "Saving…" : "Save"}
        </Button>
      </form>
    )
  // How its saving stands, and what went wrong with moving or deleting it.
  const words = remove.isPending
    ? "Deleting…"
    : ((move.error ?? remove.error)?.message ?? SAVE_WORDS[saveState])
  const failed = saveState === "error" || saveState === "conflict" || move.isError || remove.isError
  // Which file it is, and how its saving stands: the start of its bar.
  const where = (
    // Which file it is has the room the buttons leave, and its name is what gives way.
    <div className="flex min-w-0 flex-1 items-center gap-[inherit]">
      {/* Not a heading: a document brings its own, and this is only its file name. */}
      {rename ?? <p className="min-w-0 truncate pl-1 text-sm font-medium">{file.name}</p>}
      <p
        aria-live="polite"
        className={cn(
          "truncate text-xs text-muted-foreground",
          // Beside the name it is whole, up to all the room there is. Beside a name being typed
          // it is cut short first.
          renaming === undefined ? "max-w-[calc(100%-0.5rem)] shrink-0" : "min-w-0",
          failed && "text-destructive",
        )}
      >
        {words}
      </p>
    </div>
  )
  // What is done to it: the end of its bar, or all of what floats over its corner.
  const tools = (
    <>
      {/* While a name is typed in a narrow bar, these give it their room. */}
      <div
        className={cn(
          "contents",
          renaming !== undefined && (floating ? "hidden" : "hidden @3xl/viewer:contents"),
        )}
      >
        {kind === "markdown" ? (
          <Segmented
            wordless={floating}
            label="How to show it"
            value={mode === "source" ? "read" : mode}
            onChange={onMode}
            options={[
              ["read", "Read", <EyeIcon key="i" className="size-3.5" />],
              ["edit", "Edit", <PencilSimpleIcon key="i" className="size-3.5" />],
              ["split", "Split", <ColumnsIcon key="i" className="size-3.5" />],
            ]}
          />
        ) : kind === "page" ? (
          <Segmented
            wordless={floating}
            label="How to show it"
            value={mode === "read" ? "read" : "source"}
            onChange={onMode}
            options={[
              ["read", "Page", <GlobeIcon key="i" className="size-3.5" />],
              ["source", "Source", <CodeIcon key="i" className="size-3.5" />],
            ]}
          />
        ) : kind === "table" ? (
          <Segmented
            wordless={floating}
            label="How to show it"
            value={mode === "read" ? "read" : "source"}
            onChange={onMode}
            options={[
              ["read", "Table", <TableIcon key="i" className="size-3.5" />],
              ["source", "Source", <CodeIcon key="i" className="size-3.5" />],
            ]}
          />
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={pin.pinned}
          aria-label={pin.pinned ? `Unpin from ${agentName}` : `Pin to ${agentName}`}
          title={
            pin.pinned
              ? `Pinned to ${agentName}. Press to unpin`
              : `Pin to ${agentName}: it stays beside the chat`
          }
          disabled={pin.pending}
          onClick={pin.toggle}
          className={cn(pin.pinned && "bg-primary/12 text-primary hover:bg-primary/18")}
        >
          <PushPinIcon weight={pin.pinned ? "fill" : "regular"} />
        </Button>
        {/* Anything can be shared: a page as the page, and the rest as what each is. */}
        <SharePopover agentId={agentId} site={site} path={file.path}>
          <Button
            variant="outline"
            size={compact || floating ? "icon-sm" : "sm"}
            aria-label={site === undefined ? "Share" : "Shared with a link"}
            title={site === undefined ? "Share with a link" : "Shared with a link"}
          >
            {site === undefined ? <ShareNetworkIcon /> : site.public ? <GlobeIcon /> : <LockIcon />}
            <span className={cn("hidden", !compact && !floating && "@xl/viewer:inline")}>
              {site === undefined ? "Share" : "Shared"}
            </span>
          </Button>
        </SharePopover>
        <History agentId={agentId} agentName={agentName} file={file} />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="More" title="More" />}
        >
          <DotsThreeIcon weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {/* Where it is and who last changed it, which nothing else here says. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-normal">
              <span className="block break-all text-foreground">{file.path}</span>
              <span className="block text-xs text-muted-foreground">
                {who(file.updatedBy, agentName)} · {formatWhen(file.updatedAt)} ·{" "}
                {formatBytes(file.size)}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setRenaming(file.path)}>
            <PencilSimpleIcon /> Rename or move
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <a
                // A page takes the app's look with it, so it is the same page out of the app.
                href={`${api.libraryFileUrl(file.id)}${kindOf(file) === "page" ? "?look" : ""}`}
                download={file.name}
              />
            }
          >
            <DownloadSimpleIcon /> Download
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            <TrashIcon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
  return (
    // The bar is laid out by how wide this is, not the window: beside a chat it can be a third of it.
    <div className="@container/viewer relative flex h-full min-h-0 flex-col">
      {floating ? (
        // Over the corner of the page, in the row the Dood's name floats in: the name has the
        // middle, and this has what is left after it.
        slot == null ? null : (
          createPortal(
            <div
              role="toolbar"
              aria-label={file.name}
              data-floats=""
              data-no-drag=""
              className="flex max-w-full min-w-0 items-center gap-1 rounded-xl bg-popover p-1 shadow-raised"
            >
              {rename}
              {words === "" ? null : (
                <p
                  aria-live="polite"
                  className={cn(
                    "min-w-0 truncate px-1.5 text-xs text-muted-foreground",
                    failed && "text-destructive",
                  )}
                >
                  {words}
                </p>
              )}
              {tools}
            </div>,
            slot,
          )
        )
      ) : (
        <header className="flex h-13 shrink-0 items-center gap-1 border-b pr-2 pl-3 @md/viewer:gap-2">
          {compact ? null : (
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label="Back to the library"
              onClick={() => onOpen()}
            >
              <ArrowLeftIcon />
            </Button>
          )}
          {where}
          {tools}
          {actions}
        </header>
      )}
      <div className="min-h-0 flex-1">
        {kind === "image" ? (
          <div
            className={cn(
              "grid h-full place-items-center overflow-auto bg-[repeating-conic-gradient(var(--surface)_0_25%,transparent_0_50%)] bg-size-[22px_22px] p-8",
              floating && "pt-16",
            )}
          >
            <img
              // The revision is only there so that a changed picture is fetched again.
              src={`${api.libraryViewUrl(view, file.path)}?v=${file.rev}`}
              alt={file.name}
              className="max-h-full max-w-full rounded-lg shadow-lg"
            />
          </div>
        ) : kind === "video" || kind === "audio" ? (
          <div
            className={cn("grid h-full place-items-center overflow-auto p-8", floating && "pt-16")}
          >
            <LibraryEmbed agentId={agentId} file={file} view={view} />
          </div>
        ) : kind === "pdf" ? (
          // The browser's own reader, which will not run in a frame that is kept apart. A PDF
          // runs nothing of its own, and the library serves it as a PDF whatever is in it.
          <div className={cn("size-full", floating && "pt-13")}>
            <iframe
              key={`${file.id}:${file.rev}`}
              src={`${api.libraryViewUrl(view, file.path)}?v=${file.rev}#toolbar=0&view=FitH`}
              title={file.name}
              className="size-full border-0 bg-white"
            />
          </div>
        ) : kind === "table" && mode === "read" ? (
          <div className={cn("h-full overflow-auto p-4 md:p-6", floating && "pt-16 md:pt-16")}>
            <LibraryTable agentId={agentId} file={file} view={view} />
          </div>
        ) : kind === "other" || (kind === "table" && file.size > MAX_EDITED_BYTES) ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia className="text-muted-foreground">
                <FileIcon className="size-10" />
              </EmptyMedia>
              <EmptyTitle className="text-base">{file.name}</EmptyTitle>
              <EmptyDescription>
                {formatBytes(file.size)} ·{" "}
                {kind === "table"
                  ? "It is too long to edit here."
                  : "This kind of file cannot be shown here."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                render={<a href={api.libraryFileUrl(file.id)} download={file.name} />}
              >
                <DownloadSimpleIcon /> Download
              </Button>
            </EmptyContent>
          </Empty>
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
            inPlace={compact}
            floating={floating}
            onOpen={onOpen}
            onState={setSaveState}
          />
        )}
      </div>
    </div>
  )
}
