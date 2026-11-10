// The session area: who is signed in, signing in or making an account, and signing out.
import type { Result, Sources } from '../app.contract.d.ts';
import { ask, byCookie, keep, ownerOf, post, Refused, reply, session, stockTickets } from './api.ts';
import { AVATAR_COLORS } from '../protocol/avatars.ts';

type Me = { user: { id: string; name: string; email: string } };

const SIGNED_OUT: Result<'loadSession'> = { signedIn: false, owner: '', userId: '', name: '', email: '', initials: '', color: '' };

/** Two letters for a face with no picture, as the React app's PersonFace: the first and last names' first, or a name's first two. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== '');
  const letters = words.length > 1 ? `${words[0]!.slice(0, 1)}${words[words.length - 1]!.slice(0, 1)}` : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase() || '?';
}

/** The colour of a face with no picture, as the React app's PersonFace: from the person's id. */
export function faceColorOf(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!.hex;
}

export const sessionSources: Pick<Sources, 'loadSession' | 'signIn' | 'signOut'> = {
  loadSession: async (_args, store): Promise<Result<'loadSession'>> => {
    // With no token, the browser's own cookie may be the session (data/api.ts `byCookie`).
    if (session(store) === null && !(await byCookie(store))) return SIGNED_OUT;
    try {
      const { body } = await ask<Me>(store, '/api/me');
      const { id, name, email } = body.user;
      // Tickets for the sockets the app opens next, ready before anything follows (data/api.ts).
      await stockTickets(store, 0).catch(() => 0);
      return { signedIn: true, owner: ownerOf(id, store), userId: id, name, email, initials: initialsOf(name), color: faceColorOf(id) };
    } catch (e) {
      // A session the server no longer knows is over. Anything else fails the read, which keeps the last answer.
      if (e instanceof Refused && e.status === 401) {
        keep(store, null);
        return SIGNED_OUT;
      }
      throw e;
    }
  },
  signIn: ([email, password, name, joining], store) => reply(async () => {
    const { headers } = await post(store, joining ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email', joining ? { email, password, name } : { email, password });
    const handed = headers.get('set-auth-token');
    if (handed === null || handed === '') throw new Refused(200, 'The server signed you in but handed over no session. It may be too old for this app.');
    // Where the browser kept the cookie the reply set, that is the session, and the token is not kept.
    if (!(await byCookie(store))) keep(store, handed);
  }),
  signOut: (_args, store) => reply(async () => {
    // Signed out here whatever the server says: a session it cannot be told about is still forgotten.
    await post(store, '/api/auth/sign-out').catch(() => undefined);
    keep(store, null);
  }),
};
