import type { Result, Sources } from '../app.contract.d.ts';
import type { AgentSummary, ChatSummary } from '../protocol/agent.ts';
import { current, get, NOBODY, seg } from './api.ts';

const words: Record<string, string> = { working: 'Answering', waiting: 'Waiting for your OK', done: 'Answered', stopped: 'Stopped', failed: 'Did not answer' };
export const threadsSources: Pick<Sources, 'loadThreads'> = {
  loadThreads: async ([owner, agentId], store): Promise<Result<'loadThreads'>> => {
    if (agentId === '' || !current(owner, store)) return { owner: NOBODY, agentId: '', chats: [] };
    const state = await get<{ agent: AgentSummary; chats: ChatSummary[] }>(store, `/api/agents/${seg(agentId)}`);
    const chats = state.chats.filter(c => c.kind === 'chat' || !c.archived).sort((a, b) => b.updatedAt - a.updatedAt).map(c => ({
      id: c.id, title: c.title, kind: c.kind, main: c.main === true, status: c.status ?? '', parentId: c.parentId ?? '', peerId: c.peer?.agentId ?? '', updated: c.updatedAt,
      detail: c.kind === 'slack' ? `${c.slack?.direct ? 'Direct message' : c.slack?.channel ? `#${c.slack.channel}` : 'Slack'} · ${(words[c.status ?? 'done'] ?? 'Answered').toLowerCase()}`
        : c.kind === 'agent' ? `${c.peer?.name ?? 'A Dood'} · ${(words[c.status ?? 'done'] ?? 'Answered').toLowerCase()}` : c.kind === 'chat' ? 'Kept to read' : words[c.status ?? 'done'] ?? '',
      url: c.slack?.url ?? '',
    }));
    return { owner, agentId, chats };
  },
};
