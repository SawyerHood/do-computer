import type { Answer, Result, Sources, Store } from './app.contract.d.ts';
// What a chat is and how an event changes it, from the protocol the server and every other
// client share: types and one pure function, so nothing of the package's is run but that.
import { EMPTY_CHAT, reduceChat, type ChatEvent, type ChatMessage, type ChatState, type MessagePart } from './protocol/chat.ts';
import type { AgentSummary, ChatSummary } from './protocol/agent.ts';

// The deployment's address, its one place: server.ts listens on it for the tests and the dev loop.
export const API = 'http://127.0.0.1:3911';
export const grants = `net.fetch ${API}\nsecret.keep session`;

/** The name the session is kept under: what a sign-in's `set-auth-token` header handed over. */
const SESSION = 'session';

/** The session, read from the store once. `undefined`: not read yet; `null`: signed out. */
let token: string | null | undefined;
const session = (store: Store): string | null => {
  if (token === undefined) token = store.get(SESSION) || null;
  return token;
};
const keep = (store: Store, value: string | null): void => {
  token = value;
  if (value === null) store.forget(SESSION);
  else store.set(SESSION, value);
};

class Refused extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Ask the deployment, as whoever is signed in. A reply that is not ok is thrown, in its own words. */
async function ask<T>(store: Store, path: string, init: RequestInit = {}): Promise<{ body: T; headers: Headers }> {
  const bearer = session(store);
  const response = await fetch(`${API}${path}`, {
    ...init,
    exactTimeout: 20000,
    headers: {
      ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: unknown; message?: unknown };
  if (!response.ok) {
    const why = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : `The server answered ${response.status}.`;
    throw new Refused(response.status, why);
  }
  return { body, headers: response.headers };
}
const post = <T>(store: Store, path: string, body: unknown = {}) => ask<T>(store, path, { method: 'POST', body: JSON.stringify(body) });

/** A write's reply: a refusal in the server's words, a lost connection in ours. */
async function reply(write: () => Promise<unknown>): Promise<{ ok: boolean; error: string }> {
  try {
    await write();
    return { ok: true, error: '' };
  } catch (e) {
    if ((e as { code?: string }).code === 'bake') throw e; // no server at build
    if (e instanceof Refused) return { ok: false, error: e.message };
    return { ok: false, error: 'Can’t reach the server. Check your connection and try again.' };
  }
}

const SIGNED_OUT: Result<'loadSession'> = { signedIn: false, name: '', email: '' };
const NO_CHAT: Result<'followChat'> = { agentId: '', chatId: '', busy: false, lost: false, messages: [] };

type Block = Result<'followChat'>['messages'][number]['blocks'][number];

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

function chatOf(agentId: string, chatId: string, state: ChatState, lost: boolean): Result<'followChat'> {
  const messages = state.messages
    .map((message) => ({ id: message.id, role: message.role, status: message.status, error: message.error ?? message.notSent ?? '', blocks: blocksOf(message) }))
    .filter((message) => message.blocks.length > 0 || message.error !== '');
  return { agentId, chatId, busy: state.busy, lost, messages };
}

const sources: Sources = {
  loadSession: async (_args, store): Promise<Result<'loadSession'>> => {
    if (session(store) === null) return SIGNED_OUT;
    try {
      const { body } = await ask<{ user: { name: string; email: string } }>(store, '/api/me');
      return { signedIn: true, name: body.user.name, email: body.user.email };
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
  loadDoods: async ([signedIn], store): Promise<Result<'loadDoods'>> => {
    if (!signedIn) return [];
    const { body } = await ask<{ agents: AgentSummary[] }>(store, '/api/agents');
    return body.agents.map((agent) => ({
      id: agent.id,
      name: agent.name ?? 'New Dood',
      latest: agent.latest?.text ?? '',
      working: agent.working === true,
      asking: agent.asking === true,
    }));
  },
  hatchDood: (_args, store) => reply(() => post(store, '/api/agents')),
  openDood: async ([signedIn, agentId], store): Promise<Result<'openDood'>> => {
    if (!signedIn || agentId === '') return { agentId: '', chatId: '' };
    const { body } = await post<ChatSummary>(store, `/api/agents/${encodeURIComponent(agentId)}/chats/main`);
    return { agentId, chatId: body.id };
  },
  // An answer that keeps coming: the chat as it stands, then again after each event. On the web
  // the stream has to be asked for before anything is awaited, which reading the store allows.
  followChat: ([agentId, chatId], store): Result<'followChat'> | Promise<Result<'followChat'>> => {
    const bearer = session(store);
    if (agentId === '' || chatId === '' || bearer === null) return NO_CHAT;
    let state: ChatState = EMPTY_CHAT;
    let lost = false;
    return fetch(`${API}/api/agents/${encodeURIComponent(agentId)}/chats/${encodeURIComponent(chatId)}/events`, {
      headers: { authorization: `Bearer ${bearer}` },
      exactStream: (event): Result<'followChat'> => {
        if (event.type === 'error') {
          lost = true;
        } else if (typeof event.data === 'string') {
          const change = JSON.parse(event.data) as ChatEvent;
          // Events that were skipped cannot be made up for; a snapshot says where things stand anyway.
          if (change.type === 'snapshot') lost = false;
          else if (event.coalesced > 0) lost = true;
          state = reduceChat(state, change);
        }
        return chatOf(agentId, chatId, state, lost);
      },
    });
  },
  sendMessage: ([agentId, chatId, text, requestId], store) => reply(() =>
    post(store, `/api/agents/${encodeURIComponent(agentId)}/chats/${encodeURIComponent(chatId)}/messages`, { text, requestId })),
};
export const answer: Answer = (source, args, store, storage, native) => sources[source](args, store, storage, native);
