// The plumbing every area's sources share: where the deployment is, the session, asking it for
// something, writing to it, turning a failure into a reply, whose an answer is, and following a
// stream. An area's file (data/<area>.ts) uses these and nothing of fetch's own.
import type { Store } from '../app.contract.d.ts';

// The deployment's address, which app.ts reads from its setting and hands over before any source runs. app.ts's
// `grants` names it too.
export let API = '';
export const setApi = (address: string) => { API = address; };

/** The name the session is kept under: what a sign-in's `set-auth-token` header handed over. */
const SESSION = 'session';

/** The session, read from the store once. `undefined`: not read yet; `null`: signed out. */
let token: string | null | undefined;
export const session = (store: Store): string | null => {
  if (token === undefined) token = store.get(SESSION) || null;
  return token;
};
export const keep = (store: Store, value: string | null): void => {
  token = value;
  if (value === null) store.forget(SESSION);
  else store.set(SESSION, value);
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
  const bearer = session(store);
  const response = await fetch(`${API}${path}`, {
    ...init,
    exactTimeout: 20000,
    headers: {
      ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
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
 * Follow a server-sent event stream: an answer that keeps coming. `each` turns one event's data
 * into the next answer, told whether events before it were dropped (Exact coalesces events that
 * arrive faster than it commits them); `lost` is told when the stream failed or ended, after
 * which what is shown may be behind until the resource is asked again; `now` is the answer as it
 * stands, for an event that carries nothing. On the web the stream has to be asked for before
 * anything is awaited, which reading the session from the store allows.
 */
export function follow<A, E>(store: Store, path: string, at: {
  each: (event: E, skipped: boolean) => A;
  lost: () => A;
  now: () => A;
}): Promise<A> {
  const bearer = session(store);
  return fetch(`${API}${path}`, {
    headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
    exactStream: (event): A => {
      if (event.type === 'error' || event.type === 'close') return at.lost();
      if (typeof event.data !== 'string' || event.data === '') return at.now();
      return at.each(JSON.parse(event.data) as E, event.coalesced > 0);
    },
  });
}
