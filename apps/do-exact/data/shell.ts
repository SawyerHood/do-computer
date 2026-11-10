// The shell's data: the workspaces, the Doods in each one's order with what each last said, a
// new Dood, that one was looked at, the open Dood's own socket and the person's feed.
import type { Result, Sources } from '../app.contract.d.ts';
import type { AgentLatest, AgentSummary } from '../protocol/agent.ts';
import { avatarLook } from '../protocol/avatars.ts';
import { inOrder, type DoodOrder } from '../protocol/order.ts';
import type { AgentSocketMessage } from '../protocol/socket.ts';
import { isPersonalWorkspace, personalWorkspaceId, workspaceColor, type FeedEvent, type WorkspacesState } from '../protocol/workspace.ts';
import { current, follow, get, NOBODY, post, put, reply, seg } from './api.ts';
import { countAsk, NO_ASKS } from './chat-asks.ts';

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

let followed = { owner: '', agentId: '', changes: 0, asks: NO_ASKS };
const NO_PULSE: Result<'followDood'> = { agentId: '', changes: 0, lost: false, asks: NO_ASKS };
const NO_FEED: Result<'followFeed'> = { owner: NOBODY, changes: 0, lost: false };
/** What the feed has said for whoever is signed in, kept across its sockets so the count only goes up. */
let feed = { owner: NOBODY, changes: 0, opened: false };

export const shellSources: Pick<Sources, 'loadWorkspaces' | 'loadDoods' | 'followDood' | 'followFeed' | 'hatchDood' | 'markSeen'> = {
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
  // What changes on the open Dood, as its socket says: `ready` on each connection (what was
  // asked before it may be behind) and a change to what the sidebar shows of it.
  followDood: ([owner, agentId], store): Result<'followDood'> | Promise<Result<'followDood'>> => {
    if (agentId === '' || !current(owner, store)) return NO_PULSE;
    if (followed.owner !== owner || followed.agentId !== agentId) followed = { owner, agentId, changes: 0, asks: NO_ASKS };
    const mine = followed;
    let lost = false;
    // What the chat shows of the Dood, counted on the same socket (data/chat-asks.ts).
    const now = () => ({ agentId, changes: mine.changes, lost, asks: mine.asks });
    return follow<Result<'followDood'>, AgentSocketMessage>(store, `/api/agents/${seg(agentId)}/socket`, {
      open: () => { lost = false; mine.changes++; mine.asks = countAsk(mine.asks, { type: 'ready' }); return now(); },
      each: (message) => {
        const event = message.type === 'agent' ? message.event : undefined;
        // Back from being put away, it may have changed meanwhile.
        if (message.type === 'resumed' || event?.type === 'ready' || event?.what === 'identity' || event?.what === 'creature') mine.changes++;
        if (message.type === 'resumed') mine.asks = countAsk(mine.asks, { type: 'ready' });
        else if (event !== undefined) mine.asks = countAsk(mine.asks, event);
        return now();
      },
      lost: () => {
        lost = true;
        return now();
      },
      now,
    });
  },
  // Everything the person's Doods are up to, on the person's own feed (the React app's
  // `useFeed`): a Dood starting or stopping work or saying something, one looked at elsewhere,
  // Doods put in another order. Each is counted, and the list asked for again; so is a feed
  // connected again, since what was said while it was down was said to nobody.
  followFeed: ([owner, userId], store): Result<'followFeed'> | Promise<Result<'followFeed'>> => {
    if (userId === '' || !current(owner, store)) return NO_FEED;
    if (feed.owner !== owner) feed = { owner, changes: 0, opened: false };
    const mine = feed;
    let lost = false;
    const now = () => ({ owner, changes: mine.changes, lost });
    return follow<Result<'followFeed'>, FeedEvent>(store, `/api/presence/${seg(personalWorkspaceId(userId))}`, {
      open: () => {
        if (mine.opened) mine.changes++;
        mine.opened = true;
        return now();
      },
      each: (event) => {
        if (event.type === 'agent' || event.type === 'seen' || event.type === 'order') mine.changes++;
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

