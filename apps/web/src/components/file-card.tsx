import type { LibraryFile } from "@durable-computer/protocol"
import { DownloadSimpleIcon, FileIcon } from "@phosphor-icons/react"
import { client } from "@/lib/client"

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Raster images are previewed; the server serves only these types in place. */
const PREVIEWABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

/** A file from the library: a preview when it is an image, and a download either way. */
export function FileCard({ agentId, file }: { agentId: string; file: LibraryFile }) {
  const url = client.agent(agentId).libraryFileUrl(file.id)
  return (
    <div className="flex w-fit max-w-full flex-col gap-2">
      {PREVIEWABLE.has(file.contentType) ? (
        <img src={url} alt={file.name} loading="lazy" className="max-h-80 rounded-2xl border" />
      ) : null}
      <a
        href={url}
        download={file.name}
        className="flex w-fit max-w-full items-center gap-3 rounded-2xl border bg-surface py-2.5 pr-4 pl-3 text-sm hover:bg-accent"
      >
        <FileIcon className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block truncate font-medium">{file.name}</span>
          <span className="block text-xs text-muted-foreground">{formatBytes(file.size)}</span>
        </span>
        <DownloadSimpleIcon className="ml-2 size-4 shrink-0 text-muted-foreground" />
      </a>
    </div>
  )
}
