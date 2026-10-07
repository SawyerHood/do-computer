import type { LibraryFile } from "@durable-computer/protocol"
import { DownloadSimpleIcon, FileIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import { client } from "@/lib/client"
import { formatBytes, kindOf } from "@/lib/library"

export { formatBytes }

/** Raster images are previewed; the server serves only these types in place. */
const PREVIEWABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

/**
 * A file from the library, in a chat: a preview when it is an image, a way into the library when
 * it is something that can be shown there, and a download either way.
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
  // A file sent before the library could show documents has no place in it on record.
  const viewable = file.path !== undefined && kindOf(file) !== "other"
  const label = (
    <>
      <FileIcon className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{file.name}</span>
        <span className="block text-xs text-muted-foreground">{formatBytes(file.size)}</span>
      </span>
    </>
  )
  return (
    <div className="flex w-fit max-w-full flex-col gap-2">
      {PREVIEWABLE.has(file.contentType) ? (
        <img src={url} alt={file.name} loading="lazy" className="max-h-80 rounded-2xl border" />
      ) : null}
      {viewable ? (
        <div className="flex w-fit max-w-full items-stretch overflow-hidden rounded-2xl border bg-surface text-sm">
          {onOpen === undefined ? (
            <Link
              to="/a/$agentId/library"
              params={{ agentId }}
              search={{ file: file.id }}
              title="Open in the library"
              className="flex min-w-0 items-center gap-3 py-2.5 pr-3 pl-3 hover:bg-accent"
            >
              {label}
            </Link>
          ) : (
            <button
              type="button"
              title="Open beside the chat"
              onClick={onOpen}
              className="flex min-w-0 items-center gap-3 py-2.5 pr-3 pl-3 text-left hover:bg-accent"
            >
              {label}
            </button>
          )}
          <a
            href={url}
            download={file.name}
            aria-label={`Download ${file.name}`}
            title="Download"
            className="flex shrink-0 items-center border-l px-3 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <DownloadSimpleIcon className="size-4" />
          </a>
        </div>
      ) : (
        <a
          href={url}
          download={file.name}
          className="flex w-fit max-w-full items-center gap-3 rounded-2xl border bg-surface py-2.5 pr-4 pl-3 text-sm hover:bg-accent"
        >
          {label}
          <DownloadSimpleIcon className="ml-2 size-4 shrink-0 text-muted-foreground" />
        </a>
      )}
    </div>
  )
}
