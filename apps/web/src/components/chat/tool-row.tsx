import type { ToolPart } from "@durable-computer/protocol"
import {
  BrainIcon,
  CaretRightIcon,
  CheckIcon,
  CircleNotchIcon,
  IdentificationBadgeIcon,
  TerminalWindowIcon,
  WarningIcon,
  WrenchIcon,
} from "@phosphor-icons/react"
import { useState } from "react"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { cn } from "@/lib/utils"

/** How each known tool reads in the transcript: an icon, and a line for running and for done. */
const TOOLS: Record<
  string,
  { icon: typeof WrenchIcon; running: string; done: (args: Record<string, unknown>) => string }
> = {
  set_identity: {
    icon: IdentificationBadgeIcon,
    running: "Updating its identity",
    done: (args) =>
      typeof args.name === "string" ? `Named itself ${args.name}` : "Updated its identity",
  },
  memory: {
    icon: BrainIcon,
    running: "Updating memory",
    done: (args) =>
      args.action === "remove"
        ? "Removed a memory"
        : args.target === "user"
          ? "Remembered something about you"
          : "Saved a note",
  },
  bash: {
    icon: TerminalWindowIcon,
    running: "Running a command",
    done: (args) =>
      typeof args.command === "string" ? args.command.split("\n")[0]! : "Ran a command",
  },
}

function describe(part: ToolPart): { Icon: typeof WrenchIcon; label: string } {
  const known = TOOLS[part.name]
  const args = (part.args ?? {}) as Record<string, unknown>
  const active = part.status === "pending" || part.status === "running"
  if (known === undefined) {
    return { Icon: WrenchIcon, label: active ? `Using ${part.name}` : `Used ${part.name}` }
  }
  return { Icon: known.icon, label: active ? known.running : known.done(args) }
}

/** One tool call: a single quiet line that expands to its arguments and output. */
export function ToolRow({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false)
  const { Icon, label } = describe(part)
  const active = part.status === "pending" || part.status === "running"
  const failed = part.status === "error"
  return (
    <div className="flex flex-col gap-1.5 px-1">
      <Marker
        render={<button type="button" onClick={() => setOpen((value) => !value)} />}
        className="w-fit max-w-full rounded-md hover:text-foreground"
        aria-expanded={open}
      >
        <MarkerIcon>
          {active ? (
            <CircleNotchIcon className="animate-spin" />
          ) : failed ? (
            <WarningIcon className="text-destructive" />
          ) : (
            <Icon />
          )}
        </MarkerIcon>
        <MarkerContent className={cn("truncate", active && "animate-shine")}>
          {failed ? `${label} (failed)` : label}
        </MarkerContent>
        {!active && !failed ? <CheckIcon className="size-3 opacity-60" /> : null}
        <CaretRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} />
      </Marker>
      {open ? (
        <div className="ml-6 flex flex-col gap-2 rounded-lg border bg-surface p-3 font-mono text-xs">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-muted-foreground">
            {JSON.stringify(part.args, null, 2)}
          </pre>
          {part.output ? (
            <pre
              className={cn(
                "max-h-72 overflow-auto whitespace-pre-wrap break-words border-t pt-2",
                failed && "text-destructive",
              )}
            >
              {part.output}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
