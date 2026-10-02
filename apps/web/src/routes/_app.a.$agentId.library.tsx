import type { LibraryFile } from "@durable-computer/protocol"
import {
  ArrowLeftIcon,
  DownloadSimpleIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useRef } from "react"
import { formatBytes } from "@/components/file-card"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { libraryKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"

export const Route = createFileRoute("/_app/a/$agentId/library")({ component: LibraryPage })

const date = (at: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at))

function FileRow({ agentId, file }: { agentId: string; file: LibraryFile }) {
  const api = client.agent(agentId)
  const remove = useMutation({
    mutationFn: () => api.removeLibraryFile(file.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: libraryKey(agentId) }),
  })
  return (
    <li className="flex items-center gap-3 rounded-xl border bg-surface py-2.5 pr-2 pl-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(file.size)} ·{" "}
          {file.source === "agent" ? "from your agent" : "uploaded by you"} · {date(file.createdAt)}
          {file.chatId ? (
            <>
              {" · "}
              <Link
                to="/a/$agentId/c/$chatId"
                params={{ agentId, chatId: file.chatId }}
                className="underline underline-offset-3"
              >
                chat
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Download ${file.name}`}
        render={<a href={api.libraryFileUrl(file.id)} download={file.name} />}
      >
        <DownloadSimpleIcon />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        className="text-muted-foreground"
        disabled={remove.isPending}
        aria-label={`Delete ${file.name}`}
        onClick={() => remove.mutate()}
      >
        <TrashIcon />
      </Button>
    </li>
  )
}

/** Files the agent has delivered and files the user has given it. */
function LibraryPage() {
  const { agentId } = Route.useParams()
  const input = useRef<HTMLInputElement>(null)
  const { data: files } = useQuery({
    queryKey: libraryKey(agentId),
    queryFn: () => client.agent(agentId).library(),
  })
  const upload = useMutation({
    mutationFn: (file: File) =>
      client.agent(agentId).upload({ name: file.name, type: file.type, body: file }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: libraryKey(agentId) }),
  })

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 pt-16 pb-24 md:pt-10">
        <Link
          to="/a/$agentId"
          params={{ agentId }}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon /> Back to chat
        </Link>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Library</h1>
            <p className="text-sm text-muted-foreground">
              Files your agent has made for you, and files you have given it. They are kept here
              whatever happens to its computer.
            </p>
          </div>
          <input
            ref={input}
            type="file"
            className="sr-only"
            aria-label="Choose a file to upload"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) upload.mutate(file)
              event.target.value = ""
            }}
          />
          <Button
            variant="outline"
            disabled={upload.isPending}
            onClick={() => input.current?.click()}
          >
            <UploadSimpleIcon /> {upload.isPending ? "Uploading…" : "Upload"}
          </Button>
        </div>
        {upload.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {upload.error.message}
          </p>
        ) : null}
        {files === undefined ? null : files.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing here yet. Ask your agent to make you something.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {files.map((file) => (
              <FileRow key={file.id} agentId={agentId} file={file} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
