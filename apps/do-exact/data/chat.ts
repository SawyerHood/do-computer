// The chat area: which chat is a Dood's main one, the chat as it stands and as it changes, what
// came before it, saying something in it, stopping it, and what the Dood waits on someone for
// (leave to do something, a secret, a sign-in). data/chat-rows.ts makes the rows the view draws.
import type { Result, Sources } from '../app.contract.d.ts';
// What a chat is and how an event changes it, from the protocol the server and every other
// client share: types and one pure function, so nothing of the package's is run but that.
import { EMPTY_CHAT, reduceChat, type ChatEvent, type ChatHistoryPage, type ChatMessage, type ChatState } from '../protocol/chat.ts';
import type { AgentEvent, AgentSummary, ApprovalDecision, ApprovalsState, ChatSummary, ConnectorSummary, LibraryListing, SecretRequest } from '../protocol/agent.ts';
import { LOGIN_PASSWORD, LOGIN_USERNAME, MAX_PASSWORD_CHARS, MAX_USERNAME_CHARS } from '../protocol/passwords.ts';
import { siteHost } from '../protocol/screen.ts';
import { API, current, follow, get, NOBODY, post, reply, seg } from './api.ts';
import { activityOf, rowsOf, startsMidway, waitingRows } from './chat-rows.ts';

type Chat = Result<'followChat'>;

const NO_CHAT: Chat = {
  owner: NOBODY, agentId: '', chatId: '', busy: false, lost: false, messages: [],
  loaded: false, activity: '', midway: false, firstId: '', justDelivered: '',
};

/** The user an owner is (data/api.ts `ownerOf`), whose own messages carry no name. */
const userOf = (owner: string) => owner.split('/')[0] ?? '';

function chatOf(owner: string, agentId: string, chatId: string, state: ChatState, lost: boolean, loaded: boolean, justDelivered: string): Chat {
  const first = state.messages[0];
  return {
    owner, agentId, chatId, busy: state.busy, lost, loaded, justDelivered,
    messages: [...rowsOf(state, userOf(owner)), ...waitingRows(state)],
    activity: activityOf(state),
    midway: startsMidway(first),
    firstId: first?.id ?? '',
  };
}

const textOf = (message: ChatMessage) => message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');

/**
 * The user's message that has just taken the place of an input that waited for the Dood: the
 * steer that is gone from the queue, now a message of the chat's with its words. It is said to
 * be delivered, for a moment (views/chat.contract `Delivery`).
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

// What a Dood's chats are: the open chat's kind (a sub-agent's, a conversation with another
// Dood, a thread in Slack, an old side chat) and how each sub-agent is getting on.
type ChatInfo = Result<'loadChatContext'>['chats'][number];
function chatInfo(chat: ChatSummary): ChatInfo {
  const where = chat.slack === undefined ? '' : chat.slack.direct ? 'a direct message' : chat.slack.channel === null ? 'Slack' : `#${chat.slack.channel}`;
  return {
    id: chat.id, title: chat.title, kind: chat.kind, main: chat.main === true, status: chat.status ?? '', parentId: chat.parentId ?? '',
    createdAt: chat.createdAt, peerAgentId: chat.peer?.agentId ?? '', peerName: chat.peer?.name ?? '', peerChatId: chat.peer?.chatId ?? '',
    slackWhere: where, slackUrl: chat.slack?.url ?? '',
  };
}

const NO_ASKS: Result<'followAsks'> = { agentId: '', approvals: 0, secrets: 0, chats: 0, connectors: 0, library: 0, lost: false };

export const chatSources: Pick<Sources,
  'openChat' | 'followChat' | 'sendMessage' | 'stopChat' | 'loadEarlier' | 'loadChatContext' | 'followAsks' | 'loadApprovals' | 'answerApproval' |
  'loadSecretAsks' | 'answerSecret' | 'answerLogin' | 'declineSecret' | 'loadSignIns' | 'signInConnector' | 'dismissConnector' | 'loadLibraryView'
> = {
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
    let loaded = false;
    let justDelivered = '';
    const now = () => chatOf(owner, agentId, chatId, state, lost, loaded, justDelivered);
    return follow<Chat, ChatEvent>(store, `/api/agents/${seg(agentId)}/chats/${seg(chatId)}/events`, {
      each: (change, skipped) => {
        // Events that were skipped cannot be made up for; a snapshot says where things stand anyway.
        if (change.type === 'snapshot') lost = false;
        else if (skipped) lost = true;
        const before = state;
        state = reduceChat(state, change);
        // A snapshot on its first arrival says nothing of what was on its way: only one seen go is.
        if (loaded) justDelivered = deliveredBy(before, state) ?? justDelivered;
        if (change.type === 'snapshot') loaded = true;
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
  // Stop what the Dood is doing in a chat: its own, or a sub-agent's.
  stopChat: ([agentId, chatId], store) => reply(() => post(store, `/api/agents/${seg(agentId)}/chats/${seg(chatId)}/abort`)),

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

  // The Dood and its chats, from its state: what kind of chat is open, and its sub-agents.
  loadChatContext: async ([owner, agentId], store): Promise<Result<'loadChatContext'>> => {
    if (agentId === '' || !current(owner, store)) return { owner: NOBODY, agentId: '', name: '', tagline: '', chats: [] };
    const state = await get<{ agent: AgentSummary; chats: ChatSummary[] }>(store, `/api/agents/${seg(agentId)}`);
    return { owner, agentId, name: state.agent.name ?? '', tagline: state.agent.tagline ?? '', chats: state.chats.map(chatInfo) };
  },

  // The open Dood's event stream, counted by what changed: each count asks again for what it is
  // about. The shell follows the same stream for the sidebar (data/shell.ts `followDood`).
  followAsks: ([owner, agentId], store): Result<'followAsks'> | Promise<Result<'followAsks'>> => {
    if (agentId === '' || !current(owner, store)) return NO_ASKS;
    const counts = { approvals: 0, secrets: 0, chats: 0, connectors: 0, library: 0 };
    let lost = false;
    const now = () => ({ agentId, ...counts, lost });
    return follow<Result<'followAsks'>, AgentEvent>(store, `/api/agents/${seg(agentId)}/events`, {
      each: (event) => {
        // `ready` is each connection's first word: whatever was asked before may be behind.
        if (event.type === 'ready') for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key]++;
        else if (event.what === 'approvals') counts.approvals++;
        else if (event.what === 'secrets') { counts.secrets++; counts.connectors++; }
        else if (event.what === 'connectors') { counts.connectors++; counts.approvals++; }
        else if (event.what === 'computers') counts.approvals++;
        else if (event.what === 'chats' || event.what === 'identity') counts.chats++;
        else if (event.what === 'library') counts.library++;
        return now();
      },
      lost: () => {
        lost = true;
        return now();
      },
      now,
    });
  },

  // What the Dood waits for someone to allow, in every chat of it.
  loadApprovals: async ([owner, agentId], store): Promise<Result<'loadApprovals'>> => {
    if (agentId === '' || !current(owner, store)) return { owner: NOBODY, agentId: '', pending: [] };
    const state = await get<ApprovalsState>(store, `/api/agents/${seg(agentId)}/approvals`);
    return {
      owner, agentId,
      pending: state.pending.map((request) => ({
        id: request.id, chatId: request.chatId, chatTitle: request.chatTitle, chatKind: request.chatKind, task: request.task ?? '',
        title: request.title, detail: request.detail, onceOnly: request.onceOnly === true, wants: request.wants?.label ?? '',
      })),
    };
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

  // Where the Dood's library files are served as what they are, with no session: the address a
  // visual, a picture or a download is had from (`/d/<agent>/<view>/<path>`).
  loadLibraryView: async ([owner, agentId], store): Promise<Result<'loadLibraryView'>> => {
    if (agentId === '' || !current(owner, store)) return { owner: NOBODY, agentId: '', base: '', files: [] };
    const listing = await get<LibraryListing>(store, `/api/agents/${seg(agentId)}/library`);
    return { owner, agentId, base: `${API}/d/${seg(agentId)}/${seg(listing.view)}/`, files: listing.files.map((file) => file.id) };
  },
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
