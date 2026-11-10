// The chat area: which chat is a Dood's main one, the chat as it stands and as it changes, and
// saying something in it.
import type { Result, Sources } from '../app.contract.d.ts';
// What a chat is and how an event changes it, from the protocol the server and every other
// client share: types and one pure function, so nothing of the package's is run but that.
import { EMPTY_CHAT, reduceChat, type ChatEvent, type ChatMessage, type ChatState, type MessagePart } from '../protocol/chat.ts';
import type { ChatSummary } from '../protocol/agent.ts';
import { current, follow, NOBODY, post, reply, seg } from './api.ts';

type Chat = Result<'followChat'>;
type Block = Chat['messages'][number]['blocks'][number];

const NO_CHAT: Chat = { owner: NOBODY, agentId: '', chatId: '', busy: false, lost: false, messages: [] };

/** A message's parts as the view draws them. What the agent does only to speak (`send`) and what it wrote for nobody are left out. */
function blocksOf(message: ChatMessage): Block[] {
  const blocks: Block[] = [];
  message.parts.forEach((part: MessagePart, index) => {
    const id = String(index);
    switch (part.type) {
      case 'text':
        if (part.text !== '') blocks.push({ id, kind: 'text', text: part.text, name: '', status: '' });
        break;
      case 'thinking':
        if (part.text !== '' && part.written !== true) blocks.push({ id, kind: 'thinking', text: part.text, name: '', status: '' });
        break;
      case 'tool':
        if (part.name !== 'send') blocks.push({ id, kind: 'tool', text: part.output ?? '', name: part.name, status: part.status });
        break;
      case 'image':
        blocks.push({ id, kind: 'image', text: 'A picture', name: '', status: '' });
        break;
      case 'notice':
        blocks.push({ id, kind: 'notice', text: part.detail ?? '', name: part.text, status: part.kind });
        break;
    }
  });
  return blocks;
}

function chatOf(owner: string, agentId: string, chatId: string, state: ChatState, lost: boolean): Chat {
  const messages = state.messages
    .map((message) => ({ id: message.id, role: message.role, status: message.status, error: message.error ?? message.notSent ?? '', blocks: blocksOf(message) }))
    .filter((message) => message.blocks.length > 0 || message.error !== '');
  return { owner, agentId, chatId, busy: state.busy, lost, messages };
}

export const chatSources: Pick<Sources, 'openChat' | 'followChat' | 'sendMessage'> = {
  // The Dood's main chat, which it is given the first time it is opened.
  openChat: async ([owner, agentId], store): Promise<Result<'openChat'>> => {
    if (agentId === '' || !current(owner, store)) return { owner: NOBODY, agentId: '', chatId: '' };
    const { body } = await post<ChatSummary>(store, `/api/agents/${seg(agentId)}/chats/main`);
    return { owner, agentId, chatId: body.id };
  },
  // The chat as it stands, then again after each event. Events are deltas, so one that Exact
  // dropped (it coalesces those that come faster than it commits) leaves the chat behind: it is
  // marked `lost`, and the view follows it again from a fresh snapshot.
  followChat: ([owner, agentId, chatId], store): Chat | Promise<Chat> => {
    if (agentId === '' || chatId === '' || !current(owner, store)) return NO_CHAT;
    let state: ChatState = EMPTY_CHAT;
    let lost = false;
    const now = () => chatOf(owner, agentId, chatId, state, lost);
    return follow<Chat, ChatEvent>(store, `/api/agents/${seg(agentId)}/chats/${seg(chatId)}/events`, {
      each: (change, skipped) => {
        // Events that were skipped cannot be made up for; a snapshot says where things stand anyway.
        if (change.type === 'snapshot') lost = false;
        else if (skipped) lost = true;
        state = reduceChat(state, change);
        return now();
      },
      lost: () => {
        lost = true;
        return now();
      },
      now,
    });
  },
  sendMessage: ([agentId, chatId, text, requestId], store) => reply(() =>
    post(store, `/api/agents/${seg(agentId)}/chats/${seg(chatId)}/messages`, { text, requestId })),
};
