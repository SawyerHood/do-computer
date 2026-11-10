// A chat's state, as the server and `reduceChat` have it, made into the rows the transcript draws
// (views/chat.contract `MessageRow`). It decides what the React app's transcript decides
// (apps/web/src/components/chat/transcript.tsx): which messages show, how failures fold, what each
// part is drawn as, and the line that says what the Dood is doing. The stream itself is data/chat.ts.
import type { Result } from '../app.contract.d.ts';
import {
  chatActivity, chatUses, continuesMain, isAgentMessage, isJobStart, isPinning, isSentFile, isShownPart,
  isSiteShare, isSubagentStart, isUse, isVisual, pinned, sharedSite, useWords, type Use,
} from '../protocol/activity.ts';
import { sentWords, type ChatMessage, type ChatState, type MessagePart, type NoticePart, type ToolPart } from '../protocol/chat.ts';
import { describeChatError, foldFailures } from '../protocol/chat-error.ts';
import { isMcpApp, readMcpApp } from '../protocol/mcp-app.ts';
import { spanOf, jobOutcome } from '../protocol/jobs.ts';
import { callLength } from '../protocol/calls.ts';
import { INLINE_IMAGE_TYPES } from '../protocol/embed.ts';
import { pinTitle } from '../protocol/pins.ts';
import { visualThemeFragment } from '../protocol/visual.ts';
import type { LibraryFile } from '../protocol/agent.ts';
import { keptLine } from './chat-kept.ts';
import { API } from './api.ts';
import { sitePath } from '../protocol/sites.ts';

export type Row = Result<'followChat'>['messages'][number];
export type Block = Row['blocks'][number];

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const timeOf = (at: number | undefined) => (at === undefined ? '' : clock.format(at));

const BLANK: Block = {
  id: '', kind: '', text: '', name: '', after: '', status: '', detail: '', more: '', moreLabel: '', open: false,
  mono: false, chatId: '', agentId: '', linkLabel: '', path: '', fileId: '', src: '', outcome: '', going: false, lines: [],
};
const block = (id: string, kind: string, fields: Partial<Block>): Block => ({ ...BLANK, ...fields, id, kind });

/** A path of the library as it goes on the end of an address, a segment at a time. */
const pathUrl = (path: string) => path.split('/').map(encodeURIComponent).join('/');

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const firstLine = (text: string) => text.split('\n')[0] ?? text;
const lower = (words: string) => words.charAt(0).toLowerCase() + words.slice(1);

/** Whether a part is shown: what the protocol shows, and the one line kept of a sign-in or a payment. */
const isShown = (part: MessagePart) => isShownPart(part) || keptLine(part) !== undefined;

/** A use where it began: its window while it goes, and word of what was done after (uses.tsx). */
function useBlock(id: string, use: Use): Block {
  const count = use.steps.length;
  const [computer, rest] = use.what === 'screen' ? [useWords(use), ''] : ['a browser', ` on ${use.computer.name}`];
  const took = use.ms === undefined || use.ms < 1000 ? '' : ` for ${spanOf(use.ms)}`;
  const last = use.steps.at(-1);
  return block(id, 'use', {
    // The view puts the Dood's name in front: "Juniper used …".
    text: 'used',
    name: computer,
    after: `${rest}${took} · ${count} ${count === 1 ? 'step' : 'steps'}`,
    status: use.what,
    going: use.going,
    detail: last?.say ?? '',
    lines: use.steps.map((step, index) => `${index + 1}. ${step.say}`),
  });
}

/** One shown part of the Dood's message, as the transcript draws it (`AssistantPart`). */
function partBlock(part: MessagePart, id: string, uses: Map<string, Use>): Block | undefined {
  const kept = keptLine(part);
  if (kept !== undefined) return block(id, 'kept', { text: kept.words, status: kept.of, going: kept.going, outcome: kept.refused ? 'refused' : '' });
  if (part.type === 'tool') return toolBlock(part, id, uses);
  if (part.type === 'text') return part.text === '' ? undefined : block(id, 'text', { text: part.text });
  if (part.type === 'image') return block(id, 'image', { src: `data:${part.mimeType};base64,${part.data}` });
  // Heads the report of a scheduled task.
  if (part.type === 'notice' && part.kind === 'schedule') return block(id, 'schedule', { text: `Scheduled: ${part.text}` });
  return undefined;
}

function toolBlock(part: ToolPart, id: string, uses: Map<string, Use>): Block | undefined {
  // Each test names the part as any part, so that one that fails does not narrow the next.
  const any: MessagePart = part;
  if (isMcpApp(any as MessagePart)) {
    const app = readMcpApp(part.details);
    if (app === undefined) return undefined;
    return block(id, 'mcpApp', { name: app.app.connector, text: app.app.tool, fileId: app.app.id, outcome: app.app.border === false ? 'bare' : '' });
  }
  if (isSentFile(any as MessagePart)) {
    const file = part.details as unknown as LibraryFile;
    return block(id, 'file', {
      name: file.name, detail: formatBytes(file.size), fileId: file.id, path: pathUrl(file.path), text: file.path, status: file.contentType,
      outcome: INLINE_IMAGE_TYPES.has(file.contentType) ? 'picture' : '',
    });
  }
  if (isVisual(any as MessagePart)) {
    const file = part.details as unknown as LibraryFile;
    // Its colours ride on the address, as the React app's do: shown inline, in the device's light or dark.
    return block(id, 'visual', { name: file.name, fileId: file.id, path: `${pathUrl(file.path)}?v=${file.rev}${visualThemeFragment({ inline: true })}` });
  }
  if (isSiteShare(any as MessagePart)) {
    const site = sharedSite(part);
    return block(id, 'site', { name: site.title, path: site.path, fileId: site.id, detail: `${API}${sitePath(site.id)}`, outcome: site.public ? 'public' : 'workspace' });
  }
  if (isPinning(any as MessagePart)) {
    const { pin, file } = pinned(part);
    return block(id, 'pin', { name: pinTitle(pin, file), path: file.path, fileId: file.id, text: pin.title ?? '' });
  }
  if (isSubagentStart(any as MessagePart)) {
    const { chatId, title } = part.details as { chatId: string; title: string };
    return block(id, 'subagent', { name: title, chatId });
  }
  if (isJobStart(any as MessagePart)) {
    const args = part.args as { command?: string; run_in_background?: boolean } | null;
    const { job } = part.details as { job: string };
    // One the agent did not start this way was moved there when the wait for it ended.
    return block(id, 'command', { text: firstLine(args?.command ?? ''), detail: job, outcome: args?.run_in_background === true ? '' : 'moved' });
  }
  if (isAgentMessage(any as MessagePart)) {
    const { agentId, name: peer, chatId } = part.details as { agentId: string; name: string; chatId: string };
    return block(id, 'agentMessage', { name: peer, agentId, chatId });
  }
  if (isUse(any as MessagePart)) {
    // The other steps of a use are in the one thing shown where it began.
    const use = uses.get(part.toolCallId);
    return use === undefined ? undefined : useBlock(id, use);
  }
  return undefined;
}

/**
 * A notice message: a line with its mark, what it says, a way to the chat it is about, and more
 * folded under it. The line is `text`, `name` in bold, then `after`, which the view puts a space
 * before unless it starts with a comma or a colon.
 */
function noticeBlock(part: NoticePart | undefined, id: string): Block {
  if (part === undefined) return block(id, 'notice', { status: 'reset', text: 'New context' });
  const kind = part.kind;
  const by = part.by ?? 'Someone';
  switch (kind) {
    case 'subagent':
      return block(id, 'notice', {
        status: kind, chatId: part.chatId ?? '', linkLabel: 'Open its chat', outcome: part.outcome ?? '',
        text: part.outcome === 'stopped' ? 'You stopped' : '', name: part.text,
        after: part.outcome === 'stopped' ? '' : part.outcome === 'failed' ? 'did not finish' : 'reported back',
        more: part.detail ?? '', moreLabel: part.outcome === 'failed' ? 'What went wrong' : 'What it reported',
      });
    case 'agent':
      return block(id, 'notice', {
        status: kind, agentId: part.agentId ?? '', chatId: part.agentId === undefined ? '' : (part.chatId ?? ''), linkLabel: 'Open their conversation',
        name: part.text, outcome: part.outcome ?? '',
        after: part.outcome === 'stopped' ? 'was stopped before it answered' : part.outcome === 'failed' ? 'could not answer' : 'replied',
        more: part.detail ?? '', moreLabel: part.outcome === 'failed' ? 'What went wrong' : 'What it said', open: true,
      });
    case 'command': {
      const job = part.job;
      const stopped = job?.status === 'stopped';
      const well = job === undefined || job.status === 'done';
      return block(id, 'notice', {
        status: kind, outcome: stopped ? 'stopped' : well ? 'done' : 'failed', mono: true,
        text: stopped ? 'You stopped' : '', name: firstLine(part.text),
        after: `${stopped ? '' : job === undefined ? 'ended' : lower(jobOutcome(job))}${job?.computer ? ` on ${job.computer}` : ''}`,
        more: part.detail ?? '', moreLabel: well || stopped ? 'What it printed' : 'What went wrong',
      });
    }
    case 'computer':
      // The answer to the agent's asking to use a computer.
      return block(id, 'notice', { status: kind, text: `${by} ${part.approved ? 'said yes to' : 'said no to'} using`, name: part.text, mono: true, after: part.detail ? `, ${part.detail}` : '' });
    case 'secret': {
      // Which secrets, and where they went. Never what. A login is told in words.
      const login = part.text === '' ? /^(a login for) (\S+)$/.exec(part.detail ?? '') : null;
      const where = part.text === '' ? '' : part.approved ? `, saved to ${part.text}` : `for ${part.text}`;
      return block(id, 'notice', {
        status: kind, mono: login === null,
        text: `${by} ${part.approved ? 'gave' : 'chose not to give'}${login === null ? '' : ` ${login[1]}`}`,
        name: login === null ? (part.detail ?? '') : (login[2] ?? ''), after: where,
      });
    }
    case 'approval':
      return block(id, 'notice', { status: kind, text: `${by} ${part.approved ? 'allowed' : 'said no to'}`, name: part.text });
    case 'connector':
      return block(id, 'notice', { status: kind, text: `${by} ${part.approved ? 'connected' : 'did not connect'}`, name: part.text, after: part.detail ? `: ${part.detail}` : '' });
    case 'automation':
      return block(id, 'notice', {
        status: kind, text: 'The automation', name: part.text, after: part.outcome === 'failed' ? 'did not finish' : 'reported',
        chatId: part.chatId ?? '', linkLabel: 'View run', more: part.detail ?? '', moreLabel: part.outcome === 'failed' ? 'What went wrong' : 'What it said', open: true,
      });
    case 'asked':
      return block(id, 'notice', { status: kind, text: 'The sub-agent', name: part.text, after: `asked for ${part.detail ?? 'something'}`, chatId: part.chatId ?? '', linkLabel: 'Open its chat' });
    case 'slack':
      return block(id, 'notice', {
        status: kind, text: 'A thread in Slack,', name: part.text, after: ', told it something', chatId: part.chatId ?? '', linkLabel: 'Open thread',
        more: part.detail ?? '', moreLabel: 'What it said', open: true,
      });
    case 'call': {
      const call = part.call;
      return block(id, 'notice', {
        status: kind, text: call === undefined ? '' : callLength(call.seconds), lines: call?.summary ?? [], detail: call?.id ?? '', chatId: call?.chatId ?? '',
        more: (call?.lines ?? []).map((line) => `${line.who === 'you' ? 'You' : 'Dood'}: ${line.text}`).join('\n'),
      });
    }
    case 'compaction':
      return block(id, 'notice', { status: kind, text: 'Earlier messages were summarized' });
    case 'branch':
      // The server says how much of the main chat it carries.
      return block(id, 'notice', { status: kind, text: part.text || 'Continues from the main chat' });
    default:
      return block(id, 'notice', { status: 'reset', text: 'New context' });
  }
}

const BLANK_ROW: Omit<Row, 'id' | 'role' | 'status' | 'blocks'> = {
  error: '', from: '', author: '', authorId: '', time: '', spoken: false, answered: false, delivery: '', files: [], notSent: '', failures: 0,
  errorTitle: '', errorHint: '', errorDetail: '', errorFacts: [], errorKind: '', retryable: false, stopped: false,
};

/** A message someone wrote: its words without the line naming its files, its pictures, and who it is from where that is not "you". */
function userRow(message: ChatMessage, me: string): Row {
  const pictures = message.parts.some((part) => part.type === 'image');
  const blocks: Block[] = [];
  let files: string[] = [];
  let words = '';
  message.parts.forEach((part, index) => {
    if (part.type === 'text') {
      const shown = sentWords(part.text, pictures);
      words += part.text;
      files = files.concat(shown.files);
      if (shown.text !== '') blocks.push(block(String(index), 'text', { text: shown.text }));
    } else if (part.type === 'image') {
      blocks.push(block(String(index), 'image', { src: `data:${part.mimeType};base64,${part.data}` }));
    }
  });
  const other = message.author !== undefined && message.author.id !== me;
  const from = message.agent !== undefined ? 'agent' : message.slack !== undefined ? 'slack' : other ? 'person' : '';
  const author = message.agent?.name ?? message.slack?.name ?? (other ? (message.author?.name ?? '') : '');
  const authorId = message.agent?.id ?? (other ? (message.author?.id ?? '') : '');
  return {
    ...BLANK_ROW, id: message.id, role: 'user', status: message.status, blocks, files, from, author, authorId,
    time: from === '' ? '' : timeOf(message.createdAt), spoken: message.spoken !== undefined,
    // In a sub-agent's chat, the person's answer to something it asked leave for.
    answered: /^(Approved|Not allowed): /.test(words),
  };
}

function assistantRow(message: ChatMessage, failures: number, uses: Map<string, Use>): Row {
  const shown = message.parts.filter(isShown);
  const blocks: Block[] = [];
  shown.forEach((part, index) => {
    // A site shared and then opened up in one answer is one card, which says how it stands.
    if (isSiteShare(part) && shown.slice(0, index).some((earlier) => isSiteShare(earlier) && sharedSite(earlier).id === sharedSite(part).id)) return;
    const id = part.type === 'tool' ? part.toolCallId : String(message.parts.indexOf(part));
    const made = partBlock(part, id, uses);
    if (made !== undefined) blocks.push(made);
  });
  const row: Row = { ...BLANK_ROW, id: message.id, role: 'assistant', status: message.status, error: message.error ?? '', blocks, notSent: message.notSent ?? '', failures, stopped: message.status === 'aborted' };
  if (message.status === 'error') {
    const view = describeChatError(message.error);
    row.errorKind = view.kind;
    row.errorTitle = view.title;
    row.errorHint = [failures > 1 ? `Tried ${failures} times.` : undefined, view.hint].filter((text) => text !== undefined).join(' ');
    row.errorDetail = view.detail ?? '';
    row.errorFacts = view.facts;
    row.retryable = view.retryable;
  }
  return row;
}

/**
 * The rows of a chat: the messages that show anything, failures that follow one another folded
 * into the last, and each made into what the view draws. `me` is the user signed in, whose own
 * messages carry no name.
 */
export function rowsOf(state: ChatState, me: string): Row[] {
  const uses = new Map(chatUses(state).map((use) => [use.id, use]));
  // A message whose every shown part is a later step of a use shows nothing, and leaves no gap.
  const shows = (message: ChatMessage) =>
    message.notSent !== undefined || message.role !== 'assistant' || message.status === 'error' || message.status === 'aborted' ||
    message.parts.some((part) => isShown(part) && (!isUse(part) || uses.has(part.toolCallId)));
  // An old side chat that continues the main one opens with the mark of where its own begin;
  // until something is said in it, it is as empty as any new chat.
  const untouched = state.messages.length === (continuesMain(state.messages) ? 1 : 0);
  const shown = foldFailures((untouched ? [] : state.messages).filter(shows), state.busy);
  const rows = shown.map(({ message, failures }): Row => {
    if (message.role === 'notice') {
      const first = message.parts[0];
      return { ...BLANK_ROW, id: message.id, role: 'notice', status: message.status, time: timeOf(message.createdAt), blocks: [noticeBlock(first?.type === 'notice' ? first : undefined, '0')] };
    }
    if (message.role === 'user') return userRow(message, me);
    return assistantRow(message, failures, uses);
  });
  return rows;
}

/**
 * What the Dood is doing, as one line under the transcript, or "" when there is nothing to say:
 * idle, its answer being written on screen, or a step on a screen or a sign-in under way, which
 * say so themselves.
 */
export function activityOf(state: ChatState): string {
  const activity = chatActivity(state);
  if (activity === null) return '';
  const stepping = chatUses(state).some((use) => {
    const status = use.steps.at(-1)?.status;
    return status === 'pending' || status === 'running';
  });
  const signingIn = state.messages.at(-1)?.parts.some((part) => part.type === 'tool' && (part.status === 'pending' || part.status === 'running') && keptLine(part) !== undefined) === true;
  return stepping || signingIn ? '' : activity;
}

/**
 * The inputs the Dood has not been given yet, as messages of the user's marked as on their way:
 * those that join the work under way (`steer`). What the server lined up for its next turn was
 * written by nobody here (apps/web/src/lib/sending.ts `settleSends`).
 */
export function waitingRows(state: ChatState): Row[] {
  return state.queued
    .filter((input) => input.mode === 'steer')
    .map((input) => ({
      ...BLANK_ROW, id: `queued:${input.id}`, role: 'user', status: 'done', delivery: 'sent',
      blocks: [block('0', 'text', { text: sentWords(input.text, false).text })], files: sentWords(input.text, false).files,
    }));
}

/** Whether a chat begins after a summary or a fresh start, and so has messages before it to load. */
export const startsMidway = (first: ChatMessage | undefined) => first?.role === 'notice' && !continuesMain([first]);
