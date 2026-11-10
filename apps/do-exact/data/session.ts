// The session area: who is signed in, signing in or making an account, and signing out.
import type { Result, Sources } from '../app.contract.d.ts';
import { keep, ownerOf, post, Refused, reply, session, ask } from './api.ts';

type Me = { user: { id: string; name: string; email: string } };

const SIGNED_OUT: Result<'loadSession'> = { signedIn: false, owner: '', userId: '', name: '', email: '', initials: '' };

/** One or two letters for a face with no picture: the first of the first and last names. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== '');
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1);
  return letters.map((word) => word.slice(0, 1).toUpperCase()).join('') || '?';
}

export const sessionSources: Pick<Sources, 'loadSession' | 'signIn' | 'signOut'> = {
  loadSession: async (_args, store): Promise<Result<'loadSession'>> => {
    if (session(store) === null) return SIGNED_OUT;
    try {
      const { body } = await ask<Me>(store, '/api/me');
      const { id, name, email } = body.user;
      return { signedIn: true, owner: ownerOf(id, store), userId: id, name, email, initials: initialsOf(name) };
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
    keep(store, handed);
  }),
  signOut: (_args, store) => reply(async () => {
    // Signed out here whatever the server says: a session it cannot be told about is still forgotten.
    await post(store, '/api/auth/sign-out').catch(() => undefined);
    keep(store, null);
  }),
};
