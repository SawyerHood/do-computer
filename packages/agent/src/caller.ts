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

/**
 * The note that travels with a sent message, for the model: when it was sent and, where the
 * agent is shared, by whom. The sender's name is theirs to choose, so it is written as an
 * attribute's value and cannot end the tag.
 */
export function sentMeta(sentAt: string, from: Caller | undefined): string {
  const who =
    from === undefined
      ? ""
      : ` from="${escapeAttribute(from.name.replace(/\s+/g, " ").trim().slice(0, 80))}" from_id="${escapeAttribute(from.id)}"`
  return `<meta sent_at="${escapeAttribute(sentAt)}"${who}/>`
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
