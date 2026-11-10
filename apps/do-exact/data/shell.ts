// The shell's data: the workspaces, the Doods in each one's order with what each last said, a
// new Dood, that one was looked at, and the open Dood's own event stream.
import type { Result, Sources } from '../app.contract.d.ts';
import type { AgentEvent, AgentLatest, AgentSummary } from '../protocol/agent.ts';
import { avatarLook } from '../protocol/avatars.ts';
import { inOrder, type DoodOrder } from '../protocol/order.ts';
import { isPersonalWorkspace, workspaceColor, type WorkspacesState } from '../protocol/workspace.ts';
import { current, follow, get, NOBODY, post, put, reply, seg } from './api.ts';

type Dood = Result<'loadDoods'>['doods'][number];

/** The latest line, with who it is from in front where that says something (apps/web/src/lib/latest.ts `latestWords`). */
function latestWords(latest: AgentLatest, me: string): string {
  if (latest.kind === 'said') return latest.by === me ? `You: ${latest.text}` : latest.text;
  if (latest.from === undefined || latest.from === '') return latest.text;
  if (latest.kind === 'scheduled') return `${latest.from}: ${latest.text}`;
  if (latest.kind === 'agent') return `From ${latest.from}: ${latest.text}`;
  if (latest.kind === 'slack') return `#${latest.from}: ${latest.text}`;
  return latest.text;
}

/** Whether a Dood has something this person has not seen (latest.ts `isUnread`). What they wrote is not news to them. */
function unread(agent: AgentSummary, me: string): boolean {
  const { latest } = agent;
  if (latest === undefined) return false;
  if (latest.kind === 'said' && latest.by === me) return false;
  const seen = agent.seenAt ?? 0;
  return seen > 0 && latest.at > seen;
}

function doodOf(agent: AgentSummary, me: string): Dood {
  const look = avatarLook(agent.avatar, agent.id);
  return {
    id: agent.id,
    name: agent.name ?? '',
    workspaceId: agent.workspaceId ?? '',
    latest: agent.latest === undefined ? '' : latestWords(agent.latest, me),
    latestAt: agent.latest?.at ?? 0,
    working: agent.working === true,
    asking: agent.asking === true,
    unread: unread(agent, me),
    seed: look.seed,
    color: look.color,
    hatched: agent.hatched,
    outfit: JSON.stringify(agent.outfit ?? {}),
  };
}

const NO_PULSE: Result<'followDood'> = { agentId: '', changes: 0, lost: false };

export const shellSources: Pick<Sources, 'loadWorkspaces' | 'loadDoods' | 'followDood' | 'hatchDood' | 'markSeen'> = {
  loadWorkspaces: async ([owner], store): Promise<Result<'loadWorkspaces'>> => {
    if (!current(owner, store)) return { owner: NOBODY, workspaces: [] };
    const state = await get<WorkspacesState>(store, '/api/workspaces');
    return {
      owner,
      workspaces: state.workspaces.map((w) => ({ id: w.id, name: w.name, kind: w.kind, color: workspaceColor(w.color), role: w.role })),
    };
  },
  // Each workspace's Doods in the order the person put them in, else the latest first
  // (protocol/order.ts, which the phone app and the React app share).
  loadDoods: async ([owner], store): Promise<Result<'loadDoods'>> => {
    if (!current(owner, store)) return { owner: NOBODY, doods: [] };
    const me = owner.split('/')[0] ?? '';
    const [{ agents }, { order }] = await Promise.all([
      get<{ agents: AgentSummary[] }>(store, '/api/agents'),
      get<{ order: DoodOrder }>(store, '/api/agent-order'),
    ]);
    const workspaces = [...new Set(agents.map((agent) => agent.workspaceId ?? ''))];
    const ordered = workspaces.flatMap((id) => inOrder(agents.filter((agent) => (agent.workspaceId ?? '') === id), order[id]));
    return { owner, doods: ordered.map((agent) => doodOf(agent, me)) };
  },
  // What changes on the open Dood, as its event stream says: `ready` on each connection (what
  // was asked before it may be behind) and a change to what the sidebar shows of it.
  followDood: ([owner, agentId], store): Result<'followDood'> | Promise<Result<'followDood'>> => {
    if (agentId === '' || !current(owner, store)) return NO_PULSE;
    let changes = 0;
    let lost = false;
    const now = () => ({ agentId, changes, lost });
    return follow<Result<'followDood'>, AgentEvent>(store, `/api/agents/${seg(agentId)}/events`, {
      each: (event) => {
        if (event.type === 'ready' || event.what === 'identity' || event.what === 'creature') changes++;
        return now();
      },
      lost: () => {
        lost = true;
        return now();
      },
      now,
    });
  },
  // A new Dood, in a team if one is named; it opens at once, as the React app's does.
  hatchDood: async ([workspaceId], store): Promise<Result<'hatchDood'>> => {
    let agentId = '';
    const done = await reply(async () => {
      const { body } = await post<{ agent: AgentSummary }>(store, '/api/agents', isPersonalWorkspace(workspaceId) || workspaceId === '' ? {} : { workspaceId });
      agentId = body.agent.id;
    });
    return { ...done, agentId };
  },
  markSeen: ([agentId], store) => reply(() => put(store, `/api/agents/${seg(agentId)}/seen`)),
};

