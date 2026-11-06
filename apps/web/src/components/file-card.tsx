import { INLINE_IMAGE_TYPES, type LibraryFile } from "@do-computer/protocol"
import {
  DownloadSimpleIcon,
  FileIcon,
  GlobeIcon,
  LockIcon,
  PushPinIcon,
  ShareNetworkIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { embedsInChat, LibraryEmbed } from "@/components/embed/library-embed"
import { client } from "@/lib/client"
import { libraryQuery } from "@/lib/collections"
import { SharePopover } from "@/components/sites/share"
import { formatBytes, isViewable } from "@/lib/library"
import { usePin } from "@/lib/pins"
import { cn } from "@/lib/utils"
import { siteOfFile, useSites } from "@/lib/sites"

export { formatBytes }

/** Raster images are previewed; the server serves only these types in place. */
const PREVIEWABLE = INLINE_IMAGE_TYPES

/** A file's card: one piece, its name the way in, and what is done to it beside the name. */
const CARD =
  "group/file relative flex h-11 w-fit max-w-full items-center gap-0.5 rounded-xl bg-card text-sm shadow-raised"
const OPEN =
  "flex h-full min-w-0 items-center gap-2.5 rounded-xl pr-3.5 pl-3 outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/40"
/**
 * What is done to it. Under a finger, quiet buttons at the end of the card. With a pointer, the
 * card is its name alone, and they come out beside it while it is pointed at.
 */
const ACTIONS =
  "flex shrink-0 items-center gap-0.5 pr-1.5 transition-opacity [@media(hover:hover)]:absolute [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:left-full [@media(hover:hover)]:-translate-y-1/2 [@media(hover:hover)]:pl-1 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/file:opacity-100 [@media(hover:hover)]:group-hover/file:opacity-100 [@media(hover:hover)]:has-[[aria-pressed=true]]:opacity-100 [@media(hover:none)]:-ml-2"
/** One of them: a quiet button, with no lines between. */
const ACTION =
  "flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"

/**
 * A file from the library, in a chat: the thing itself when it is a picture, a film, a sound or
 * a table, a way into the library when it is something that can be shown there, and a download
 * either way.
 */
export function FileCard({
  agentId,
  file,
  onOpen,
}: {
  agentId: string
  file: LibraryFile
  /** Open the file where the card is, instead of going to the library for it. */
  onOpen?: () => void
}) {
  const url = client.agent(agentId).libraryFileUrl(file.id)
  const viewable = isViewable(file)
  // What can be played or read here is asked for as the library has it now: it may have been
  // changed or moved since it was sent, and one that is gone is only its card.
  const embeds = file.path !== undefined && embedsInChat(file)
  const { data: listing } = useQuery({ ...libraryQuery(agentId), enabled: embeds })
  const kept = embeds ? listing?.files.find((entry) => entry.id === file.id) : undefined
  // Shared with a link, or the way to share it. One from before files had a place has none.
  const site = siteOfFile(useSites(agentId), file.path ?? "")
  const share =
    file.path === undefined ? null : (
      <SharePopover agentId={agentId} site={site} path={file.path}>
        <button
          type="button"
          aria-label={
            site === undefined ? `Share ${file.name}` : `${file.name} is shared with a link`
          }
          title={site === undefined ? "Share with a link" : "Shared with a link"}
          className={ACTION}
        >
          {site === undefined ? (
            <ShareNetworkIcon className="size-4" />
          ) : site.public ? (
            <GlobeIcon className="size-4" />
          ) : (
            <LockIcon className="size-4" />
          )}
        </button>
      </SharePopover>
    )
  // Pinned, it stays beside the chat, under the agent's face.
  const pin = usePin(agentId, file)
  const pinning =
    file.path === undefined ? null : (
      <button
        type="button"
        aria-pressed={pin.pinned}
        aria-label={pin.pinned ? `Unpin ${file.name}` : `Pin ${file.name}`}
        title={pin.pinned ? "Pinned beside the chat. Press to unpin" : "Pin beside the chat"}
        disabled={pin.pending}
        onClick={pin.toggle}
        className={cn(
          ACTION,
          pin.pinned && "text-primary hover:text-primary",
        )}
      >
        <PushPinIcon weight={pin.pinned ? "fill" : "regular"} className="size-4" />
      </button>
    )
  const label = (
    <>
      <FileIcon weight="duotone" className="size-5 shrink-0 text-primary dark:text-[color-mix(in_oklab,var(--primary)_55%,white)]" />
      <span className="min-w-0 truncate font-medium" title={formatBytes(file.size)}>
        {file.name}
      </span>
    </>
  )
  return (
    <div className={cn("flex max-w-full flex-col gap-2", embeds ? "w-full" : "w-fit")}>
      {PREVIEWABLE.has(file.contentType) ? (
        <img src={url} alt={file.name} loading="lazy" className="max-h-80 rounded-2xl border" />
      ) : null}
      {kept === undefined || listing === undefined ? null : (
        <LibraryEmbed agentId={agentId} file={kept} view={listing.view} />
      )}
      {viewable ? (
        <div className={CARD}>
          {onOpen === undefined ? (
            <Link
              to="/a/$agentId/library"
              params={{ agentId }}
              search={{ file: file.id }}
              title="Open in the library"
              className={OPEN}
            >
              {label}
            </Link>
          ) : (
            <button
              type="button"
              title="Open beside the chat"
              onClick={onOpen}
              className={cn(OPEN, "text-left")}
            >
              {label}
            </button>
          )}
          <span className={ACTIONS}>
            <a
              href={url}
              download={file.name}
              aria-label={`Download ${file.name}`}
              title="Download"
              className={ACTION}
            >
              <DownloadSimpleIcon className="size-4" />
            </a>
            {share}
            {pinning}
          </span>
        </div>
      ) : (
        <div className={CARD}>
          <a href={url} download={file.name} className={OPEN}>
            {label}
            <DownloadSimpleIcon className="ml-2 size-4 shrink-0 text-muted-foreground" />
          </a>
          {share === null && pinning === null ? null : (
            <span className={ACTIONS}>
              {share}
              {pinning}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
