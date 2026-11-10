// The chat area: which chat is a Dood's main one, the chat as it stands and as it changes over
// the Dood's socket, what came before it, and what the Dood waits on someone for (leave to do
// something, a secret, a sign-in, a computer). data/chat-rows.ts makes the rows the view draws.
import type { Result, Sources } from '../app.contract.d.ts';
// What a chat is and how an event changes it, from the protocol the server and every other
// client share: types and one pure function, so nothing of the package's is run but that.
import { EMPTY_CHAT, reduceChat, type ChatHistoryPage, type ChatMessage, type ChatState } from '../protocol/chat.ts';
import type { ApprovalDecision, ChatSummary, ConnectorSummary, SecretRequest } from '../protocol/agent.ts';
import type { ComputerRequest } from '../protocol/daemon.ts';
import { LOGIN_PASSWORD, LOGIN_USERNAME, MAX_PASSWORD_CHARS, MAX_USERNAME_CHARS } from '../protocol/passwords.ts';
import { siteHost } from '../protocol/screen.ts';
import { digest, type AgentSocketMessage, type AgentSocketRequest } from '../protocol/socket.ts';
import { current, follow, get, NOBODY, post, reply, seg } from './api.ts';
import { activityOf, rowsOf, startsMidway, waitingRows } from './chat-rows.ts';

type Chat = Result<'followChat'>;

const NO_CHAT: Chat = {
  owner: NOBODY, agentId: '', chatId: '', busy: false, lost: false, messages: [],
  loaded: false, activity: '', midway: false, firstId: '', justDelivered: '', thought: '',
};

/** The user an owner is (data/api.ts `ownerOf`), whose own messages carry no name. */
const userOf = (owner: string) => owner.split('/')[0] ?? '';

/** The chats last followed, as they stood, so that one followed again is not empty until it is told. */
const held = new Map<string, ChatState>();
function hold(key: string, state: ChatState) {
  held.delete(key);
  held.set(key, state);
  if (held.size > 16) held.delete(held.keys().next().value!);
}

function chatOf(owner: string, agentId: string, chatId: string, state: ChatState, lost: boolean, loaded: boolean, justDelivered: string): Chat {
  const first = state.messages[0];
  return {
    owner, agentId, chatId, busy: state.busy, lost, loaded, justDelivered,
    messages: [...rowsOf(state, userOf(owner)), ...waitingRows(state)],
    activity: activityOf(state),
    midway: startsMidway(first),
    firstId: first?.id ?? '',
    thought: thoughtOf(state),
  };
}

/** The thinking of the Dood's newest message, not drawn but read by the transport's checks. */
function thoughtOf(state: ChatState): string {
  const last = state.messages.findLast((message) => message.role === 'assistant');
  return (last?.parts ?? []).flatMap((part) => (part.type === 'thinking' && part.written !== true ? [part.text] : [])).join('');
}

const textOf = (message: ChatMessage) => message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');

/**
 * The user's message that has just taken the place of an input that waited for the Dood: the
 * steer that is gone from the queue, now a message of the chat's with its words. It is said to
 * be delivered, for a moment (views/chat-rows.contract `Delivery`).
 */
function deliveredBy(before: ChatState, after: ChatState): string | undefined {
  const gone = before.queued.filter((input) => input.mode === 'steer' && !after.queued.some((still) => still.id === input.id));
  if (gone.length === 0) return undefined;
  const known = new Set(before.messages.map((message) => message.id));
  return after.messages.findLast((message) => message.role === 'user' && !known.has(message.id) && gone.some((input) => input.text === textOf(message)))?.id;
}

// Earlier pages of a chat, kept while the page is open, by the chat and the message it ran up to.
const earlierPages = new Map<string, { messages: ChatMessage[]; before: string | null }>();

const NO_EARLIER: Result<'loadEarlier'> = { owner: NOBODY, chatId: '', anchor: '', messages: [], more: false };

export const chatSources: Pick<Sources,
  'openChat' | 'followChat' | 'loadEarlier' | 'answerApproval' | 'loadSecretAsks' | 'answerSecret' | 'answerLogin' | 'declineSecret' |
  'loadSignIns' | 'signInConnector' | 'dismissConnector' | 'loadComputerAsks' | 'answerComputerAsk'
> = {
  // The Dood's main chat, which it is given the first time it is opened.
  openChat: async ([owner, agentId], store): Promise<Result<'openChat'>> => {
    if (agentId === '' || !current(owner, store)) return { owner: NOBODY, agentId: '', chatId: '' };
    const { body } = await post<ChatSummary>(store, `/api/agents/${seg(agentId)}/chats/main`);
    return { owner, agentId, chatId: body.id };
  },
  // The chat as it stands, then again after each change, over the Dood's socket, which carries
  // every change of each chat it is asked to follow, in order. When the socket ends the chat is
  // marked `lost`, and the view follows it again; meanwhile, and until the new socket's
  // snapshot, it shows what it had.
  followChat: ([owner, agentId, chatId], store): Chat | Promise<Chat> => {
    if (agentId === '' || chatId === '' || !current(owner, store)) return NO_CHAT;
    const key = `${owner} ${agentId} ${chatId}`;
    let state: ChatState = held.get(key) ?? EMPTY_CHAT;
    let lost = false;
    // A chat held from before is shown as it was until its snapshot: it was loaded then.
    let loaded = held.has(key);
    let justDelivered = '';
    const now = () => chatOf(owner, agentId, chatId, state, lost, loaded, justDelivered);
    const follow_ = { type: 'follow', chat: chatId } satisfies AgentSocketRequest;
    return follow<Chat, AgentSocketMessage>(store, `/api/agents/${seg(agentId)}/socket`, {
      open: (say) => {
        say(follow_);
        return now();
      },
      each: (message, say) => {
        if (message.type === 'chat' && message.chat === chatId) {
          const before = state;
          state = reduceChat(state, message.event);
          hold(key, state);
          // A snapshot on its first arrival says nothing of what was on its way: only one seen go is.
          if (loaded) justDelivered = deliveredBy(before, state) ?? justDelivered;
          if (message.event.type === 'snapshot') {
            loaded = true;
            lost = false;
          }
        } else if (message.type === 'resumed' && message.chats[chatId] !== digest(state)) {
          // The Dood was put away and is back with something other than what is here.
          say(follow_);
        } else if (message.type === 'gone' && message.chat === chatId) {
          lost = true;
        }
        return now();
      },
      lost: () => {
        lost = true;
        return now();
      },
      now,
    });
  },

  // What a summary or a fresh start moved out of the live transcript, `pages` pages of it, back
  // from `anchor`, the live transcript's first message. A page once had is kept.
  loadEarlier: async ([owner, agentId, chatId, anchor, pages], store): Promise<Result<'loadEarlier'>> => {
    if (pages <= 0 || anchor === '' || !current(owner, store)) return NO_EARLIER;
    let messages: ChatMessage[] = [];
    let before: string | null = anchor;
    for (let page = 0; page < pages && before !== null; page++) {
      const key = `${agentId}/${chatId}/${before}`;
      let got = earlierPages.get(key);
      if (got === undefined) {
        got = await get<ChatHistoryPage>(store, `/api/agents/${seg(agentId)}/chats/${seg(chatId)}/history?before=${encodeURIComponent(before)}`);
        earlierPages.set(key, got);
      }
      messages = [...got.messages, ...messages];
      before = got.before;
    }
    const state: ChatState = { ...EMPTY_CHAT, messages };
    return { owner, chatId, anchor, messages: rowsOf(state, userOf(owner)), more: before !== null };
  },

  answerApproval: ([agentId, requestId, decision, typed], store) => reply(() =>
    post(store, `/api/agents/${seg(agentId)}/approvals/${seg(requestId)}`, {
      decision: decision as ApprovalDecision,
      ...(typed === '' || decision === 'deny' ? {} : { typed }),
    })),

  // The secrets the Dood asked someone to type. A login only where the workspace keeps them.
  loadSecretAsks: async ([owner, agentId], store): Promise<Result<'loadSecretAsks'>> => {
    if (agentId === '' || !current(owner, store)) return { owner: NOBODY, agentId: '', asks: [] };
    const { requests } = await get<{ requests: SecretRequest[] }>(store, `/api/agents/${seg(agentId)}/secrets`);
    return {
      owner, agentId,
      asks: requests.map((request) => {
        const where = request.destination;
        return {
          id: request.id, chatId: request.chatId, purpose: request.purpose ?? '',
          subagent: request.subagent?.title ?? '', task: request.subagent?.task ?? '',
          kind: where.kind,
          // Where it goes: a file on a computer, a connector's host, or the site a login is for.
          name: where.kind === 'connector' ? where.name : where.kind === 'login' ? where.site : where.path,
          place: where.kind === 'connector' ? hostOf(where.url) : where.kind === 'dotenv' ? where.computer : '',
          fields: request.fields.map((field) => ({ name: field.name, description: field.description ?? '' })),
        };
      }),
    };
  },
  // The values in the order of the request's fields. Kept nowhere here.
  answerSecret: ([agentId, requestId, names, values], store) => reply(() =>
    post(store, `/api/agents/${seg(agentId)}/secrets/${seg(requestId)}`, {
      values: Object.fromEntries(names.map((name, index) => [name, values[index] ?? ''])),
    })),
  // A login for the site that asked, checked as every client checks it (protocol/passwords-typed.ts
  // `loginAnswer`, whose module reads the clock, which a data source may not import).
  answerLogin: async ([agentId, requestId, site, username, password], store) => {
    const name = username.trim();
    const problem = name === '' ? 'Type the username or email.' : name.length > MAX_USERNAME_CHARS ? 'That username is too long.'
      : password === '' ? 'Type the password.' : /[\r\n]/.test(password) ? 'A password has to be a single line.'
      : password.length > MAX_PASSWORD_CHARS ? 'That password is too long to save.' : '';
    if (problem !== '') return { ok: false, error: problem };
    const values = { [LOGIN_USERNAME]: name, [LOGIN_PASSWORD]: password };
    return reply(() => post(store, `/api/agents/${seg(agentId)}/secrets/${seg(requestId)}`, { values, sites: [siteHost(site) ?? site] }));
  },
  declineSecret: ([agentId, requestId], store) => reply(() => post(store, `/api/agents/${seg(agentId)}/secrets/${seg(requestId)}/decline`)),

  // Connectors the Dood added that wait for someone to sign in.
  loadSignIns: async ([owner, agentId], store): Promise<Result<'loadSignIns'>> => {
    if (agentId === '' || !current(owner, store)) return { owner: NOBODY, agentId: '', connectors: [] };
    const { connectors } = await get<{ connectors: ConnectorSummary[] }>(store, `/api/agents/${seg(agentId)}/connectors`);
    return {
      owner, agentId,
      connectors: connectors.filter((c) => c.status === 'needs_auth' && c.askedIn !== undefined).map((c) => ({ id: c.id, name: c.name, host: hostOf(c.url) })),
    };
  },
  // Where to go to sign in, which the view opens.
  signInConnector: async ([agentId, connectorId], store) => {
    let url = '';
    const done = await reply(async () => {
      const { body } = await post<{ authorizationUrl?: string }>(store, `/api/agents/${seg(agentId)}/connectors/${seg(connectorId)}/connect`);
      url = body.authorizationUrl ?? '';
    });
    return { ...done, url };
  },
  dismissConnector: ([agentId, connectorId], store) => reply(() => post(store, `/api/agents/${seg(agentId)}/connectors/${seg(connectorId)}/dismiss`)),

  // The computers the Dood asked to use, which the person's own list of asks holds.
  loadComputerAsks: async ([owner, agentId], store): Promise<Result<'loadComputerAsks'>> => {
    if (agentId === '' || !current(owner, store)) return { owner: NOBODY, agentId: '', asks: [] };
    const { requests } = await get<{ requests: ComputerRequest[] }>(store, '/api/computers/requests');
    return {
      owner, agentId,
      asks: requests.filter((request) => request.agentId === agentId).map((request) => ({
        id: request.id, computer: request.computer.name, workspaceId: request.computer.workspaceId, pairedBy: request.computer.pairedBy.name,
        readOnly: request.computer.readOnly, reason: request.reason, canAnswer: request.canAnswer,
      })),
    };
  },
  answerComputerAsk: ([requestId, approve], store) => reply(() => post(store, `/api/computers/requests/${seg(requestId)}`, { approve })),
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
