// A Dood's settings: who it is and what it remembers (its state), what it can think with (the
// models of its workspace), the computers it can work on, its voice, what it has spent, and
// what it may do without asking. As apps/web/src/components/settings/profile.tsx and
// permissions.tsx ask for them.
import type { Result, Sources } from '../app.contract.d.ts';
import type { AgentSummary, AgentUsage, ApprovalRule, ApprovalsState, ChatSummary, ComputerKinds, ModelOption, ThinkingLevel } from '../protocol/agent.ts';
import { AVATAR_COLORS, defaultAvatar } from '../protocol/avatars.ts';
import type { CallsState } from '../protocol/calls.ts';
import { PAIRED_COMPUTER, type ComputerSummary } from '../protocol/daemon.ts';
import { current, del, get, NOBODY, patch, post, reply, seg } from './api.ts';

// What the server answers for a Dood (packages/client AgentState), as much of it as is read here.
type AgentState = {
  agent: AgentSummary;
  team?: string | null;
  soul: string;
  user: string;
  memory: string;
  limits: { memory: number; user: number };
  chats: ChatSummary[];
};

type Setup = Result<'loadDoodSetup'>;
const NO_FORM = { name: '', tagline: '', color: '', seed: '', soul: '', user: '', memory: '', model: '', thinking: '' };
const NO_SETUP: Setup = { owner: NOBODY, agentId: '', named: '', hatched: false, team: '', memoryLimit: 0, userLimit: 0, mainChatId: '', form: NO_FORM };

/** A cost in dollars, small ones with their cents' cents (profile.tsx `dollars`). */
export const dollars = (cost: number) => (cost === 0 ? '$0' : cost < 0.01 ? 'under $0.01' : `$${cost.toFixed(cost < 10 ? 2 : 0)}`);
const tokens = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

const perMillion = (cost: number) => (cost === 0 ? 'free' : `$${cost < 1 ? cost.toFixed(2) : cost.toFixed(cost < 10 ? 1 : 0)}`);
const context = (n: number | undefined) => (n === undefined ? '' : n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M context` : `${Math.round(n / 1000)}K context`);

/** What a model costs and can hold, in one line (model-picker.tsx `facts`). */
export function facts(model: ModelOption): string {
  return [
    model.signIn?.subscription ? 'on the subscription' : model.inputCost === 0 && model.outputCost === 0 ? 'free' : `${perMillion(model.inputCost)} in, ${perMillion(model.outputCost)} out per million tokens`,
    context(model.contextWindow),
  ].filter(Boolean).join(' · ');
}

/**
 * Where a model comes from, as the picker heads its group: the deployment's own, else a
 * provider the workspace signed in to, with a subscription or a key (model-picker.tsx
 * `bySource`). "" where every model comes from one place, which then needs no heading.
 */
export function sourcesOf(models: readonly ModelOption[]): string[] {
  const key = (m: ModelOption) => (m.signIn === undefined ? 'own' : `${m.provider ?? ''}/${m.signIn.subscription ? 'subscription' : 'key'}`);
  const groups = new Map<string, ModelOption[]>();
  for (const m of models) groups.set(key(m), [...(groups.get(key(m)) ?? []), m]);
  if (groups.size < 2) return models.map(() => '');
  const name = (k: string, items: ModelOption[]) => {
    if (k === 'own') return ['Do Computer', ...new Set(items.map((m) => m.provider).filter(Boolean))].join(' · ');
    const first = items[0]!;
    const { subscription, by } = first.signIn!;
    return `${first.provider ?? ''} ${subscription ? 'subscription' : 'key'}${by === null ? '' : ` · signed in by ${by}`}`;
  };
  const names = new Map([...groups].map(([k, items]) => [k, name(k, items)]));
  return models.map((m) => names.get(key(m))!);
}

/** The models in the order the picker lists them: the workspace's own sign-ins first, the deployment's last. */
export function choicesOf(models: readonly ModelOption[]): Result<'loadModelChoices'>['models'] {
  const ordered = [...models.filter((m) => m.signIn !== undefined), ...models.filter((m) => m.signIn === undefined)];
  const sources = sourcesOf(ordered);
  return ordered.map((m, i) => ({
    id: m.id,
    name: m.name,
    detail: facts(m),
    source: sources[i]!,
    recommended: m.recommended === true,
    thinking: [...(m.thinking ?? [])],
  }));
}

type Approvals = Result<'loadApprovals'>;

export const doodSettingsSources: Pick<Sources,
  'loadDoodSetup' | 'loadModelChoices' | 'loadDoodComputers' | 'loadDoodVoice' | 'loadDoodUsage' | 'loadApprovals'
  | 'saveDood' | 'setDoodVoice' | 'moveDood' | 'deleteDood' | 'startFresh' | 'setApproval'> = {
  loadDoodSetup: async ([owner, agentId], store): Promise<Setup> => {
    if (agentId === '' || !current(owner, store)) return NO_SETUP;
    const state = await get<AgentState>(store, `/api/agents/${seg(agentId)}`);
    const avatar = state.agent.avatar ?? defaultAvatar(agentId);
    const main = state.chats.find((chat) => chat.main === true);
    return {
      owner,
      agentId,
      named: state.agent.name ?? '',
      hatched: state.agent.hatched,
      team: state.team ?? '',
      memoryLimit: state.limits.memory,
      userLimit: state.limits.user,
      mainChatId: main?.id ?? '',
      form: {
        name: state.agent.name ?? '',
        tagline: state.agent.tagline ?? '',
        color: avatar.color,
        seed: avatar.seed ?? '',
        soul: state.soul,
        user: state.user,
        memory: state.memory,
        model: state.agent.model,
        thinking: state.agent.thinking,
      },
    };
  },
  // What a workspace's Doods can be set to; with no workspace, every model the person could choose somewhere.
  loadModelChoices: async ([owner, workspaceId, asked], store): Promise<Result<'loadModelChoices'>> => {
    if (!asked || !current(owner, store)) return { owner: NOBODY, workspaceId: '', models: [] };
    const { models } = await get<{ models: ModelOption[] }>(store, workspaceId === '' ? '/api/models' : `/api/models?workspaceId=${seg(workspaceId)}`);
    return { owner, workspaceId, models: choicesOf(models) };
  },
  loadDoodComputers: async ([owner, agentId], store): Promise<Result<'loadDoodComputers'>> => {
    if (agentId === '' || !current(owner, store)) return { owner: NOBODY, agentId: '', usable: [], alone: [] };
    const [{ computers }, kinds] = await Promise.all([
      get<{ computers: ComputerSummary[] }>(store, '/api/computers'),
      get<ComputerKinds>(store, '/api/computer-kinds'),
    ]);
    return {
      owner,
      agentId,
      usable: computers.filter((c) => c.agentIds.includes(agentId)).map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind === PAIRED_COMPUTER ? 'paired' : (kinds.kinds.find((k) => k.id === c.kind)?.label ?? c.kind),
        folder: c.folders.find((f) => f.agentId === agentId)?.path ?? '',
      })),
      // Machines no other Dood can use, which nothing would work on once this one is gone.
      alone: computers.filter((c) => c.kind !== PAIRED_COMPUTER && c.access === 'chosen' && c.agentIds.length === 1 && c.agentIds[0] === agentId).map((c) => c.name),
    };
  },
  loadDoodVoice: async ([owner, agentId], store): Promise<Result<'loadDoodVoice'>> => {
    if (agentId === '' || !current(owner, store)) return { owner: NOBODY, agentId: '', available: false, voices: [], voice: '' };
    const calls = await get<CallsState>(store, `/api/agents/${seg(agentId)}/calls`);
    return { owner, agentId, available: calls.available, voices: calls.voices, voice: calls.voice ?? '' };
  },
  loadDoodUsage: async ([owner, agentId], store): Promise<Result<'loadDoodUsage'>> => {
    if (agentId === '' || !current(owner, store)) return { owner: NOBODY, agentId: '', used: false, cost: '', read: '', written: '', models: [], scheduled: '' };
    const usage = await get<AgentUsage>(store, `/api/agents/${seg(agentId)}/usage`);
    const { total, scheduled } = usage;
    return {
      owner,
      agentId,
      used: total.inputTokens + total.outputTokens > 0,
      cost: dollars(total.cost),
      read: tokens.format(total.inputTokens),
      written: tokens.format(total.outputTokens),
      models: usage.models.map((m) => ({ model: m.model, tokens: tokens.format(m.inputTokens + m.outputTokens), cost: dollars(m.cost) })),
      scheduled: scheduled.inputTokens + scheduled.outputTokens > 0
        ? `Scheduled runs account for ${dollars(scheduled.cost)} of the cost and ${tokens.format(scheduled.inputTokens + scheduled.outputTokens)} of the tokens.`
        : '',
    };
  },
  loadApprovals: async ([owner, agentId], store): Promise<Approvals> => {
    if (agentId === '' || !current(owner, store)) return { owner: NOBODY, agentId: '', subjects: [], pending: [] };
    const state = await get<ApprovalsState>(store, `/api/agents/${seg(agentId)}/approvals`);
    return {
      owner,
      agentId,
      subjects: state.subjects.map((s) => ({ id: s.id, kind: s.kind, label: s.label, hint: s.hint ?? '', rule: state.rules[s.id] ?? 'allow' })),
      // What it waits for someone to allow, which every chat of it shows over the composer.
      pending: state.pending.map((request) => ({
        id: request.id, chatId: request.chatId, chatTitle: request.chatTitle, chatKind: request.chatKind, task: request.task ?? '',
        title: request.title, detail: request.detail, onceOnly: request.onceOnly === true, wants: request.wants?.label ?? '',
      })),
    };
  },

  // A name left empty is not sent, so it keeps the one it has (profile.tsx `submit`).
  saveDood: ([agentId, form], store) => reply(() => patch(store, `/api/agents/${seg(agentId)}`, {
    ...(form.name.trim() === '' ? {} : { name: form.name.trim() }),
    tagline: form.tagline,
    avatar: { color: AVATAR_COLORS.some((c) => c.id === form.color) ? form.color : defaultAvatar(agentId).color, ...(form.seed === '' ? {} : { seed: form.seed }) },
    soul: form.soul,
    user: form.user,
    memory: form.memory,
    model: form.model,
    thinking: form.thinking as ThinkingLevel,
  })),
  setDoodVoice: ([agentId, voice], store) => reply(() => patch(store, `/api/agents/${seg(agentId)}`, { voice })),
  moveDood: ([agentId, workspaceId], store) => reply(() => post(store, `/api/agents/${seg(agentId)}/move`, { workspaceId })),
  deleteDood: ([agentId, keepComputers], store) => reply(() => del(store, `/api/agents/${seg(agentId)}${keepComputers ? '?computers=keep' : ''}`)),
  startFresh: ([agentId, chatId], store) => reply(() => post(store, `/api/agents/${seg(agentId)}/chats/${seg(chatId)}/reset`)),
  setApproval: ([agentId, subjectId, rule], store) => reply(() => patch(store, `/api/agents/${seg(agentId)}/approvals/rules`, { [subjectId]: rule as ApprovalRule })),
};
