import type { SavedLogin, WorkspaceSummary } from "@do-computer/protocol"
import { DotsThreeIcon, LockIcon, PlusIcon } from "@phosphor-icons/react"
import { useMutation, useSuspenseQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useConfirm } from "@/components/confirm"
import { Loads } from "@/components/loads"
import { PasswordInput, SitesField } from "@/components/login-fields"
import { CardsPlaceholder } from "@/components/placeholders"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { client } from "@/lib/client"
import { savedLoginsKey } from "@/lib/collections"
import { loginToSend, usedWords } from "@/lib/passwords"
import { queryClient } from "@/lib/query"
import { CardsSettings } from "./cards.tsx"

/**
 * What is being done to the workspace's logins in a window over the list: one added, or one of
 * them given a new password or other sites.
 */
type Editing = { what: "add" } | { what: "password" | "change"; login: SavedLogin }

/**
 * The window a login is typed in. Adding one asks for all of it; replacing its password asks
 * for that alone; changing it asks for everything but the password, which is never shown and
 * so cannot be edited. A password typed here is held until it is sent and forgotten with the
 * window.
 */
function LoginDialog({
  workspaceId,
  editing,
  onClose,
}: {
  workspaceId: string
  editing: Editing
  onClose: () => void
}) {
  const login = editing.what === "add" ? undefined : editing.login
  const [name, setName] = useState(login?.name ?? "")
  const [username, setUsername] = useState(login?.username ?? "")
  const [password, setPassword] = useState("")
  const [sites, setSites] = useState<string[]>(login?.sites ?? [])
  const [site, setSite] = useState("")
  const [problem, setProblem] = useState<string>()
  const save = useMutation({
    mutationFn: (send: () => Promise<SavedLogin>) => send(),
    onSuccess: async () => {
      setPassword("")
      await queryClient.invalidateQueries({ queryKey: savedLoginsKey(workspaceId) })
      onClose()
    },
  })
  /** Leaves without saving, and with nothing of a password that was typed. */
  const close = () => {
    setPassword("")
    onClose()
  }
  const busy = save.isPending
  const error = problem ?? save.error?.message
  const typing = <T,>(set: (value: T) => void) => {
    return (value: T) => {
      setProblem(undefined)
      save.reset()
      set(value)
    }
  }
  const [title, description] =
    editing.what === "add"
      ? [
          "Add a login",
          "A Dood of this workspace can sign in with it on the sites you name. It is never shown the password, and neither is anyone else once it is saved.",
        ]
      : editing.what === "password"
        ? [
            `Replace the password of ${editing.login.name}`,
            `The one kept for ${editing.login.username} is replaced by what you type. It is not shown again.`,
          ]
        : [`Change ${editing.login.name}`, "Its password stays as it is."]
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <DialogContent showCloseButton={false} className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault()
            const api = client.workspace(workspaceId)
            // What cannot be saved is said here, before anything is sent.
            if (editing.what === "add") {
              const sent = loginToSend({ name, username, password, sites, site })
              if ("problem" in sent) return setProblem(sent.problem)
              const { login } = sent
              return save.mutate(() => api.saveLogin({ ...login, sites: login.sites ?? [] }))
            }
            const sent =
              editing.what === "password"
                ? loginToSend({ password })
                : loginToSend({ name, username, sites, site })
            if ("problem" in sent) return setProblem(sent.problem)
            const { login } = sent
            save.mutate(() => api.changeSavedLogin(editing.login.id, login))
          }}
        >
          {editing.what === "password" ? null : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-name">Name</Label>
                <Input
                  id="login-name"
                  autoFocus
                  autoComplete="off"
                  placeholder="GitHub"
                  disabled={busy}
                  value={name}
                  onChange={(event) => typing(setName)(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  What you and the Doods call it. A Dood asks for a login by its name.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-username">Username or email</Label>
                <Input
                  id="login-username"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  disabled={busy}
                  value={username}
                  onChange={(event) => typing(setUsername)(event.target.value)}
                />
              </div>
            </>
          )}
          {editing.what === "change" ? null : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password">
                {editing.what === "password" ? "New password" : "Password"}
              </Label>
              <PasswordInput
                id="login-password"
                name="password"
                autoFocus={editing.what === "password"}
                disabled={busy}
                value={password}
                onChange={typing(setPassword)}
              />
            </div>
          )}
          {editing.what === "password" ? null : (
            <div className="flex flex-col gap-1.5">
              <Label id="login-sites-label" htmlFor="login-sites">
                Used only on
              </Label>
              <SitesField
                id="login-sites"
                sites={sites}
                typed={site}
                disabled={busy}
                onSites={typing(setSites)}
                onTyped={typing(setSite)}
                onProblem={setProblem}
              />
              <p className="text-xs text-muted-foreground">
                It is typed on these sites and the ones under them, such as app.example.com for
                example.com, and nowhere else.
              </p>
            </div>
          )}
          {error === undefined ? null : (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LoginRow({
  login,
  busy,
  onEdit,
  onRemove,
}: {
  login: SavedLogin
  busy: boolean
  onEdit: (what: "password" | "change") => void
  onRemove: () => void
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3.5">
      {/* Its mark, where a face would be: the first letter of its name. */}
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-semibold text-muted-foreground uppercase"
      >
        {login.name.trim()[0]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{login.name}</p>
        <p className="text-xs wrap-anywhere text-muted-foreground">
          {login.username} · <span className="font-mono">{login.sites.join(", ")}</span>
        </p>
        {login.unreadable ? (
          <p className="text-xs text-destructive">
            Its password can no longer be read: give it again
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{usedWords(login)}</p>
        )}
      </div>
      {login.unreadable ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit("password")}>
          Replace the password
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              disabled={busy}
              aria-label={`Change or remove ${login.name}`}
            />
          }
        >
          <DotsThreeIcon weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto">
          <DropdownMenuItem onClick={() => onEdit("password")}>
            Replace the password
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onEdit("change")}>
            Change its name or sites
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/** The logins themselves, which wait for the workspace to list them. */
function LoginList({
  workspace,
  onEdit,
}: {
  workspace: WorkspaceSummary
  onEdit: (editing: Editing) => void
}) {
  const { data: logins } = useSuspenseQuery({
    queryKey: savedLoginsKey(workspace.id),
    queryFn: () => client.workspace(workspace.id).savedLogins(),
  })
  const [confirm, confirming] = useConfirm()
  const remove = useMutation({
    mutationFn: (loginId: string) => client.workspace(workspace.id).removeSavedLogin(loginId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: savedLoginsKey(workspace.id) }),
  })
  if (logins.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed p-4">
        <div>
          <h3 className="text-sm font-medium">No logins yet</h3>
          <p className="text-sm text-muted-foreground">
            Add one here, or wait for a Dood to ask: when a site wants it to sign in and it has no
            login for it, it asks you for one in the chat.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => onEdit({ what: "add" })}>
          <PlusIcon data-icon="inline-start" />
          Add a login
        </Button>
      </div>
    )
  }
  return (
    <>
      <ul aria-label="Saved logins" className="divide-y rounded-2xl border">
        {logins.map((login) => (
          <LoginRow
            key={login.id}
            login={login}
            busy={remove.isPending}
            onEdit={(what) => onEdit({ what, login })}
            onRemove={async () => {
              const agreed = await confirm({
                title: `Remove ${login.name}?`,
                description:
                  "Its password is deleted, and no Dood of this workspace can sign in with it any more.",
                action: "Remove",
                destructive: true,
              })
              if (agreed) remove.mutate(login.id)
            }}
          />
        ))}
      </ul>
      {remove.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {remove.error.message}
        </p>
      ) : null}
      {confirming}
    </>
  )
}

/**
 * The logins a workspace keeps for its agents to sign in to websites with. An agent uses one
 * without seeing it, and nobody is shown a password here: one can be replaced or removed.
 */
function LoginsSettings({ workspace }: { workspace: WorkspaceSummary }) {
  const [editing, setEditing] = useState<Editing>()
  return (
    <div className="flex flex-col gap-6">
      {/* The button sits beside the last of the words, below the window's own way out. */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-lg font-semibold tracking-tight">Passwords</h2>
          <p className="text-sm text-muted-foreground">
            Logins the Doods of this workspace can sign in with. A Dood uses one without seeing it,
            and only on the sites it is for.
          </p>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => setEditing({ what: "add" })}>
          <PlusIcon data-icon="inline-start" />
          Add a login
        </Button>
      </div>
      <Loads key={workspace.id} fallback={<CardsPlaceholder cards={3} />}>
        <LoginList workspace={workspace} onEdit={setEditing} />
      </Loads>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <LockIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Kept encrypted by Do Computer. A password can be replaced or removed here, and never shown
          again, to you or to a Dood. Whether a Dood asks before using one is set under its
          Permissions.
        </span>
      </p>
      {editing === undefined ? null : (
        <LoginDialog
          // A window for another login starts empty of what was typed in the last.
          key={editing.what === "add" ? "add" : `${editing.what}-${editing.login.id}`}
          workspaceId={workspace.id}
          editing={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  )
}

/**
 * The Passwords page of a workspace: its logins, its cards, or both, whichever of them it
 * keeps and this person may see.
 */
export function PasswordsSettings({ workspace }: { workspace: WorkspaceSummary }) {
  return (
    <div className="flex flex-col gap-10">
      {workspace.savedLogins ? <LoginsSettings workspace={workspace} /> : null}
      {workspace.savedCards ? <CardsSettings workspace={workspace} /> : null}
    </div>
  )
}
