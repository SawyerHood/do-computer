import type { AgentSummary } from "@durable-computer/protocol"
import { useCallback } from "react"
import { AgentAvatar } from "@/components/agent-avatar"
import { chatKey } from "@/lib/atoms"
import { client } from "@/lib/client"
import { useLiveChat } from "@/lib/use-live-chat"
import { Composer } from "./composer.tsx"
import { Transcript } from "./transcript.tsx"

function Welcome({ agent }: { agent: AgentSummary }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <AgentAvatar avatar={agent.avatar} seed={agent.id} className="size-20" />
      <h1 className="text-xl font-medium">{agent.name ?? "Say hello"}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {agent.name
          ? (agent.tagline ?? "What would you like to do?")
          : "Your agent is brand new. It has no name yet. Start talking and work out together who it is."}
      </p>
    </div>
  )
}

/** One chat: the transcript, kept live by its event stream, and the composer. */
export function ChatView({ agent, chatId }: { agent: AgentSummary; chatId: string }) {
  const live = useLiveChat(agent.id, chatId)
  const api = client.agent(agent.id)

  const send = useCallback(
    (text: string) => {
      void api.send(chatId, {
        text,
        requestId: crypto.randomUUID(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
    },
    [api, chatId],
  )
  const stop = useCallback(() => void api.abort(chatId), [api, chatId])

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-linear-to-b from-background via-background/80 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background/85 py-1 pr-3.5 pl-1 shadow-sm backdrop-blur">
          <AgentAvatar avatar={agent.avatar} seed={agent.id} className="size-7" />
          <span className="text-sm font-medium">{agent.name ?? "New agent"}</span>
          {live.status === "reconnecting" ? (
            <span className="text-xs text-muted-foreground">reconnecting…</span>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Transcript state={live.state} empty={live.loaded ? <Welcome agent={agent} /> : null} />
      </div>
      <Composer
        draftKey={chatKey(agent.id, chatId)}
        placeholder={agent.name ? `Message ${agent.name}` : "Say hello"}
        busy={live.state.busy}
        queued={live.state.queued}
        onSend={send}
        onStop={stop}
      />
    </div>
  )
}
