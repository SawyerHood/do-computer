// The caller's requests cross this small bridge; the native view never receives a session.
import type { Result, Sources } from '../app.contract.d.ts';
import type { CallsState, StartCallResponse } from '../protocol/calls.ts';
import { API, current, get, post, Refused, seg } from './api.ts';

export const callSources: Pick<Sources, 'loadCallOffer' | 'callRequest' | 'readCallView'> = {
  loadCallOffer: async ([owner, agentId], store): Promise<Result<'loadCallOffer'>> => {
    if (!current(owner, store) || !agentId) return { owner: '', agentId: '', available: false, address: API };
    const calls = await get<CallsState>(store, `/api/agents/${seg(agentId)}/calls`);
    return { owner, agentId, available: calls.available, address: API };
  },
  callRequest: async ([owner, json], store): Promise<Result<'callRequest'>> => {
    let id = '';
    try {
      const request = JSON.parse(json) as { id: string; agentId: string; verb: string; callId: string; body: unknown };
      id = request.id;
      if (!current(owner, store)) throw new Error('Sign in again to call your Dood.');
      const base = `/api/agents/${seg(request.agentId)}/calls`;
      let body: unknown;
      if (request.verb === 'calls') body = await get(store, base);
      else if (request.verb === 'start') body = (await post<StartCallResponse>(store, base, request.body)).body.call;
      else if (request.verb === 'lines' || request.verb === 'work' || request.verb === 'end') body = (await post(store, `${base}/${seg(request.callId)}/${request.verb}`, request.body)).body;
      else if (request.verb === 'socket') {
        const ticket = (await post<{ tickets: string[] }>(store, '/api/auth/socket/tickets', { count: 1 })).body.tickets[0];
        body = { address: `${API.replace(/^http/, 'ws')}/api/agents/${seg(request.agentId)}/socket?ticket=${seg(ticket ?? '')}` };
      } else throw new Error('Unknown call request.');
      return { json: JSON.stringify({ id, ok: true, body }) };
    } catch (error) {
      if ((error as { code?: string }).code === 'bake') throw error;
      return { json: JSON.stringify({ id, ok: false, error: error instanceof Error ? error.message : 'The call could not reach the server.', status: error instanceof Refused ? error.status : 0 }) };
    }
  },
  readCallView: ([owner, json]): Result<'readCallView'> => {
    const value = JSON.parse(json) as Result<'readCallView'>;
    return { ...value, owner, lines: value.lines.map((l, i) => ({ id: `line-${i}`, who: l.who, text: l.text })), works: value.works.map(w => ({ id: w.id, ask: w.ask, done: w.done, step: w.step ?? '' })) };
  },
};
