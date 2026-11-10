import type { BetterAuthPlugin } from "better-auth"
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { generateRandomString } from "better-auth/crypto"
import type { SessionUser } from "./auth.ts"

/**
 * Tickets for the live connections, for a client that keeps its session out of the browser's
 * cookie jar: the Exact app while it is served from another origin (`DC_CLIENT_ORIGINS`), and
 * any app whose WebSocket can send no header.
 *
 * A browser's WebSocket carries no `Authorization` header, and a cookie only to the site that
 * set it, so such a client cannot open one as itself. It asks for tickets with its session
 * instead, and opens each socket with one as `?ticket=`. A ticket is good for one socket, for
 * a few minutes, and only while the session it was asked with lasts: what a URL may leave in a
 * log is spent already, and the session itself is never in one. A client asks for a few at a
 * time, since some (the Exact app's on the web) must open a socket at once, with no time to ask.
 */

/** The query parameter a socket's ticket is in. */
export const TICKET_PARAM = "ticket"
/** How long a ticket can wait to be used. */
export const SOCKET_TICKET_SECONDS = 5 * 60
/** The most tickets one request is given. */
export const MOST_TICKETS = 8

const PREFIX = "socket-ticket:"

/** What a ticket is kept under. The ticket itself is never kept, as a desktop token is not. */
async function ticketIdentifier(ticket: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ticket))
  return `${PREFIX}${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

type Issue = { message: string }

/** `{ count }`, checked by hand: see `tokenBody` in desktop-handoff.ts. */
const countBody = {
  "~standard": {
    version: 1 as const,
    vendor: "do-computer",
    validate: (value: unknown): { value: { count?: number } } | { issues: Issue[] } => {
      const count = (value as { count?: unknown } | null)?.count
      if (count === undefined) return { value: {} }
      if (
        typeof count !== "number" ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > MOST_TICKETS
      ) {
        return { issues: [{ message: `A count is a whole number from 1 to ${MOST_TICKETS}.` }] }
      }
      return { value: { count } }
    },
    types: undefined as unknown as { input: { count?: number }; output: { count?: number } },
  },
}

const ticketBody = {
  "~standard": {
    version: 1 as const,
    vendor: "do-computer",
    validate: (value: unknown): { value: { ticket: string } } | { issues: Issue[] } => {
      const ticket = (value as { ticket?: unknown } | null)?.ticket
      if (typeof ticket !== "string" || ticket === "" || ticket.length > 256) {
        return { issues: [{ message: "A ticket is needed." }] }
      }
      return { value: { ticket } }
    },
    types: undefined as unknown as { input: { ticket: string }; output: { ticket: string } },
  },
}

type Kept = { value: string; expiresAt: Date }
type SessionRow = { id: string; userId: string; expiresAt: Date }

export const socketTickets = () =>
  ({
    id: "socket-tickets",
    endpoints: {
      /** POST `/socket/tickets`: tickets for whoever is signed in, one socket each. */
      socketTickets: createAuthEndpoint(
        "/socket/tickets",
        { method: "POST", body: countBody, use: [sessionMiddleware] },
        async (ctx) => {
          const { adapter, internalAdapter, session } = ctx.context
          // Those that ran out unused go now, so the table holds no more than are live.
          await adapter.deleteMany({
            model: "verification",
            where: [
              { field: "identifier", operator: "starts_with", value: PREFIX },
              { field: "expiresAt", operator: "lt", value: new Date() },
            ],
          })
          const expiresAt = new Date(Date.now() + SOCKET_TICKET_SECONDS * 1000)
          const tickets = Array.from({ length: ctx.body.count ?? 1 }, () =>
            generateRandomString(32),
          )
          for (const ticket of tickets) {
            await internalAdapter.createVerificationValue({
              identifier: await ticketIdentifier(ticket),
              // The session's id, which signs nobody in: the session is looked up when it is used.
              value: session.session.id,
              expiresAt,
            })
          }
          // How long they last from now, which needs no clock of the client's to agree with this one.
          return ctx.json({ tickets, expiresIn: SOCKET_TICKET_SECONDS })
        },
      ),
      /** Who a ticket is for, using it up. Called by the server only: it has no address. */
      redeemSocketTicket: createAuthEndpoint(
        "/socket/redeem",
        { method: "POST", body: ticketBody, metadata: { SERVER_ONLY: true } },
        async (ctx) => {
          const { adapter, internalAdapter } = ctx.context
          // Taken out of the table before anything is done with it, in the one statement, so of
          // two sockets with the same ticket one finds nothing (as in desktop-handoff.ts).
          const kept = await adapter.consumeOne<Kept>({
            model: "verification",
            where: [{ field: "identifier", value: await ticketIdentifier(ctx.body.ticket) }],
          })
          const now = new Date()
          if (kept === null || new Date(kept.expiresAt) < now) return ctx.json({ user: null })
          // Signed out since, or the session ran out: the ticket went with it.
          const session = await adapter.findOne<SessionRow>({
            model: "session",
            where: [{ field: "id", value: kept.value }],
          })
          if (session === null || new Date(session.expiresAt) < now) return ctx.json({ user: null })
          const user = (await internalAdapter.findUserById(session.userId)) as SessionUser | null
          return ctx.json({ user })
        },
      ),
    },
  }) satisfies BetterAuthPlugin
