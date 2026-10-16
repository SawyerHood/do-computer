import {
  cardTrouble,
  MAX_CARD_HOLDER_CHARS,
  MAX_LOGIN_NAME_CHARS,
  MAX_POSTAL_CODE_CHARS,
  type SaveCardRequest,
  type SavedCard,
  type WorkspaceSummary,
} from "@do-computer/protocol"
import { CreditCardIcon, LockIcon, PlusIcon } from "@phosphor-icons/react"
import { useMutation, useSuspenseQuery } from "@tanstack/react-query"
import { type ChangeEvent, type ComponentProps, useState } from "react"
import { useConfirm } from "@/components/confirm"
import { Loads } from "@/components/loads"
import { CardsPlaceholder } from "@/components/placeholders"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { client } from "@/lib/client"
import { savedCardsKey } from "@/lib/collections"
import {
  cardNameFor,
  cardToSend,
  cardWords,
  groupedCardNumber,
  type TypedCard,
  usedWords,
} from "@/lib/passwords"
import { queryClient } from "@/lib/query"

const NOTHING: TypedCard = { number: "", expires: "", holder: "", postalCode: "", name: "" }

/**
 * One box of a card. Nothing fills it in or offers to keep it, since it is not this person's
 * way of paying for the app.
 */
function Field({ label, ...input }: { id: string; label: string } & ComponentProps<typeof Input>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={input.id}>{label}</Label>
      <Input autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" {...input} />
    </div>
  )
}

/**
 * The window a card is typed in. Its security code is not asked for, since it is never kept. A
 * number typed here is held until it is sent and forgotten with the window. There is no window
 * to change a card in: one is removed and added again.
 */
function CardDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [typed, setTyped] = useState(NOTHING)
  const [problem, setProblem] = useState<string>()
  const save = useMutation({
    mutationFn: (card: SaveCardRequest) => client.workspace(workspaceId).saveCard(card),
    // What was sent, the number in it, is not kept after the window is gone.
    gcTime: 0,
    onSuccess: async () => {
      setTyped(NOTHING)
      await queryClient.invalidateQueries({ queryKey: savedCardsKey(workspaceId) })
      onClose()
    },
  })
  /** Leaves without saving, and with nothing of a number that was typed. */
  const close = () => {
    setTyped(NOTHING)
    onClose()
  }
  const busy = save.isPending
  const error = problem ?? save.error?.message
  const box = (key: keyof TypedCard, shown = (value: string) => value) => ({
    id: `card-${key}`,
    disabled: busy,
    value: typed[key],
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setProblem(undefined)
      save.reset()
      setTyped({ ...typed, [key]: shown(event.target.value) })
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <DialogContent showCloseButton={false} className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Add a card</DialogTitle>
          <DialogDescription>
            A Dood of this workspace can pay with it on websites, once someone says it may. It is
            never shown the number, and neither is anyone else once it is saved.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault()
            // What cannot be saved is said here, before anything is sent.
            const sent = cardToSend(typed)
            if ("problem" in sent) return setProblem(sent.problem)
            save.mutate(sent.card)
          }}
        >
          <Field
            label="Card number"
            autoFocus
            inputMode="numeric"
            className="font-mono"
            {...box("number", groupedCardNumber)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Expires"
              inputMode="numeric"
              placeholder="MM / YY"
              maxLength={9}
              {...box("expires")}
            />
            <Field
              label="Postal code (optional)"
              autoCapitalize="characters"
              maxLength={MAX_POSTAL_CODE_CHARS}
              {...box("postalCode")}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            There is no box for the security code, since it is never kept. Whoever says the card may
            be used types it then.
          </p>
          <Field
            label="Name on the card (optional)"
            maxLength={MAX_CARD_HOLDER_CHARS}
            {...box("holder")}
          />
          <Field
            label="Name (optional)"
            placeholder={cardNameFor(typed.number)}
            maxLength={MAX_LOGIN_NAME_CHARS}
            {...box("name")}
          />
          <p className="text-xs text-muted-foreground">
            A card made for this with a spending limit is the safer one to save.
          </p>
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

function CardRow({
  card,
  busy,
  onRemove,
}: {
  card: SavedCard
  busy: boolean
  onRemove: () => void
}) {
  // What is wrong with it, which only removing it and adding it again puts right.
  const wrong = cardTrouble(card)
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3.5">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground"
      >
        <CreditCardIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{card.name}</p>
        <p className="text-xs wrap-anywhere text-muted-foreground">{cardWords(card)}</p>
        {wrong === undefined ? (
          <p className="text-xs text-muted-foreground">{usedWords(card)}</p>
        ) : (
          <p className="text-xs text-destructive">{wrong}</p>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        disabled={busy}
        aria-label={`Remove ${card.name}`}
        onClick={onRemove}
      >
        Remove
      </Button>
    </li>
  )
}

/** The cards themselves, which wait for the workspace to list them. */
function CardList({ workspace, onAdd }: { workspace: WorkspaceSummary; onAdd: () => void }) {
  const { data: cards } = useSuspenseQuery({
    queryKey: savedCardsKey(workspace.id),
    queryFn: () => client.workspace(workspace.id).savedCards(),
  })
  const [confirm, confirming] = useConfirm()
  const remove = useMutation({
    mutationFn: (cardId: string) => client.workspace(workspace.id).removeSavedCard(cardId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: savedCardsKey(workspace.id) }),
  })
  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed p-4">
        <div>
          <h3 className="text-sm font-medium">No cards yet</h3>
          <p className="text-sm text-muted-foreground">
            Add one for the Doods of this workspace to pay with when a website asks for a card.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <PlusIcon data-icon="inline-start" />
          Add a card
        </Button>
      </div>
    )
  }
  return (
    <>
      <ul aria-label="Saved cards" className="divide-y rounded-2xl border">
        {cards.map((card) => (
          <CardRow
            key={card.id}
            card={card}
            busy={remove.isPending}
            onRemove={async () => {
              const agreed = await confirm({
                title: `Remove ${card.name}?`,
                description:
                  "Its number is deleted, and no Dood of this workspace can pay with it any more.",
                action: "Remove",
                destructive: true,
              })
              if (agreed) remove.mutate(card.id)
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
 * The cards a workspace keeps for its agents to pay with on websites. An agent uses one without
 * seeing its number, and nobody is shown a number here: a card can be removed, and that is all.
 */
export function CardsSettings({ workspace }: { workspace: WorkspaceSummary }) {
  const [adding, setAdding] = useState(false)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-lg font-semibold tracking-tight">Cards</h2>
          <p className="text-sm text-muted-foreground">
            Cards the Doods of this workspace can pay with on websites. A Dood uses one without
            seeing its number, and someone is asked every time.
          </p>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => setAdding(true)}>
          <PlusIcon data-icon="inline-start" />
          Add a card
        </Button>
      </div>
      <Loads key={workspace.id} fallback={<CardsPlaceholder cards={2} />}>
        <CardList workspace={workspace} onAdd={() => setAdding(true)} />
      </Loads>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <LockIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          A card’s security code is never kept. Whoever says a card may be used types it then.
        </span>
      </p>
      {adding ? <CardDialog workspaceId={workspace.id} onClose={() => setAdding(false)} /> : null}
    </div>
  )
}
