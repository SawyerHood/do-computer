// The plumbing every area's sources share: where the deployment is, the session, asking it for
// something, writing to it, turning a failure into a reply, whose an answer is, and following one
// of its sockets. An area's file (data/<area>.ts) uses these and nothing of fetch's own.
import type { Store, StreamSocket } from '../app.contract.d.ts';
import { PING_FRAME, PONG_FRAME } from '../protocol/daemon.ts';

// The deployment's address, and the same for its sockets (`ws:`, `wss:`), which app.ts reads
// from its settings and hands over before any source runs. app.ts's `grants` names them too.
export let API = '';
let SOCKETS = '';
export const setApi = (address: string, sockets: string) => { API = address; SOCKETS = sockets; };

/**
 * Whether the session is the browser's own cookie: the app is served by the deployment itself
 * (`DC_EXACT_APP`, apps/web/src/server/exact-app.ts), which sets it at sign-in, as for the React
 * app, and the browser sends it with every request and socket there. Signing in to either app is
 * then signing in to both. Anywhere else (another origin, a native host) the session is the
 * bearer token a sign-in hands over, kept in the platform's secret store.
 */
export const byCookie = (): boolean => (globalThis as { location?: { origin?: string } }).location?.origin === API;

/** The name the session is kept under: what a sign-in's `set-auth-token` header handed over. */
const SESSION = 'session';

/** The session, read from the store once. `undefined`: not read yet; `null`: signed out. */
let token: string | null | undefined;
/** Sign-ins and outs in this page, where the session is a cookie the app cannot read. */
let turns = 0;
export const session = (store: Store): string | null => {
  // Who it is is the server's to say (`/api/me`); what tags their answers is which turn this is.
  if (byCookie()) return `cookie ${turns}`;
  if (token === undefined) token = store.get(SESSION) || null;
  return token;
};
export const keep = (store: Store, value: string | null): void => {
  // The browser keeps the cookie the reply set or cleared: nothing of it is kept here.
  if (byCookie()) {
    turns++;
    return;
  }
  token = value;
  if (value === null) store.forget(SESSION);
  else store.set(SESSION, value);
};
/** What says who is asking, where the browser does not. */
const authorization = (store: Store): Record<string, string> => {
  const bearer = session(store);
  return bearer === null || byCookie() ? {} : { authorization: `Bearer ${bearer}` };
};

/**
 * Which sign-in an answer belongs to: the user's id and a tag of the session it was asked under,
 * so that an answer kept from one sign-in is never shown under another, even the same person's
 * after signing out and in again. The tag is a hash of the token, which says nothing of it.
 */
export function ownerOf(userId: string, store: Store): string {
  const bearer = session(store);
  if (bearer === null || userId === '') return '';
  let hash = 0x811c9dc5;
  for (let i = 0; i < bearer.length; i++) hash = Math.imul(hash ^ bearer.charCodeAt(i), 0x01000193) >>> 0;
  return `${userId}/${hash.toString(36)}`;
}

/**
 * Whether an owner the view asks for is still the one signed in. A source asked for one that is
 * not answers `NOBODY`'s nothing: the view is about to ask again with the new one, and shows an
 * answer only while its `owner` is the session's.
 */
export const current = (owner: string, store: Store): boolean => owner !== '' && ownerOf(owner.split('/')[0] ?? '', store) === owner;
export const NOBODY = '';

/** A reply the server refused, in its own words, with its status. */
export class Refused extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Ask the deployment, as whoever is signed in. A reply that is not ok is thrown, in its own words. */
export async function ask<T>(store: Store, path: string, init: RequestInit = {}): Promise<{ body: T; headers: Headers }> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    exactTimeout: 20000,
    headers: {
      ...authorization(store),
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: unknown; message?: unknown };
  if (!response.ok) {
    const why = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : `The server answered ${response.status}.`;
    throw new Refused(response.status, why);
  }
  return { body, headers: response.headers };
}

/** A read's body, for a resource: a failure is thrown, so Exact keeps the last answer and says why. */
export const get = async <T>(store: Store, path: string): Promise<T> => (await ask<T>(store, path)).body;
export const post = <T>(store: Store, path: string, body: unknown = {}) => ask<T>(store, path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T>(store: Store, path: string, body: unknown = {}) => ask<T>(store, path, { method: 'PUT', body: JSON.stringify(body) });
export const patch = <T>(store: Store, path: string, body: unknown) => ask<T>(store, path, { method: 'PATCH', body: JSON.stringify(body) });
export const del = <T>(store: Store, path: string) => ask<T>(store, path, { method: 'DELETE' });

/** What every write answers: whether it went through, and if not, why, in words to show. */
export type Reply = { ok: boolean; error: string };
export const OFFLINE = 'Can’t reach the server. Check your connection and try again.';

/** A write's reply: a refusal in the server's words, a lost connection in ours. */
export async function reply(write: () => Promise<unknown>): Promise<Reply> {
  try {
    await write();
    return { ok: true, error: '' };
  } catch (e) {
    if ((e as { code?: string }).code === 'bake') throw e; // no server at build
    if (e instanceof Refused) return { ok: false, error: e.message };
    return { ok: false, error: OFFLINE };
  }
}

/** A path segment, escaped. */
export const seg = encodeURIComponent;

/**
 * Tickets for sockets, where the session is a bearer token: a browser's socket carries no
 * header, so each opens with a ticket, good once, asked for with the session
 * (apps/web/src/server/socket-tickets.ts). On the web a stream has to be asked for as its
 * answer is, before anything is awaited, so there is no asking for one then: a few are kept
 * ready, and `stockTickets` (data/transport.ts) tops them up.
 *
 * A data source has no clock, so a ticket's age is counted in rounds: the view starts one a
 * minute, and a ticket is let go after `ROUNDS` of them, well before the server's five minutes.
 */
let tickets: { ticket: string; round: number }[] = [];
/** The session they were asked with, and the round it is. */
let ticketsOf: string | null = null;
let round = 0;
const READY = 4;
const ROUNDS = 3;
const good = (store: Store) => {
  const bearer = session(store);
  if (ticketsOf !== bearer) {
    tickets = [];
    ticketsOf = bearer;
  }
  tickets = tickets.filter((t) => round - t.round < ROUNDS);
  return tickets;
};
/** How many tickets are ready in round `now`, after asking for more where fewer than `READY` are. */
export async function stockTickets(store: Store, now: number): Promise<number> {
  round = Math.max(round, now);
  if (byCookie() || session(store) === null) return 0;
  const have = good(store).length;
  if (have >= READY) return have;
  const asked = session(store);
  const { body } = await post<{ tickets: string[] }>(store, '/api/auth/socket/tickets', { count: 2 * READY - have });
  // Signed out or in again meanwhile: they are the last session's.
  if (session(store) !== asked) return 0;
  tickets.push(...body.tickets.map((ticket) => ({ ticket, round })));
  return tickets.length;
}

/** Every socket open now, with how many pings it has been sent since it was last heard from. */
const open = new Map<StreamSocket, number>();
/** How many pings may go unanswered, at one each 30 s, before a socket is taken for lost (packages/client's 75 s). */
const UNANSWERED = 2;
/** Ping every open socket, and let go of one that has said nothing for too long: a mutation's source, run every 30 s. */
export function pingSockets(): number {
  for (const [socket, unanswered] of open) {
    if (socket.readyState !== 1) open.delete(socket);
    // A connection can die without ending: a laptop that slept, a network that changed.
    else {
      try {
        if (unanswered >= UNANSWERED) socket.close(4000, 'Nothing was heard');
        else socket.send(PING_FRAME);
        open.set(socket, unanswered + 1);
      } catch {
        // Closed as it was asked: its mapper hears of that.
        open.delete(socket);
      }
    }
  }
  return open.size;
}

/**
 * Follow one of the deployment's sockets (`/api/agents/:id/socket`, a feed): an answer that
 * keeps coming, every frame in order, none dropped or merged (Exact gives a WebSocket's mapper
 * each one). `open` is told when it is up, and may `say` what it wants told; `each` turns a
 * message into the next answer; `lost` is told when it ended or could not be opened (no ticket
 * was ready), after which the resource has to be asked again; `now` is the answer as it stands.
 */
export function follow<A, M>(store: Store, path: string, at: {
  open: (say: (value: unknown) => void) => A;
  each: (message: M, say: (value: unknown) => void) => A;
  lost: () => A;
  now: () => A;
}): A | Promise<A> {
  let url = `${SOCKETS}${path}`;
  if (!byCookie()) {
    if (session(store) === null) return at.lost();
    const ticket = good(store).shift();
    if (ticket === undefined) return at.lost();
    url += `${path.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(ticket.ticket)}`;
  }
  return fetch(url, {
    exactStream: (event, socket): A => {
      if (event.type === 'error' || event.type === 'close') {
        if (socket !== undefined) open.delete(socket);
        return at.lost();
      }
      const say = (value: unknown) => socket?.send(JSON.stringify(value));
      if (socket !== undefined) open.set(socket, 0);
      if (event.type === 'open') return at.open(say);
      if (typeof event.data !== 'string' || event.data === PONG_FRAME) return at.now();
      let message: M;
      try {
        message = JSON.parse(event.data) as M;
      } catch {
        return at.now();
      }
      return at.each(message, say);
    },
  });
}
