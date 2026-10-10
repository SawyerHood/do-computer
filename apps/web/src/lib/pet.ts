import {
  type ApprovalRequest,
  chatActivity,
  chatMood,
  type ChatState,
  type ChatSummary,
  describeChatError,
} from "@durable-computer/protocol"
import type { MascotMood } from "./mascot.ts"

/**
 * What the desktop app gives the page it shows as an agent's companion: the creature that sits
 * on its owner's desktop, over their other windows. In a browser there is none of this, and
 * the page is only a creature on a page. See `apps/desktop/src/companion.ts`; the two are kept
 * alike by hand.
 */
export type PetBridge = {
  /** The agent its owner chose for it, if they have chosen one. */
  agent?: string
  /** The side of the square the creature is given, in the corner of the window it is kept to. */
  box: number
  /** Which corner that is, as things stood when the page loaded. */
  place: PetPlace
  /** Called when its owner chooses another agent for it. */
  onAgent(listener: (agentId: string) => void): void
  /** Called when the creature is put in another corner of its window. */
  onPlace(listener: (place: PetPlace) => void): void
  /** Called with where the pointer is on the screen, in the page's own measure, as it moves. */
  onPointer(listener: (at: { x: number; y: number }) => void): void
  /** Which agent it is showing, which the app ticks in its menu. */
  showing(agentId: string): void
  /**
   * The parts of the window that are something: the creature, and what it says. The rest is
   * let through to whatever is under it. With none, there is nothing to show and no window.
   */
  areas(rects: { x: number; y: number; width: number; height: number }[]): void
  /** It is picked up, to be carried with the pointer until it is put down. */
  drag(on: boolean): void
  /** Open the app on the agent, at one of its chats if given. */
  open(agentId: string, chatId?: string): void
  /** Show the menu of what can be done with it. */
  menu(): void
}

/** The corner of its window the creature is in. What it says takes the rest. */
export type PetPlace = { x: "left" | "right"; y: "top" | "bottom" }

declare global {
  interface Window {
    doComputerPet?: PetBridge
  }
}

export const petBridge = (): PetBridge | undefined =>
  typeof window === "undefined" ? undefined : window.doComputerPet

/**
 * What one window of the app says to the others about an agent's creature. The companion on
 * the desktop is a window of its own, and leans in when its owner types to the agent in another.
 */
const channel = () =>
  typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("dc-creature")
let telling: BroadcastChannel | undefined

/** A key was pressed in a message to the agent. */
export function tellCompanion(agentId: string): void {
  try {
    telling ??= channel()
    telling?.postMessage({ agentId, kind: "key" })
  } catch {
    // Nobody is told, and the creature in this window has leaned in already.
  }
}

/** Ask to hear of keys pressed in messages to an agent in the app's other windows. */
export function hearTyping(agentId: string, heard: () => void): () => void {
  const hearing = channel()
  if (hearing === undefined) return () => {}
  hearing.onmessage = (event: MessageEvent) => {
    const said = event.data as { agentId?: unknown; kind?: unknown } | null
    if (said?.agentId === agentId && said.kind === "key") heard()
  }
  return () => hearing.close()
}

/** The side of the creature's square where the app has not said. */
export const PET_BOX = 200

/** How many of an agent's chats its companion follows at once. */
const FOLLOWED = 4
/** A chat nobody has written in for this long is not one the agent is likely to be at work in. */
const RECENT_MS = 60 * 60_000

/**
 * The chats a companion follows, to know what its agent is doing: the main one, and the few
 * that were last written in. A chat that starts up later is one of those from then on.
 */
export function chatsToFollow(chats: readonly ChatSummary[], now: number): ChatSummary[] {
  const main = chats.filter((chat) => chat.main === true)
  const recent = chats
    .filter((chat) => chat.main !== true && !chat.archived && now - chat.updatedAt < RECENT_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return [...main, ...recent].slice(0, FOLLOWED)
}

/** What a companion says beside it. */
export type PetSaying = {
  kind: "working" | "waiting" | "done" | "error"
  text: string
  /** The chat it is about, which is opened when it is clicked. */
  chatId?: string
  /** That chat's name, when it is not the agent's main one. */
  where?: string
}

/** A chat that is followed, with what is known of it. */
export type FollowedChat = { chat: ChatSummary; state: ChatState; loaded: boolean }

const MAX_SAID = 150

/** The start of what was written, as one plain line. */
export function excerpt(text: string, limit = MAX_SAID): string {
  const plain = text
    // A block of code says nothing in a line.
    .replaceAll(/```[\s\S]*?(```|$)/g, " ")
    .replaceAll(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, "")
    .replaceAll(/[*`~]+/g, "")
    // An underscore marks emphasis only at the edge of a word. Inside one it is part of a name.
    .replaceAll(/(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, "")
    .replaceAll(/\s+/g, " ")
    .trim()
  if (plain.length <= limit) return plain
  const cut = plain.slice(0, limit - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

const place = (chat: ChatSummary) => (chat.main === true ? {} : { where: chat.title })

/**
 * What the agent is doing now, for its companion to act out and to say: waiting for its
 * owner's OK, at work in one of its chats, or nothing.
 */
export function petNow(
  followed: readonly FollowedChat[],
  pending: readonly ApprovalRequest[],
): { mood: MascotMood; saying?: PetSaying } {
  const asked = pending[0]
  if (asked !== undefined) {
    return {
      mood: { state: "waiting" },
      saying: {
        kind: "waiting",
        text: asked.title,
        chatId: asked.chatId,
        ...(followed.find((entry) => entry.chat.id === asked.chatId)?.chat.main === true
          ? {}
          : { where: asked.chatTitle }),
      },
    }
  }
  // The main chat is first among them, and is what is told of when it is at work in several.
  const busy = followed.find((entry) => entry.loaded && entry.state.busy)
  if (busy === undefined) return { mood: { state: "idle" } }
  const mood = chatMood(busy.state)
  return {
    mood: { state: mood.state, ...(mood.variant === undefined ? {} : { variant: mood.variant }) },
    saying: {
      kind: "working",
      text: chatActivity(busy.state) ?? "Writing its answer",
      chatId: busy.chat.id,
      ...place(busy.chat),
    },
  }
}

/**
 * What a companion says of a run that has just ended in one of its chats: the start of the
 * answer, or what went wrong. Nothing of one its owner stopped.
 */
export function petEnding(chat: ChatSummary, state: ChatState): PetSaying | undefined {
  const last = state.messages.at(-1)
  if (last === undefined || last.role !== "assistant" || last.status === "aborted") {
    return undefined
  }
  if (last.status === "error") {
    return {
      kind: "error",
      text: describeChatError(last.error).title,
      chatId: chat.id,
      ...place(chat),
    }
  }
  const answer = last.parts.findLast((part) => part.type === "text" && part.text.trim() !== "")
  return {
    kind: "done",
    text: answer?.type === "text" ? excerpt(answer.text) : "Finished.",
    chatId: chat.id,
    ...place(chat),
  }
}
