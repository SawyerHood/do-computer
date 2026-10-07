import type { ComputerSummary } from "@durable-computer/protocol"
import { CopyIcon, TrashIcon } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { computersKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"

const PLATFORMS: Record<string, string> = { darwin: "macOS", linux: "Linux", win32: "Windows" }

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`
}

function ComputerCard({ computer, here }: { computer: ComputerSummary; here: boolean }) {
  const remove = useMutation({
    mutationFn: () => client.removeComputer(computer.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: computersKey }),
  })
  return (
    <li className="flex flex-col gap-3 rounded-2xl border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-mono text-[0.9375rem] font-medium">{computer.name}</h2>
          <p className="text-sm text-muted-foreground">
            {PLATFORMS[computer.platform] ?? computer.platform} · {computer.hostname}
            {computer.readOnly ? " · read-only" : ""}
            {here ? "" : " · paired with another agent"}
          </p>
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
            computer.online
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : "bg-muted text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              computer.online ? "bg-emerald-500" : "bg-muted-foreground",
            )}
          />
          {computer.online ? "Online" : "Offline"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">
          {computer.online
            ? "Your agent can work on this computer now."
            : computer.lastSeenAt
              ? `Last connected ${ago(computer.lastSeenAt)}. Start the daemon there to bring it back.`
              : "Its daemon has not connected yet."}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto shrink-0 text-muted-foreground"
          disabled={remove.isPending}
          aria-label={`Remove ${computer.name}`}
          onClick={() => remove.mutate()}
        >
          <TrashIcon /> Remove
        </Button>
      </div>
      {remove.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {remove.error.message}
        </p>
      ) : null}
    </li>
  )
}

function Command({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState<string>()
  const code = useRef<HTMLElement>(null)
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border bg-background py-1.5 pr-1.5 pl-3">
        <code
          ref={code}
          className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs"
        >
          {command}
        </code>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Copy command"
          onClick={async () => {
            // The clipboard is only offered to pages on https or localhost. Elsewhere, select
            // the command so that one key press copies it.
            const copied = await navigator.clipboard
              ?.writeText(command)
              .then(() => true)
              .catch(() => false)
            if (copied) {
              setCopied("Copied")
            } else {
              const selection = window.getSelection()
              if (code.current && selection) selection.selectAllChildren(code.current)
              setCopied("Selected. Press Ctrl+C or ⌘C to copy.")
            }
            setTimeout(() => setCopied(undefined), 2500)
          }}
        >
          <CopyIcon />
        </Button>
      </div>
      {copied ? <p className="text-xs text-muted-foreground">{copied}</p> : null}
    </div>
  )
}

/** The user's own machines their agents can work on, and how to add one. */
export function ComputersSettings({
  agentId,
}: {
  /** The agent on screen, whose computers are marked as its own. */
  agentId?: string | undefined
}) {
  const { data: computers } = useQuery({
    queryKey: computersKey,
    queryFn: () => client.listComputers(),
    // Whether a computer is online changes without any event reaching this page.
    refetchInterval: 5_000,
  })
  const install = `curl -fsSL ${location.origin}/install.sh | sh`

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Computers</h2>
        <p className="text-sm text-muted-foreground">
          Your own machines, connected so your agent can work on them: run commands, and read and
          write files. Everything it does there is logged on that machine.
        </p>
      </div>

      {computers !== undefined && computers.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {computers.map((computer) => (
            <ComputerCard
              key={computer.id}
              computer={computer}
              here={computer.agentId === agentId}
            />
          ))}
        </ul>
      ) : null}

      <section className="flex flex-col gap-3 rounded-2xl border border-dashed p-4">
        <h2 className="text-sm font-medium">Connect a computer</h2>
        <Command
          label="Run this on the computer (macOS or Linux, with Node.js 20 or newer):"
          command={install}
        />
        <Command
          label="Or let the agent read files there without being able to run commands or change anything:"
          command={`${install} -s -- --read-only`}
        />
        <p className="text-sm text-muted-foreground">
          It prints a link. Open it here to choose which agent gets access. Stopping the daemon, or
          removing the computer on this page, ends that access at once.
        </p>
      </section>
    </div>
  )
}
