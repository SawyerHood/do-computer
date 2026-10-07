import type { AgentState } from "@durable-computer/client"
import type { AgentSummary, ChatSummary, WorkspaceSummary } from "@durable-computer/protocol"
import { GearIcon, PlusIcon } from "@phosphor-icons/react"
import { useQueries } from "@tanstack/react-query"
import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { FaceStack, names, PersonFace, WorkspaceTile } from "@/components/people"
import { ago, useNewAgent } from "@/components/shell/agent-list"
import { InviteDialog } from "@/components/team/invite"
import { Button, buttonVariants } from "@/components/ui/button"
import { client } from "@/lib/client"
import { agentKey, agentsCollection } from "@/lib/collections"
import { useHere, usePeople, useWorkspace, whoIs } from "@/lib/workspaces"

export const Route = createFileRoute("/_app/w/$workspaceId/")({ component: TeamHome })

const heading = "mt-9 mb-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"

/** A team at a glance: its agents and who is with each, who is here, and what was last talked about. */
function TeamHome() {
  const { workspaceId } = Route.useParams()
  const workspace = useWorkspace(workspaceId)
  if (workspace === undefined) return null
  return <Home workspace={workspace} />
}

function Home({ workspace }: { workspace: WorkspaceSummary }) {
  const { me } = useRouteContext({ from: "/_app" })
  const { data: agents } = useLiveQuery(
    (q) =>
      q
        .from({ agent: agentsCollection })
        .where(({ agent }) => eq(agent.workspaceId, workspace.id))
        .orderBy(({ agent }) => agent.createdAt, "asc"),
    [workspace.id],
  )
  const here = useHere(workspace.id)
  const people = usePeople(workspace)
  const newAgent = useNewAgent(workspace.id)
  const [inviting, setInviting] = useState(false)
  const list = agents ?? []
  const admin = workspace.role !== "member"
  // Each agent's chats, for the latest ones and for naming where people are.
  const states = useQueries({
    queries: list.map((agent) => ({
      queryKey: agentKey(agent.id),
      queryFn: () => client.agent(agent.id).state(),
    })),
  })
  const stateOf = new Map<string, AgentState>(
    states.flatMap((query, index) => (query.data ? [[list[index]!.id, query.data] as const] : [])),
  )
  const latest = list
    .flatMap((agent) =>
      (stateOf.get(agent.id)?.chats ?? [])
        .filter((chat) => chat.kind === "chat" && !chat.archived)
        .map((chat) => ({ agent, chat })),
    )
    .sort((a, b) => b.chat.updatedAt - a.chat.updatedAt)
    .slice(0, 6)
  const hereIds = whoIs(here, () => true)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto [--face-ring:var(--background)]">
      <div className="mx-auto w-full max-w-5xl px-6 pt-16 pb-20">
        <header className="flex flex-wrap items-center gap-4">
          <WorkspaceTile workspace={workspace} className="size-14" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{workspace.name}</h1>
            <p className="text-sm text-muted-foreground">
              {workspace.members.length} {workspace.members.length === 1 ? "person" : "people"} ·{" "}
              {list.length} {list.length === 1 ? "agent" : "agents"}, shared with everyone here
            </p>
          </div>
          <FaceStack people={workspace.members} className="size-7" max={5} />
          <Link
            to="/w/$workspaceId/people"
            params={{ workspaceId: workspace.id }}
            className={buttonVariants({ variant: "outline" })}
          >
            <GearIcon /> People
          </Link>
          {admin ? (
            <Button onClick={() => setInviting(true)}>
              <PlusIcon /> Invite people
            </Button>
          ) : null}
        </header>

        <h2 className={heading}>Agents</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3.5">
          {list.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              with_={whoIs(here, (place) => place.agentId === agent.id).flatMap(
                (id) => people.get(id) ?? [],
              )}
              you={me.user.name}
            />
          ))}
          <button
            type="button"
            onClick={newAgent}
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-sm text-muted-foreground outline-none hover:border-input hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <PlusIcon className="size-5" />
            New agent for the team
          </button>
        </div>

        <div className="grid gap-x-7 md:grid-cols-[1fr_1.25fr]">
          <section aria-labelledby="who-is-here">
            <h2 id="who-is-here" className={heading}>
              Who is here
            </h2>
            <ul className="overflow-hidden rounded-2xl border">
              {[...workspace.members]
                .sort((a, b) => Number(hereIds.includes(b.id)) - Number(hereIds.includes(a.id)))
                .map((member) => {
                  const place =
                    here.find((entry) => entry.userId === member.id && entry.chatId !== null) ??
                    here.find((entry) => entry.userId === member.id)
                  const agent = list.find((entry) => entry.id === place?.agentId)
                  const chat = stateOf
                    .get(agent?.id ?? "")
                    ?.chats.find((entry) => entry.id === place?.chatId)
                  return (
                    <li
                      key={member.id}
                      className="flex items-center gap-3 border-t px-3.5 py-2.5 first:border-t-0"
                    >
                      <PersonFace
                        person={member}
                        here={place !== undefined}
                        className={place === undefined ? "size-8 opacity-55" : "size-8"}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {member.name}
                          {member.id === me.user.id ? (
                            <span className="font-normal text-muted-foreground"> (you)</span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {place === undefined
                            ? "Not here right now"
                            : agent === undefined
                              ? "Looking around"
                              : `${agent.name ?? "New agent"}${chat ? ` · ${chat.title}` : ""}`}
                        </p>
                      </div>
                      {place?.agentId && place.chatId && member.id !== me.user.id ? (
                        <Link
                          to="/a/$agentId/c/$chatId"
                          params={{ agentId: place.agentId, chatId: place.chatId }}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                        >
                          Join
                        </Link>
                      ) : null}
                    </li>
                  )
                })}
            </ul>
          </section>
          <section aria-labelledby="latest-chats">
            <h2 id="latest-chats" className={heading}>
              Latest chats
            </h2>
            {latest.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing yet. Chats with the team's agents show up here, whoever starts them.
              </p>
            ) : (
              <ul className="overflow-hidden rounded-2xl border">
                {latest.map(({ agent, chat }) => (
                  <LatestChat
                    key={`${agent.id}/${chat.id}`}
                    agent={agent}
                    chat={chat}
                    by={
                      chat.createdBy === me.user.id
                        ? "you"
                        : people.get(chat.createdBy ?? "")?.name.split(" ")[0]
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      <InviteDialog workspace={workspace} open={inviting} onOpenChange={setInviting} />
    </div>
  )
}

function AgentCard({
  agent,
  with_,
  you,
}: {
  agent: AgentSummary
  with_: { id: string; name: string; image: string | null }[]
  you: string
}) {
  return (
    <Link
      to="/a/$agentId"
      params={{ agentId: agent.id }}
      className="flex flex-col items-center rounded-2xl border px-4 pt-5 pb-3.5 text-center outline-none hover:border-input hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <AgentFace agent={agent} className="size-28" quiet />
      <h3 className="mt-2.5 text-base font-medium">{agent.name ?? "New agent"}</h3>
      <p className="mt-0.5 line-clamp-2 min-h-10 text-sm text-muted-foreground">
        {agent.tagline ?? (agent.name ? "" : "Not named yet")}
      </p>
      <div className="mt-3 flex min-h-9 items-center gap-2 self-stretch border-t pt-3 text-left text-xs text-muted-foreground">
        <FaceStack people={with_} className="size-5" />
        <span className="min-w-0 flex-1 truncate">
          {with_.length === 0 ? "Quiet" : `${names(with_, you)} here`}
        </span>
      </div>
    </Link>
  )
}

function LatestChat({
  agent,
  chat,
  by,
}: {
  agent: AgentSummary
  chat: ChatSummary
  by: string | undefined
}) {
  return (
    <li className="border-t first:border-t-0">
      <Link
        to="/a/$agentId/c/$chatId"
        params={{ agentId: agent.id, chatId: chat.id }}
        className="flex items-center gap-3 px-3.5 py-2.5 outline-none hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <AgentFace agent={agent} className="size-8" still />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{chat.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {agent.name ?? "New agent"}
            {by === undefined ? "" : ` · started by ${by}`}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {ago(chat.updatedAt, Date.now())}
        </span>
      </Link>
    </li>
  )
}
