import { MESSAGE_APPS, MESSAGE_DEVICES, type MessageApp } from "@do-computer/protocol"

/**
 * Who a request is from. The actor trusts its gateway, which has checked the session, so this is
 * only ever what the gateway wrote: a client cannot set it.
 */
export type Caller = { id: string; name: string }

/** Header in which the gateway tells the actor which signed-in user a request is from. */
export const CALLER_HEADER = "x-dc-caller"

/** Header values are ASCII, and a name is not. */
export const encodeCaller = (caller: Caller): string =>
  encodeURIComponent(JSON.stringify({ id: caller.id, name: caller.name }))

/** The caller of a request, or undefined when the gateway named none or it cannot be read. */
export function readCaller(request: Request): Caller | undefined {
  const value = request.headers.get(CALLER_HEADER)
  if (value === null) return undefined
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<Caller> | null
    if (typeof parsed?.id !== "string" || parsed.id === "" || typeof parsed.name !== "string") {
      return undefined
    }
    return { id: parsed.id, name: parsed.name }
  } catch {
    return undefined
  }
}

const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
const unescapeAttribute = (value: string) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")

/** Where a message was written, in the words its note says it in. */
export type SentFrom = {
  /** The app it was written in. */
  via: string
  /** The kind of device. */
  device?: string
  /** The computer it was written on, by the name the agent has for it. */
  computer?: string
}

/** What each app a message can be written in is called, to the model. */
const VIA: Record<MessageApp, string> = {
  browser: "web browser",
  desktop: "desktop app",
  mobile: "mobile app",
}

/**
 * Where a message was written, from what its sender's app said. That is the sender's to choose,
 * so only words from a list are taken from it. The computer is one of the agent's own, by the
 * name the agent has for it, and one the agent does not have is left out.
 */
export function sentFrom(
  said: unknown,
  computers: readonly { id: string; name: string }[],
): SentFrom | undefined {
  if (typeof said !== "object" || said === null) return undefined
  const { app, device, computerId } = said as Record<string, unknown>
  if (typeof app !== "string" || !(MESSAGE_APPS as readonly string[]).includes(app)) {
    return undefined
  }
  const computer =
    typeof computerId === "string" && computerId !== ""
      ? computers.find((one) => one.id === computerId)?.name
      : undefined
  return {
    via: VIA[app as MessageApp],
    ...(typeof device === "string" && (MESSAGE_DEVICES as readonly string[]).includes(device)
      ? { device }
      : {}),
    ...(computer === undefined ? {} : { computer }),
  }
}

/**
 * The note that travels with a sent message, for the model: when it was sent, where the agent
 * is shared, by whom, and where the sender's app said, from where. A person's name and a
 * computer's are theirs to choose, so each is written as an attribute's value and cannot end
 * the tag.
 */
export function sentMeta(sentAt: string, from: Caller | undefined, where?: SentFrom): string {
  const who =
    from === undefined
      ? ""
      : ` from="${escapeAttribute(from.name.replace(/\s+/g, " ").trim().slice(0, 80))}" from_id="${escapeAttribute(from.id)}"`
  const place =
    where === undefined
      ? ""
      : ` via="${escapeAttribute(where.via)}"${
          where.device === undefined ? "" : ` device="${escapeAttribute(where.device)}"`
        }${
          where.computer === undefined
            ? ""
            : ` computer="${escapeAttribute(where.computer.replace(/\s+/g, " ").trim().slice(0, 80))}"`
        }`
  return `<meta sent_at="${escapeAttribute(sentAt)}"${who}${place}/>`
}

/** Who sent a message, read back out of the note that travelled with it. */
export function senderOf(meta: string): Caller | undefined {
  if (!meta.startsWith("<meta sent_at=")) return undefined
  const id = / from_id="([^"]*)"/.exec(meta)?.[1]
  const name = / from="([^"]*)"/.exec(meta)?.[1]
  if (id === undefined || name === undefined) return undefined
  return { id: unescapeAttribute(id), name: unescapeAttribute(name) }
}

/**
 * The note that travels with a message from another agent, for the model: which agent it is
 * from, and what to make of it. The name is the other agent's to choose, so it is written as an
 * attribute's value and cannot end the tag.
 */
export function agentMeta(from: Caller, note: string): string {
  return `<meta kind="agent" from="${escapeAttribute(from.name)}" from_agent="${escapeAttribute(from.id)}">${note}</meta>`
}

/** Which agent sent a message, read back out of the note that travelled with it. */
export function agentSenderOf(meta: string): Caller | undefined {
  if (!meta.startsWith('<meta kind="agent" from="')) return undefined
  const head = meta.slice(0, meta.indexOf(">"))
  const id = / from_agent="([^"]*)"/.exec(head)?.[1]
  const name = / from="([^"]*)"/.exec(head)?.[1]
  if (id === undefined || name === undefined) return undefined
  return { id: unescapeAttribute(id), name: unescapeAttribute(name) }
}

/** Someone who wrote to the agent in Slack. */
export type SlackSender = {
  /** Their id in Slack. */
  id: string
  name: string
  /** The user of the app they are, where they are one of the people the agent works for. */
  userId?: string
}

/**
 * The note that travels with a message written in Slack, for the model: who wrote it, when, and
 * what to make of it. A name in Slack is its owner's to choose, so it is written as an
 * attribute's value and cannot end the tag.
 */
export function slackMeta(sentAt: string, from: SlackSender, note: string): string {
  const member = from.userId === undefined ? "" : ` from_id="${escapeAttribute(from.userId)}"`
  return `<meta kind="slack" sent_at="${escapeAttribute(sentAt)}" from="${escapeAttribute(from.name)}" from_slack="${escapeAttribute(from.id)}"${member}>${note}</meta>`
}

/** Who wrote a message in Slack, read back out of the note that travelled with it. */
export function slackSenderOf(meta: string): SlackSender | undefined {
  if (!meta.startsWith('<meta kind="slack" ')) return undefined
  const head = meta.slice(0, meta.indexOf(">"))
  const id = / from_slack="([^"]*)"/.exec(head)?.[1]
  const name = / from="([^"]*)"/.exec(head)?.[1]
  const userId = / from_id="([^"]*)"/.exec(head)?.[1]
  if (id === undefined || name === undefined) return undefined
  return {
    id: unescapeAttribute(id),
    name: unescapeAttribute(name),
    ...(userId === undefined ? {} : { userId: unescapeAttribute(userId) }),
  }
}
