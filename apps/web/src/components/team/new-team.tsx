import {
  type InviteResult,
  personalWorkspaceId,
  WORKSPACE_COLORS,
} from "@do-computer/protocol"
import { CheckIcon } from "@phosphor-icons/react"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { WorkspaceTile } from "@/components/people"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { client } from "@/lib/client"
import { agentsCollection } from "@/lib/collections"
import { refreshWorkspaces } from "@/lib/workspaces"
import { entered, InviteOutcome, WhoInput } from "./invite.tsx"

/** Start a team: name it, optionally bring agents of your own along, and ask people to join. */
export function NewTeamDialog({
  userId,
  open,
  onOpenChange,
}: {
  userId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [color, setColor] = useState<string>(WORKSPACE_COLORS[0].id)
  const [moving, setMoving] = useState<string[]>([])
  const [who, setWho] = useState<string[]>([])
  const [typed, setTyped] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()
  // Once the team exists: where it is, and what came of the invitations.
  const [made, setMade] = useState<{ id: string; invited: InviteResult }>()
  const { data: mine } = useLiveQuery((q) =>
    q
      .from({ agent: agentsCollection })
      .where(({ agent }) => eq(agent.workspaceId, personalWorkspaceId(userId))),
  )

  const go = async (workspaceId: string) => {
    onOpenChange(false)
    setName("")
    setMoving([])
    setWho([])
    setTyped("")
    setMade(undefined)
    await navigate({ to: "/w/$workspaceId", params: { workspaceId } })
  }
  const create = async () => {
    setCreating(true)
    setError(undefined)
    try {
      const invite = entered(who, typed)
      const { workspace, invited } = await client.createWorkspace({
        name,
        color,
        agentIds: moving,
        ...(invite.length > 0 ? { invite: { who: invite } } : {}),
      })
      refreshWorkspaces()
      if (invited === undefined) await go(workspace.id)
      else setMade({ id: workspace.id, invited })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work. Try again.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (made !== undefined && !next ? void go(made.id) : onOpenChange(next))}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{made === undefined ? "New team" : `${name} is ready`}</DialogTitle>
          <DialogDescription>
            {made === undefined
              ? "A place for agents you share. Your own agents stay yours unless you move them."
              : "Each link works once, for seven days. It is only shown here, so copy any you need before going on."}
          </DialogDescription>
        </DialogHeader>
        {made !== undefined ? (
          <>
            <InviteOutcome result={made.invited} />
            <DialogFooter>
              <Button onClick={() => void go(made.id)}>Go to {name}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <WorkspaceTile workspace={{ name: name || "T", color }} className="size-12" />
                <Input
                  aria-label="Team name"
                  value={name}
                  maxLength={60}
                  placeholder="Team name"
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label id="new-team-color">Color</Label>
                <ToggleGroup
                  aria-labelledby="new-team-color"
                  value={[color]}
                  // Pressing the color that is chosen leaves it chosen: a team always has one.
                  onValueChange={([next]) => {
                    if (next !== undefined) setColor(next as string)
                  }}
                >
                  {WORKSPACE_COLORS.map((option) => (
                    <ToggleGroupItem
                      key={option.id}
                      value={option.id}
                      aria-label={option.label}
                      title={option.label}
                      style={{ backgroundColor: option.hex }}
                      className="size-7 min-w-0 rounded-lg p-0 text-white hover:text-white aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:ring-offset-2 aria-pressed:ring-offset-popover"
                    >
                      {color === option.id ? (
                        <CheckIcon weight="bold" className="size-3.5" />
                      ) : null}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              {(mine ?? []).length === 0 ? null : (
                <div className="flex flex-col gap-2">
                  <Label>Bring an agent along</Label>
                  {(mine ?? []).map((agent) => (
                    <label
                      key={agent.id}
                      className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
                    >
                      <Checkbox
                        checked={moving.includes(agent.id)}
                        onCheckedChange={(checked) =>
                          setMoving(
                            checked
                              ? [...moving, agent.id]
                              : moving.filter((id) => id !== agent.id),
                          )
                        }
                      />
                      <AgentFace agent={agent} className="size-8" still />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {agent.name ?? "New agent"}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Moves with its chats, library and memory. The team will be able to read
                          them.
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label>Invite people</Label>
                <WhoInput
                  who={who}
                  onChange={setWho}
                  typed={typed}
                  onTyped={setTyped}
                  label="Who to invite"
                />
                <p className="text-xs text-muted-foreground">You can also do this later.</p>
              </div>
              {error === undefined ? null : (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={name.trim() === "" || creating} onClick={create}>
                {creating ? "Creating…" : "Create team"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
