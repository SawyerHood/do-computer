// The person's own settings: the defaults their new Doods start with, whether they look after
// the deployment, and the two lists everything else is reached through (every Dood they can set
// up, every workspace they are in). As apps/web/src/components/settings/general.tsx and lists.tsx
// ask for them.
import type { Result, Sources } from '../app.contract.d.ts';
import type { AgentSummary, ComputerKinds, ModelOption, UserSettings } from '../protocol/agent.ts';
import type { ComputerSummary } from '../protocol/daemon.ts';
import { avatarLook } from '../protocol/avatars.ts';
import { workspaceColor, type WorkspacesState } from '../protocol/workspace.ts';
import { current, get, NOBODY, patch, reply } from './api.ts';

type Me = { user: { id: string }; admin?: boolean; signup?: string };

const count = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

export const accountSettingsSources: Pick<Sources, 'loadAccountSettings' | 'loadDoodsAbout' | 'loadWorkspacesAbout' | 'saveDefaultModel' | 'saveDefaultComputer'> = {
  loadAccountSettings: async ([owner], store): Promise<Result<'loadAccountSettings'>> => {
    if (!current(owner, store)) {
      return { owner: NOBODY, defaultModel: '', deploymentDefaultModel: '', defaultComputer: '', deploymentDefaultComputer: '', kinds: [], admin: false, waitlist: false };
    }
    const [settings, kinds, me] = await Promise.all([
      get<UserSettings>(store, '/api/settings'),
      get<ComputerKinds>(store, '/api/computer-kinds'),
      get<Me>(store, '/api/me'),
    ]);
    return {
      owner,
      defaultModel: settings.defaultModel ?? '',
      deploymentDefaultModel: settings.deploymentDefaultModel,
      defaultComputer: settings.defaultComputer ?? '',
      deploymentDefaultComputer: settings.deploymentDefaultComputer,
      kinds: kinds.kinds.map((k) => ({ id: k.id, label: k.label, description: k.description })),
      admin: me.admin === true,
      waitlist: me.signup === 'waitlist',
    };
  },
  // Every Dood under its workspace, with what it thinks with and where it works in a few words
  // (lists.tsx `AgentsList`'s `about`).
  loadDoodsAbout: async ([owner, asked], store): Promise<Result<'loadDoodsAbout'>> => {
    if (!asked || !current(owner, store)) return { owner: NOBODY, groups: [] };
    const [{ agents }, { models }, { computers }, state] = await Promise.all([
      get<{ agents: AgentSummary[] }>(store, '/api/agents'),
      get<{ models: ModelOption[] }>(store, '/api/models'),
      get<{ computers: ComputerSummary[] }>(store, '/api/computers'),
      get<WorkspacesState>(store, '/api/workspaces'),
    ]);
    const about = (agent: AgentSummary) => {
      const model = models.find((m) => m.id === agent.model)?.name ?? agent.model.split('/').at(-1)!;
      const on = computers.filter((c) => c.agentIds.includes(agent.id)).map((c) => c.name);
      return [model, ...(on.length > 2 ? [count(on.length, 'computer', 'computers')] : on)].join(' · ');
    };
    return {
      owner,
      groups: state.workspaces.map((w) => ({
        workspaceId: w.id,
        name: w.name,
        doods: agents.filter((a) => a.workspaceId === w.id).map((a) => {
          const look = avatarLook(a.avatar, a.id);
          return { id: a.id, name: a.name ?? 'New Dood', seed: look.seed, color: look.color, about: about(a) };
        }),
      })),
    };
  },
  loadWorkspacesAbout: async ([owner, asked], store): Promise<Result<'loadWorkspacesAbout'>> => {
    if (!asked || !current(owner, store)) return { owner: NOBODY, workspaces: [], invitations: [] };
    const [state, { agents }] = await Promise.all([
      get<WorkspacesState>(store, '/api/workspaces'),
      get<{ agents: AgentSummary[] }>(store, '/api/agents'),
    ]);
    return {
      owner,
      workspaces: state.workspaces.map((w) => {
        const has = count(agents.filter((a) => a.workspaceId === w.id).length, 'Dood', 'Doods');
        return {
          id: w.id,
          about: w.kind === 'team' ? `${count(w.members.length, 'person', 'people')} · ${has}` : `Only you · ${has}`,
          secrets: w.savedLogins === true || w.savedCards === true,
          logins: w.savedLogins === true,
          cards: w.savedCards === true,
        };
      }),
      invitations: state.invitations.map((i) => ({ id: i.id, name: i.workspace.name, color: workspaceColor(i.workspace.color), from: i.invitedBy.name })),
    };
  },
  // "" goes back to the deployment's own.
  saveDefaultModel: ([model], store) => reply(() => patch(store, '/api/settings', { defaultModel: model === '' ? null : model })),
  saveDefaultComputer: ([kind], store) => reply(() => patch(store, '/api/settings', { defaultComputer: kind === '' ? null : kind })),
};

