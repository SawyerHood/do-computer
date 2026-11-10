// What the chat shows of the open Dood that its event stream says changed: approvals, secrets,
// sign-ins, its chats (sub-agents, conversations), jobs, pins and the library. Counted on the
// shell's stream (data/shell.ts `followDood`), so that a Dood is followed once: a browser keeps
// six connections to a server, and each stream holds one.
import type { Result } from '../app.contract.d.ts';
import type { AgentEvent } from '../protocol/agent.ts';

export type AskCounts = Result<'followDood'>['asks'];

export const NO_ASKS: AskCounts = { jobs: 0, pins: 0, approvals: 0, secrets: 0, chats: 0, connectors: 0, library: 0 };

/** The counts after one event. `ready` begins each connection: whatever was asked before may be behind. */
export function countAsk(counts: AskCounts, event: AgentEvent): AskCounts {
  if (event.type === 'ready') return Object.fromEntries(Object.entries(counts).map(([key, n]) => [key, n + 1])) as AskCounts;
  const next = { ...counts };
  switch (event.what) {
    case 'approvals': next.approvals++; break;
    // Giving an access token adds a connector.
    case 'secrets': next.secrets++; next.connectors++; break;
    // A rule can be set for each connector, and for each computer.
    case 'connectors': next.connectors++; next.approvals++; break;
    case 'computers': next.approvals++; break;
    case 'chats': case 'identity': next.chats++; break;
    // Sites are told of with the library: what was shared is asked for again with it.
    case 'library': next.library++; next.pins++; break;
    case 'pins': next.pins++; break;
    case 'jobs': next.jobs++; break;
  }
  return next;
}
