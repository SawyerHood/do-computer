import type { Avatar, ChatKind } from "@durable-computer/protocol"
import { defineDoc } from "@earendil-works/pi-durable"

/**
 * Who the agent is and what it knows. Canonical here, in the agent's own store, so it survives a
 * stopped or replaced sandbox; the workspace files (SOUL.md and friends) are a mirror of this.
 */
export type IdentityState = {
  name: string | null
  avatar: Avatar | null
  tagline: string | null
  /** Personality, tone and boundaries, in the agent's own words. */
  soul: string
  /** What the agent knows about its user. */
  user: string
  /** Long-term notes the agent keeps for itself. */
  memory: string
  /** `provider/modelId` new chats run on. */
  model: string
  /** Account that owns this agent. */
  ownerId: string
  createdAt: number
}

export const IdentityDoc = defineDoc<IdentityState>({
  kind: "dc.identity",
  version: 1,
  scope: "session",
  initial: () => ({
    name: null,
    avatar: null,
    tagline: null,
    soul: "",
    user: "",
    memory: "",
    model: "",
    ownerId: "",
    createdAt: 0,
  }),
})

export type ChatRecord = {
  title: string
  kind: ChatKind
  createdAt: number
  updatedAt: number
  archived: boolean
}

/** The agent's chats, keyed by conversation id. One document, so the list is watched as a unit. */
export type ChatsState = {
  chats: Record<string, ChatRecord>
}

export const ChatsDoc = defineDoc<ChatsState>({
  kind: "dc.chats",
  version: 1,
  scope: "session",
  initial: () => ({ chats: {} }),
})

export const DEFAULT_CHAT_TITLE = "New chat"
