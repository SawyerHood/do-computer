import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AgentAvatar } from "@/components/agent-avatar"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"

const waitlistKey = ["waitlist"] as const

const joined = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })

/**
 * Who has made an account and is waiting to be let in, for whoever looks after a deployment
 * that has a waiting list. Letting someone in is all there is to do here: everyone is let in at
 * once by opening the deployment (`DC_SIGNUP=open`).
 */
export function WaitlistSettings() {
  const queryClient = useQueryClient()
  const { data, error } = useQuery({ queryKey: waitlistKey, queryFn: client.waitlist.list })
  const admit = useMutation({
    mutationFn: (userId: string) => client.waitlist.admit(userId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: waitlistKey }),
  })
  const people = data?.people ?? []
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Waiting list</h2>
        <p className="text-sm text-muted-foreground">
          Anyone can make an account and hatch a Dood. The app itself is for you, the people you
          invite to a team, and whoever you let in here.
        </p>
      </div>
      <section className="flex flex-col gap-3 border-t pt-6">
        <p className="text-sm font-medium">
          {data === undefined
            ? error
              ? "The list could not be read."
              : "Reading the list…"
            : data.total === 0
              ? "Nobody is waiting."
              : data.total === 1
                ? "1 person is waiting."
                : `${data.total} people are waiting.`}
        </p>
        {people.length === 0 ? null : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {people.map((person) => (
              <li key={person.id} className="flex items-center gap-3 px-3 py-2">
                {person.dood === null ? (
                  <span className="size-9 shrink-0" />
                ) : (
                  <AgentAvatar
                    avatar={{ color: person.dood.color, seed: person.dood.seed }}
                    seed={person.dood.seed}
                    className="size-9 shrink-0"
                    quiet
                    still
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {person.name}
                    {person.dood === null ? null : (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        with {person.dood.name}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {person.email} · since {joined(person.joinedAt)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={admit.isPending && admit.variables === person.id}
                  onClick={() => admit.mutate(person.id)}
                >
                  {admit.isPending && admit.variables === person.id ? "Letting in…" : "Let in"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {data !== undefined && data.total > people.length ? (
          <p className="text-xs text-muted-foreground">
            Showing the {people.length} who have waited longest.
          </p>
        ) : null}
        {admit.error ? (
          <p role="alert" className="text-sm text-destructive">
            {admit.error.message}
          </p>
        ) : null}
      </section>
    </div>
  )
}
