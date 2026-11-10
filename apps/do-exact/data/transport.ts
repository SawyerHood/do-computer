// How the app hears from the server live: tickets for its sockets where the session is a bearer
// token, and a ping for every open socket. The sockets themselves are data/api.ts `follow`.
import type { Result, Sources } from '../app.contract.d.ts';
import { current, NOBODY, pingSockets, reply, stockTickets } from './api.ts';

export const transportSources: Pick<Sources, 'stockSockets' | 'pingAll'> = {
  stockSockets: async ([owner, round], store): Promise<Result<'stockSockets'>> => {
    if (!current(owner, store)) return { owner: NOBODY, ready: 0 };
    return { owner, ready: await stockTickets(store, round) };
  },
  pingAll: () => {
    pingSockets();
    return { ok: true, error: '' };
  },
};
