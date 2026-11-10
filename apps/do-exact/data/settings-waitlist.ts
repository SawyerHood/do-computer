// The waiting list, for whoever looks after a deployment that has one
// (apps/web/src/components/settings/waitlist.tsx): who is waiting, and letting one in.
import type { Result, Sources } from '../app.contract.d.ts';
import { avatarLook } from '../protocol/avatars.ts';
import { current, get, NOBODY, post, reply, seg } from './api.ts';

// packages/client's WaitingPerson.
type WaitingPerson = { id: string; name: string; email: string; joinedAt: number; dood: { id: string; name: string; color: string; seed: string } | null };

export const waitlistSources: Pick<Sources, 'loadWaitlist' | 'letIn'> = {
  loadWaitlist: async ([owner, asked], store): Promise<Result<'loadWaitlist'>> => {
    if (!asked || !current(owner, store)) return { owner: NOBODY, total: 0, people: [] };
    const { people, total } = await get<{ people: WaitingPerson[]; total: number }>(store, '/api/waitlist');
    return {
      owner,
      total,
      people: people.map((p) => {
        const look = p.dood === null ? null : avatarLook({ color: p.dood.color, seed: p.dood.seed }, p.dood.id);
        return { id: p.id, name: p.name, email: p.email, joinedAt: p.joinedAt, dood: p.dood?.name ?? '', seed: look?.seed ?? '', color: look?.color ?? '' };
      }),
    };
  },
  letIn: ([userId], store) => reply(() => post(store, `/api/waitlist/${seg(userId)}`)),
};
