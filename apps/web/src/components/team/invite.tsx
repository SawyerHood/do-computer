import type { InviteResult, WorkspaceSummary } from "@durable-computer/protocol"
import {
  CheckIcon,
  CopyIcon,
  EnvelopeSimpleIcon,
  GithubLogoIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
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
import { client } from "@/lib/client"
import { invitationsKey } from "@/lib/workspaces"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"

const isEmail = (entry: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry)

/**
 * A box for the people to invite: each an email address or a GitHub username, shown as a chip
 * once it is entered. Whatever is still being typed counts too, so nothing is lost on Send.
 */
export function WhoInput({
  who,
  onChange,
  typed,
  onTyped,
  label,
}: {
  who: string[]
  onChange: (who: string[]) => void
  typed: string
  onTyped: (typed: string) => void
  label: string
}) {
  const add = (text: string) => {
    const entries = text
      .split(/[\s,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
    onChange([...new Set([...who, ...entries])])
    onTyped("")
  }
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-input p-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
      {who.map((entry) => (
        <span
          key={entry}
          className="flex h-7 items-center gap-1.5 rounded-full bg-accent pr-1 pl-2 text-sm"
        >
          {isEmail(entry) ? (
            <EnvelopeSimpleIcon className="size-3.5 text-muted-foreground" />
          ) : (
            <GithubLogoIcon className="size-3.5 text-muted-foreground" />
          )}
          <span className={cn(!isEmail(entry) && "font-mono text-[0.8125rem]")}>
            {isEmail(entry) ? entry : entry.replace(/^@/, "")}
          </span>
          <button
            type="button"
            aria-label={`Remove ${entry}`}
            onClick={() => onChange(who.filter((other) => other !== entry))}
            className="rounded-full p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        value={typed}
        placeholder={who.length === 0 ? "Email or @github-username" : ""}
        onChange={(event) => {
          const value = event.target.value
          // A comma or a space ends an entry, as does pasting several at once.
          if (/[\s,;]/.test(value)) add(value)
          else onTyped(value)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && typed.trim() !== "") {
            event.preventDefault()
            add(typed)
          }
          if (event.key === "Backspace" && typed === "" && who.length > 0) {
            onChange(who.slice(0, -1))
          }
        }}
        onBlur={() => typed.trim() !== "" && add(typed)}
        className="h-7 min-w-40 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}

/** Everyone entered, counting what is still being typed. */
export const entered = (who: string[], typed: string) => [
  ...new Set([...who, ...typed.split(/[\s,;]+/).filter(Boolean)]),
]

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 1_500)
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />} {copied ? "Copied" : "Copy link"}
    </Button>
  )
}

/**
 * What came of inviting: for each person, whether they were written to, and the link to pass on.
 * A link is only ever shown here, when it is made.
 */
export function InviteOutcome({ result }: { result: InviteResult }) {
  return (
    <div className="flex flex-col gap-2">
      {result.invitations.map((invitation) => (
        <div key={invitation.id} className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {invitation.email ?? `@${invitation.githubLogin}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {invitation.emailed
                ? "An email is on its way. The link also works."
                : invitation.email === null
                  ? "It will be waiting when they sign in with GitHub. Or send them the link."
                  : "No email was sent from here. Send them the link."}
            </p>
          </div>
          <CopyButton
            text={invitation.link}
            label={`Copy the link for ${invitation.email ?? invitation.githubLogin}`}
          />
        </div>
      ))}
      {result.problems.map((problem) => (
        <p key={problem.who} role="alert" className="px-1 text-sm text-destructive">
          {problem.who}: {problem.error}
        </p>
      ))}
    </div>
  )
}

/** Ask people to join a team, by email address or GitHub username. */
export function InviteDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: WorkspaceSummary
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [who, setWho] = useState<string[]>([])
  const [typed, setTyped] = useState("")
  const [role, setRole] = useState<"member" | "admin">("member")
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<InviteResult>()
  const everyone = entered(who, typed)

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      // Starts clean the next time. The links are gone with it, as the dialog says.
      setWho([])
      setTyped("")
      setNote("")
      setError(undefined)
      setResult(undefined)
    }
  }
  const send = async () => {
    setSending(true)
    setError(undefined)
    try {
      const sent = await client.workspace(workspace.id).invite({ who: everyone, role, note })
      await queryClient.invalidateQueries({ queryKey: invitationsKey(workspace.id) })
      setResult(sent)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work. Try again.")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite people to {workspace.name}</DialogTitle>
          <DialogDescription>
            {result === undefined
              ? "They will be able to use every agent here and read its chats."
              : "Each link works once, for seven days. It is only shown here, so copy any you need before closing."}
          </DialogDescription>
        </DialogHeader>
        {result !== undefined ? (
          <>
            <InviteOutcome result={result} />
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <WhoInput
                  who={who}
                  onChange={setWho}
                  typed={typed}
                  onTyped={setTyped}
                  label="Who to invite"
                />
                <p className="text-xs text-muted-foreground">
                  Anything without an @ in the middle is taken as a GitHub username. Separate people
                  with a comma or Enter.
                </p>
              </div>
              <div className="flex items-end gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor="invite-note">Add a note</Label>
                  <Input
                    id="invite-note"
                    value={note}
                    maxLength={500}
                    placeholder="Optional. Goes with the invitation."
                    onChange={(event) => setNote(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="invite-role">Role</Label>
                  <select
                    id="invite-role"
                    value={role}
                    onChange={(event) => setRole(event.target.value as "member" | "admin")}
                    className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              {error === undefined ? null : (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button disabled={everyone.length === 0 || sending} onClick={send}>
                {sending
                  ? "Sending…"
                  : everyone.length <= 1
                    ? "Send invitation"
                    : `Send ${everyone.length} invitations`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
