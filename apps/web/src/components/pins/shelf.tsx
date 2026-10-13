import {
  type LibraryFile,
  type LibraryListing,
  type Pin,
  pinnedFile,
  pinTitle,
} from "@do-computer/protocol"
import { FileIcon, PushPinSlashIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { DocMarkdown } from "@/components/library/doc-markdown"
import { KindIcon } from "@/components/library/tree"
import { client } from "@/lib/client"
import { libraryQuery, libraryTextKey } from "@/lib/collections"
import { formatWhen, kindOf, shownAt } from "@/lib/library"
import { usePinning, usePins } from "@/lib/pins"
import { cn } from "@/lib/utils"
import { useThemedFrame } from "@/lib/visual-theme"

/** How long a pin says that it has just changed. */
const FRESH_MS = 4_000

/** Whether what a pin shows changed a moment ago, while it was being looked at. */
function useJustChanged(at: number): boolean {
  const [fresh, setFresh] = useState(false)
  const seen = useRef(at)
  useEffect(() => {
    if (seen.current === at) return
    seen.current = at
    setFresh(true)
    const timer = setTimeout(() => setFresh(false), FRESH_MS)
    return () => clearTimeout(timer)
  }, [at])
  return fresh
}

/** Whether a file can be drawn small: a page, a document or a picture. */
const drawsSmall = (file: LibraryFile) => {
  const kind = kindOf(file)
  return kind === "page" || kind === "markdown" || kind === "image"
}

/**
 * A pinned file drawn at half its size, as what it is. It is only to be looked at: a press
 * anywhere on it opens the file itself.
 */
function Small({
  agentId,
  file,
  listing,
}: {
  agentId: string
  file: LibraryFile
  listing: LibraryListing
}) {
  const api = client.agent(agentId)
  const kind = kindOf(file)
  const url = api.libraryViewUrl(listing.view, file.path)
  const { data: text } = useQuery({
    queryKey: libraryTextKey(agentId, file.id, file.rev),
    queryFn: () => api.libraryText(file.id, file.rev),
    // A revision's content never changes.
    staleTime: Number.POSITIVE_INFINITY,
    enabled: kind === "markdown",
  })
  const paths = useMemo(() => new Set(listing.files.map((entry) => entry.path)), [listing.files])
  if (kind === "image") {
    return <img src={`${url}?v=${file.rev}`} alt="" className="size-full object-cover object-top" />
  }
  if (kind === "markdown") {
    return text === undefined ? null : (
      <div className="w-[200%] origin-top-left scale-50">
        <DocMarkdown
          agentId={agentId}
          file={file}
          text={text}
          view={listing.view}
          paths={paths}
          className="px-7 pt-6"
        />
      </div>
    )
  }
  return <SmallPage url={url} title={file.name} loaded={shownAt(listing.files, file)} />
}

/**
 * A page drawn small. It is told the app's colors, as a page is wherever the app shows one,
 * and loaded again when it or anything beside it changes, so it shows what is there.
 */
function SmallPage({ url, title, loaded }: { url: string; title: string; loaded: number }) {
  const { frame, src, onLoad } = useThemedFrame(url, loaded)
  return (
    <iframe
      key={loaded}
      ref={frame}
      src={src}
      onLoad={onLoad}
      title={title}
      tabIndex={-1}
      // No `allow-same-origin`: the page must not be the app, though the app serves it.
      sandbox="allow-scripts"
      className="h-[200%] w-[200%] origin-top-left scale-50 border-0 bg-white"
    />
  )
}

/** What opens a pinned file: beside the chat where there is one, and otherwise in the library. */
function Opener({
  agentId,
  fileId,
  onOpen,
  label,
  className,
  children,
}: {
  agentId: string
  fileId: string
  onOpen: ((fileId: string) => void) | undefined
  label: string
  className: string
  children?: ReactNode
}) {
  return onOpen === undefined ? (
    <Link
      to="/a/$agentId/library"
      params={{ agentId }}
      search={{ file: fileId }}
      aria-label={label}
      title="Open in the library"
      className={className}
    >
      {children}
    </Link>
  ) : (
    <button
      type="button"
      aria-label={label}
      title="Open beside the chat"
      onClick={() => onOpen(fileId)}
      className={className}
    >
      {children}
    </button>
  )
}

function Unpin({
  title,
  onUnpin,
  className,
}: {
  title: string
  onUnpin: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={`Unpin ${title}`}
      title="Unpin"
      onClick={onUnpin}
      className={cn(
        "pointer-events-auto grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40",
        className,
      )}
    >
      <PushPinSlashIcon className="size-3.5" />
    </button>
  )
}

/** When a pin last changed, or that it just did. */
function Changed({ fresh, at }: { fresh: boolean; at: number }) {
  return (
    <span className={cn("shrink-0 text-xs text-muted-foreground", fresh && "text-primary")}>
      {fresh ? "Just changed" : formatWhen(at)}
    </span>
  )
}

/** One thing that is pinned: drawn small when it is the first and can be, and otherwise named. */
function Pinned({
  agentId,
  pin,
  file,
  listing,
  large,
  onOpen,
  onUnpin,
}: {
  agentId: string
  pin: Pin
  file: LibraryFile
  listing: LibraryListing
  large: boolean
  onOpen: ((fileId: string) => void) | undefined
  onUnpin: () => void
}) {
  const title = pinTitle(pin, file)
  const at = shownAt(listing.files, file)
  const fresh = useJustChanged(at)
  const hidden =
    "opacity-0 group-hover/pin:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
  if (!large) {
    return (
      <li className="group/pin flex items-center gap-1 rounded-xl pr-1.5 hover:bg-surface">
        <Opener
          agentId={agentId}
          fileId={file.id}
          onOpen={onOpen}
          label={`Open ${title}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-2 pr-1 pl-2.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <KindIcon file={file} />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <Changed fresh={fresh} at={at} />
        </Opener>
        <Unpin title={title} onUnpin={onUnpin} className={hidden} />
      </li>
    )
  }
  return (
    <li
      className={cn(
        "group/pin relative rounded-xl bg-card shadow-raised transition-shadow duration-300",
        fresh && "ring-2 ring-primary/50",
      )}
    >
      {/*
        The corners are the tile's own and the picture's own. A frame drawn at half size is
        painted apart from the page, and what lies over it is too: left to the tile to cut to
        its corners, the name under the picture was at times painted square across them.
      */}
      <div inert className="pointer-events-none h-40 overflow-hidden rounded-t-xl bg-background">
        <Small agentId={agentId} file={file} listing={listing} />
      </div>
      {/* Over the whole of it, the picture and the name alike. */}
      <Opener
        agentId={agentId}
        fileId={file.id}
        onOpen={onOpen}
        label={`Open ${title}`}
        className="absolute inset-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset"
      />
      <div className="pointer-events-none relative flex items-center gap-2 border-t py-1.5 pr-1.5 pl-2.5 text-sm">
        <KindIcon file={file} />
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        <Changed fresh={fresh} at={at} />
        <Unpin title={title} onUnpin={onUnpin} className={hidden} />
      </div>
    </li>
  )
}

/**
 * What is pinned to an agent, under its face: the first drawn small as what it is and kept
 * current, the rest by name. Each opens beside the chat. With nothing pinned there is nothing
 * here.
 */
export function PinnedShelf({
  agentId,
  onOpen,
}: {
  agentId: string
  /** Opens a file beside the chat, by its id. Without it a pin opens in the library. */
  onOpen?: ((fileId: string) => void) | undefined
}) {
  const pins = usePins(agentId)
  const some = pins !== undefined && pins.length > 0
  const { data: listing } = useQuery({ ...libraryQuery(agentId), enabled: some })
  const { unpin } = usePinning(agentId)
  if (!some || listing === undefined) return null
  return (
    <section aria-label="Pinned" className="flex max-h-[55%] shrink-0 flex-col border-t">
      <h3 className="px-5 pt-4 pb-2 text-[0.8125rem] font-medium text-muted-foreground">Pinned</h3>
      <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto px-2.5 pt-px pb-3">
        {pins.map((pin, index) => {
          const file = pinnedFile(pin, listing.files)
          const off = () => unpin.mutate(pin.fileId)
          if (file === undefined) {
            const title = pinTitle(pin)
            return (
              // Its file was deleted. The pin stays until it is taken off, since the file can be brought back.
              <li key={pin.fileId} className="flex items-center gap-2.5 py-2 pr-1.5 pl-2.5 text-sm">
                <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {title} <span className="text-xs">is no longer in the library</span>
                </span>
                <Unpin title={title} onUnpin={off} />
              </li>
            )
          }
          return (
            <Pinned
              key={pin.fileId}
              agentId={agentId}
              pin={pin}
              file={file}
              listing={listing}
              large={index === 0 && drawsSmall(file)}
              onOpen={onOpen}
              onUnpin={off}
            />
          )
        })}
      </ul>
    </section>
  )
}
