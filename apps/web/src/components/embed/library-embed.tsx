import { delimiterOf, type LibraryFile, parseDelimited, TABLE_ROWS } from "@do-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { client } from "@/lib/client"
import { libraryQuery } from "@/lib/collections"
import { kindOf } from "@/lib/library"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"
import { MediaPlayer } from "./media.tsx"
import { CutNote, RowsTable } from "./table.tsx"

/** How much of a table's file is asked for to draw its first rows. */
const TABLE_BYTES = 256 * 1024

/** Whether a file is shown in a chat as what it is, and not only named: a film, a sound, a table. */
export function embedsInChat(file: Pick<LibraryFile, "name" | "size" | "contentType">): boolean {
  const kind = kindOf(file)
  return kind === "video" || kind === "audio" || kind === "table"
}

/** The first rows of a CSV or TSV file of the library. Only the start of a long one is asked for. */
function useRows(agentId: string, file: LibraryFile, view: string) {
  return useQuery({
    // A revision's rows never change, and the address they are asked at is not what they are.
    queryKey: ["agents", agentId, "library", "rows", file.id, file.rev],
    queryFn: async () => {
      const response = await fetch(
        `${client.agent(agentId).libraryViewUrl(view, file.path)}?v=${file.rev}`,
        { headers: { range: `bytes=0-${TABLE_BYTES - 1}` } },
      )
      if (!response.ok) throw new Error(`${file.name} could not be read.`)
      return parseDelimited(await response.text(), delimiterOf(file.name), {
        // The headings, and then as many rows as are drawn.
        rows: TABLE_ROWS + 1,
        whole: response.status !== 206 || file.size <= TABLE_BYTES,
      })
    },
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** A table file's first rows, in a box that scrolls. */
export function LibraryTable({
  agentId,
  file,
  view,
  className,
}: {
  agentId: string
  file: LibraryFile
  view: string
  className?: string
}) {
  const { data: table, isError } = useRows(agentId, file, view)
  if (isError) {
    return <p className="px-1 text-sm text-muted-foreground">{file.name} could not be read.</p>
  }
  // Until the rows are here it holds a little room, so that what is under it moves less.
  if (table === undefined) return <div className={cn("h-24 rounded-xl bg-muted/60", className)} />
  return (
    <div>
      <RowsTable
        table={table}
        name={file.name}
        className={cn("rounded-xl border border-hairline", className)}
      />
      <CutNote table={table} />
    </div>
  )
}

/**
 * A file of the library shown in a chat as what it is: a film or a sound to play, a table to
 * read. Nothing, for a file of any other kind: a picture and a page have ways of their own, and
 * the rest are only named.
 */
export function LibraryEmbed({
  agentId,
  file,
  view,
}: {
  agentId: string
  file: LibraryFile
  view: string
}) {
  const kind = kindOf(file)
  const api = client.agent(agentId)
  if (kind === "table") {
    return <LibraryTable agentId={agentId} file={file} view={view} className="max-h-80" />
  }
  if (kind !== "video" && kind !== "audio") return null
  const address = (view: string) => `${api.libraryViewUrl(view, file.path)}?v=${file.rev}`
  return (
    <MediaPlayer
      // Another file, or the same one changed, is another thing to play.
      key={`${file.id}:${file.rev}`}
      kind={kind}
      src={address(view)}
      name={file.name}
      download={api.libraryFileUrl(file.id)}
      // The address a file is viewed at stops working after some hours. The library is asked
      // again, and gives the one that works now.
      onStale={async () =>
        address((await queryClient.fetchQuery({ ...libraryQuery(agentId), staleTime: 0 })).view)
      }
    />
  )
}
