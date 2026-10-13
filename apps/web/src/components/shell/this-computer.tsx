import type { Me } from "@do-computer/client"
import type { AgentSummary, WorkspaceSummary } from "@do-computer/protocol"
import { CheckCircleIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { useAtom, useAtomValue } from "jotai"
import { useEffect, useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { client } from "@/lib/client"
import { agentsQuery, computersKey } from "@/lib/collections"
import { type DesktopBridge, desktop } from "@/lib/desktop"
import { lastAgent } from "@/lib/last-agent"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"
import { firstRunOverAtom, welcomeOpenAtom } from "@/lib/welcome"
import { useWorkspaces } from "@/lib/workspaces"
import { WorkspaceMark } from "./workspace-menu.tsx"

/** How many of a workspace's Doods are drawn beside its name before the rest are counted. */
const FACES = 4
/** How long "is paired" is left to be read before the question goes. */
const PAIRED_MS = 900

/**
 * In the desktop app, someone who signs in and has Doods already is taken straight to them: no
 * egg comes down for them. What the first run would have asked about this computer is asked
 * here instead, once, over the app: whether Doods may work on it, and which workspace's. The
 * computer is given to the workspace, with every Dood in it, and not to whichever Dood was open.
 */
export function ThisComputer({ me }: { me: Me["user"] }) {
  const bridge = desktop()
  const scene = useAtomValue(welcomeOpenAtom)
  const [over, setOver] = useAtom(firstRunOverAtom)
  if (bridge === undefined || bridge.welcomed || over || scene) return null
  return <Asking bridge={bridge} me={me} onDone={() => setOver(true)} />
}

function Asking({
  bridge,
  me,
  onDone,
}: {
  bridge: DesktopBridge
  me: Me["user"]
  onDone: () => void
}) {
  const agents = useQuery(agentsQuery).data
  const workspaces = useWorkspaces()?.workspaces
  const [chosen, setChosen] = useState<string>()
  const [openAtLogin, setOpenAtLogin] = useState(true)
  const [pairing, setPairing] = useState<"pairing" | { name: string; readOnly: boolean }>()
  const [problem, setProblem] = useState<string>()
  // Doods can use this computer already: there is nothing to ask, and it is not asked again.
  const shared = bridge.sharing === "on"
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it is found to be so
  useEffect(() => {
    if (!shared) return
    void bridge.finish({}).catch(() => {})
    onDone()
  }, [shared])
  if (shared || agents === undefined || workspaces === undefined || agents.length === 0) return null

  const doodsOf = (workspace: WorkspaceSummary) =>
    agents.filter((agent) => agent.workspaceId === workspace.id)
  // A workspace with no Dood in it has nobody to give the computer to.
  const offered = workspaces.filter((workspace) => doodsOf(workspace).length > 0)
  const left = agents.find((agent) => agent.id === lastAgent())?.workspaceId
  const workspace =
    offered.find((candidate) => candidate.id === chosen) ??
    offered.find((candidate) => candidate.id === left) ??
    offered[0]
  if (workspace === undefined) return null

  const answer = async (share: "yes" | "read" | "no") => {
    setProblem(undefined)
    let paired: { name: string; readOnly: boolean } | undefined
    if (share !== "no") {
      setPairing("pairing")
      try {
        const said = await bridge.share({ readOnly: share === "read" })
        if ("error" in said) throw new Error(said.error)
        let name = bridge.computer
        if ("code" in said) {
          // This window is signed in, so it agrees to the pairing itself: nothing to copy across.
          name = (
            await client.confirmPairing({
              code: said.code,
              agentIds: doodsOf(workspace).map((agent) => agent.id),
              ...(workspace.kind === "personal" ? {} : { workspaceId: workspace.id }),
            })
          ).name
        }
        paired = { name, readOnly: share === "read" }
        void queryClient.invalidateQueries({ queryKey: computersKey })
      } catch (error) {
        setPairing(undefined)
        setProblem(
          error instanceof Error && error.message ? error.message : "That did not work. Try again.",
        )
        return
      }
    }
    // Answered either way, the first run is over: from here on it is the app's own to ask.
    await bridge.finish(bridge.canOpenAtLogin ? { openAtLogin } : {}).catch(() => {})
    if (paired === undefined) return onDone()
    setPairing(paired)
    setTimeout(onDone, PAIRED_MS)
  }

  return (
    // It is asked once, so it goes when it is answered and not when something else is pressed.
    <Dialog open disablePointerDismissal>
      <DialogContent showCloseButton={false} className="gap-5">
        <DialogHeader>
          <DialogTitle>Let your Doods work on this computer?</DialogTitle>
          <DialogDescription>
            They would run commands and read and change files on{" "}
            <span className="font-mono text-foreground">{bridge.computer}</span>, as you. They can
            reach it while Do Computer is running; closing the window leaves it in the tray.
          </DialogDescription>
        </DialogHeader>
        {offered.length > 1 ? (
          <fieldset className="flex flex-col gap-2" disabled={pairing !== undefined}>
            <legend className="mb-2 text-sm font-medium">Which workspace’s Doods?</legend>
            <RadioGroup
              value={workspace.id}
              onValueChange={(next) => setChosen(next as string)}
              className="gap-2"
            >
              {offered.map((candidate) => (
                <label
                  key={candidate.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 text-sm",
                    candidate.id === workspace.id && "border-primary bg-primary/10",
                  )}
                >
                  <RadioGroupItem value={candidate.id} />
                  <WorkspaceMark workspace={candidate} me={me} className="size-6" />
                  <span className="min-w-0 flex-1 truncate font-medium">{candidate.name}</span>
                  <Doods agents={doodsOf(candidate)} />
                </label>
              ))}
            </RadioGroup>
          </fieldset>
        ) : null}
        {bridge.canOpenAtLogin ? (
          <Label className="font-normal">
            <Checkbox
              checked={openAtLogin}
              disabled={pairing !== undefined}
              onCheckedChange={(on) => setOpenAtLogin(on === true)}
            />
            Open Do Computer when I sign in to this computer
          </Label>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {workspace.kind === "personal"
            ? "It stays yours: only you decide which Doods use it."
            : `It becomes ${workspace.name}’s: anyone in the team can connect its Doods to it.`}{" "}
          A Dood hatched later can ask for it.
        </p>
        {problem === undefined ? null : (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
        {pairing !== undefined ? (
          <div role="status" className="flex min-h-9 items-center gap-2.5 text-sm">
            {pairing === "pairing" ? (
              <>
                <Spinner className="text-muted-foreground" />
                Pairing this computer…
              </>
            ) : (
              <>
                <CheckCircleIcon className="size-[18px] text-primary" />
                <span>
                  <span className="font-mono">{pairing.name}</span> is paired
                  {pairing.readOnly ? ", read-only" : ""}.
                </span>
              </>
            )}
          </div>
        ) : (
          <DialogFooter className="sm:items-center">
            <Button
              variant="ghost"
              className="text-muted-foreground sm:mr-auto"
              onClick={() => void answer("no")}
            >
              Not now
            </Button>
            <Button variant="outline" onClick={() => void answer("read")}>
              Only read files
            </Button>
            <Button onClick={() => void answer("yes")}>Yes, work here</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The Doods of a workspace as a row of faces, the first few of them drawn. */
function Doods({ agents }: { agents: readonly AgentSummary[] }) {
  const more = agents.length - FACES
  return (
    <span
      className="flex shrink-0 items-center"
      title={agents.map((agent) => agent.name ?? "New Dood").join(", ")}
    >
      {agents.slice(0, FACES).map((agent) => (
        <AgentFace key={agent.id} agent={agent} className="-ml-1.5 size-7 first:ml-0" still quiet />
      ))}
      {more > 0 ? <span className="ml-1.5 text-xs text-muted-foreground">+{more}</span> : null}
    </span>
  )
}
