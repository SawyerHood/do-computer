import type { ApprovalRule, ApprovalsState, ApprovalSubject } from "@do-computer/protocol"
import { useMutation, useSuspenseQuery } from "@tanstack/react-query"
import { Loads } from "@/components/loads"
import { RowsPlaceholder } from "@/components/placeholders"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { client } from "@/lib/client"
import { approvalsKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"

const CHOICES: { rule: ApprovalRule; label: string }[] = [
  { rule: "allow", label: "Allow" },
  { rule: "ask", label: "Ask first" },
  { rule: "deny", label: "Never" },
]

const GROUPS: { kind: ApprovalSubject["kind"]; title: string; empty?: string }[] = [
  { kind: "tool", title: "What it can do" },
  { kind: "connector", title: "Connectors", empty: "No connectors yet." },
  { kind: "computer", title: "Your computers", empty: "No computers connected yet." },
]

function SubjectRow({
  subject,
  rule,
  onChange,
}: {
  subject: ApprovalSubject
  rule: ApprovalRule
  onChange: (rule: ApprovalRule) => void
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <div className="min-w-0 flex-1 basis-56">
        <span id={`subject-${subject.id}`} className="text-sm">
          {subject.label}
        </span>
        {subject.hint ? <p className="text-xs text-muted-foreground">{subject.hint}</p> : null}
      </div>
      <ToggleGroup
        aria-labelledby={`subject-${subject.id}`}
        value={[rule]}
        // Pressing the rule that holds leaves it holding: there is always one.
        onValueChange={([next]) => {
          if (next !== undefined) onChange(next as ApprovalRule)
        }}
        className="gap-0 rounded-lg border p-0.5"
      >
        {CHOICES.map((choice) => (
          <ToggleGroupItem
            key={choice.rule}
            value={choice.rule}
            className="h-6 min-w-0 px-3 text-xs font-normal text-muted-foreground hover:bg-transparent aria-pressed:bg-accent aria-pressed:font-medium aria-pressed:text-foreground aria-pressed:hover:bg-accent"
          >
            {choice.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </li>
  )
}

/** What the agent may do without asking. Everything is allowed until a rule here says otherwise. */
export function PermissionsSettings({ agentId }: { agentId: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Permissions</h2>
        <p className="text-sm text-muted-foreground">
          Your agent acts without asking unless you say otherwise here. A few things that cost money
          or give it more reach start on “Ask first”. With “Ask first” it stops, tells you what it
          wants to do, and waits for your answer in the chat. Scheduled runs follow the same rules,
          and wait the same way.
        </p>
      </div>
      <Loads key={agentId} fallback={<RowsPlaceholder rows={4} />}>
        <Rules agentId={agentId} />
      </Loads>
    </div>
  )
}

/** The rules themselves, which wait for the agent to say what there is to rule on. */
function Rules({ agentId }: { agentId: string }) {
  const { data: state } = useSuspenseQuery<ApprovalsState>({
    queryKey: approvalsKey(agentId),
    queryFn: () => client.agent(agentId).approvals(),
  })
  const change = useMutation({
    mutationFn: (rules: Record<string, ApprovalRule>) =>
      client.agent(agentId).setApprovalRules(rules),
    // Shown at once; the server's answer replaces it, or the refetch undoes it.
    onMutate: (rules) => {
      queryClient.setQueryData<ApprovalsState>(approvalsKey(agentId), (previous) =>
        previous === undefined ? previous : { ...previous, rules: { ...previous.rules, ...rules } },
      )
    },
    onSuccess: (next) => queryClient.setQueryData(approvalsKey(agentId), next),
    onError: () => queryClient.invalidateQueries({ queryKey: approvalsKey(agentId) }),
  })

  return (
    <>
      {change.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {change.error.message}
        </p>
      ) : null}
      {GROUPS.map((group) => {
        const subjects = state.subjects.filter((subject) => subject.kind === group.kind)
        return (
          <section key={group.kind} className="flex flex-col gap-1">
            <h2 className="text-sm font-medium">{group.title}</h2>
            {subjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">{group.empty}</p>
            ) : (
              <ul className="divide-y">
                {subjects.map((subject) => (
                  <SubjectRow
                    key={subject.id}
                    subject={subject}
                    rule={state.rules[subject.id] ?? "allow"}
                    onChange={(rule) => change.mutate({ [subject.id]: rule })}
                  />
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </>
  )
}
