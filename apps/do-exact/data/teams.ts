import type { Result, Sources } from '../app.contract.d.ts';
import type { WorkspacesState, WorkspaceSummary, Invitation, InvitationPreview, SentInvitation, InviteResult } from '../protocol/workspace.ts';
import { WORKSPACE_COLORS, workspaceColor } from '../protocol/workspace.ts';
import { current, get, post, patch, put, del, reply, seg, NOBODY, Refused } from './api.ts';
import { avatarLook } from '../protocol/avatars.ts';
import { initialsOf } from './session.ts';

const base = (id: string) => `/api/workspaces/${seg(id)}`;
const who = (text: string) => [...new Set(text.split(/[\s,;]+/).filter(Boolean))];
const member = (m: WorkspaceSummary['members'][number]) => ({ id: m.id, name: m.name, email: m.email, image: m.image ?? '', initials: initialsOf(m.name), role: m.role });
const team = (w: WorkspaceSummary) => ({ id: w.id, name: w.name, color: workspaceColor(w.color), kind: w.kind, role: w.role, members: w.members.map(member) });
const preview = (i: InvitationPreview) => ({ id: i.id, workspaceId: i.workspace.id, name: i.workspace.name, color: workspaceColor(i.workspace.color), inviter: i.invitedBy.name, note: i.note ?? '', role: i.role, people: i.members.map(m => m.name).join(', '), doods: i.agents.map(a => ({ id: a.id, name: a.name ?? 'New Dood', seed: avatarLook(a.avatar, a.id).seed, color: avatarLook(a.avatar, a.id).color })) });
const sent = (i: SentInvitation) => ({ id: i.id, who: i.email ?? `@${i.githubLogin}`, link: `/invite/${i.link.split('/invite/')[1] ?? i.id}`, share: i.link, emailed: i.emailed, github: i.email === null });
const invites = (r: InviteResult) => ({ links: r.invitations.map(sent), problems: r.problems.map(p => `${p.who}: ${p.error}`) });

export const teamsSources: Pick<Sources, 'loadTeams' | 'loadTeamInvitations' | 'createTeam' | 'changeTeam' | 'sendTeamInvites' | 'loadTeamPreview' | 'answerTeamInvite' | 'changeSidebarDood' | 'orderTeamDoods' | 'loadTeamAccess' | 'loadTeamFirstDood'> = {
  loadTeams: async ([owner], store): Promise<Result<'loadTeams'>> => {
    if (!current(owner, store)) return { owner: NOBODY, teams: [], inbox: [], colors: [] };
    const me = await get<{ waiting?: boolean }>(store, '/api/me');
    if (me.waiting) return { owner, teams: [], inbox: [], colors: [] };
    const state = await get<WorkspacesState>(store, '/api/workspaces');
    return { owner, teams: state.workspaces.map(team), inbox: state.invitations.map(preview), colors: WORKSPACE_COLORS.map(c => ({ id: c.id, label: c.label, hex: c.hex })) };
  },
  loadTeamInvitations: async ([owner, workspaceId], store): Promise<Result<'loadTeamInvitations'>> => {
    if (!current(owner, store) || workspaceId === '' || workspaceId.startsWith('personal:')) return { owner, workspaceId, invitations: [] };
    const { invitations } = await get<{ invitations: Invitation[] }>(store, `${base(workspaceId)}/invitations`);
    return { owner, workspaceId, invitations: invitations.map(i => ({ id: i.id, who: i.email ?? `@${i.githubLogin}`, role: i.role, inviter: i.invitedBy.name, until: new Date(i.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), github: i.email === null })) };
  },
  createTeam: async ([owner, name, color, moving, invite], store): Promise<Result<'createTeam'>> => {
    let workspaceId = ''; let links: Result<'createTeam'>['links'] = []; let problems: string[] = [];
    const done = await reply(async () => {
      if (!current(owner, store)) throw new Error("Sign in first");
      const { body } = await post<{ workspace: WorkspaceSummary; invited?: InviteResult }>(store, '/api/workspaces', { name, color, agentIds: moving, ...(who(invite).length ? { invite: { who: who(invite) } } : {}) });
      workspaceId = body.workspace.id;
      if (body.invited) ({ links, problems } = invites(body.invited));
    });
    return { ...done, owner, workspaceId, links, problems };
  },
  changeTeam: async ([owner, op, workspaceId, target, value], store): Promise<Result<'changeTeam'>> => {
    let links: Result<'changeTeam'>['links'] = [];
    const done = await reply(async () => {
      if (!current(owner, store)) throw new Error("Sign in first");
      if (op === 'rename') await patch(store, base(workspaceId), { name: value });
      else if (op === 'role') await patch(store, `${base(workspaceId)}/members/${seg(target)}`, { role: value });
      else if (op === 'remove' || op === 'leave') await del(store, `${base(workspaceId)}/members/${seg(target)}`);
      else if (op === 'delete') await del(store, base(workspaceId));
      else if (op === 'withdraw') await del(store, `${base(workspaceId)}/invitations/${seg(target)}`);
      else if (op === 'renew') links = [sent((await post<SentInvitation>(store, `${base(workspaceId)}/invitations/${seg(target)}`)).body)];
      else throw new Error('Unknown team action');
    });
    return { ...done, owner, op, links };
  },
  sendTeamInvites: async ([owner, workspaceId, people, role, note], store): Promise<Result<'sendTeamInvites'>> => {
    let links: Result<'sendTeamInvites'>['links'] = []; let problems: string[] = [];
    const done = await reply(async () => {
      if (!current(owner, store)) throw new Error("Sign in first");
      const { body } = await post<InviteResult>(store, `${base(workspaceId)}/invitations`, { who: who(people), role, note });
      ({ links, problems } = invites(body));
    });
    return { ...done, owner, links, problems };
  },
  loadTeamPreview: async ([token], store): Promise<Result<'loadTeamPreview'>> => {
    if (token === '') return { valid: false, id: '', workspaceId: '', name: '', color: '', inviter: '', note: '', role: '', people: '', doods: [] };
    try {
      return { valid: true, ...preview(await get<InvitationPreview>(store, `/api/invitations/${seg(token)}`)) };
    } catch (error) {
      if (error instanceof Refused && error.status === 404) return { valid: false, id: '', workspaceId: '', name: '', color: '', inviter: '', note: '', role: '', people: '', doods: [] };
      throw error;
    }
  },
  answerTeamInvite: async ([owner, token, accept], store): Promise<Result<'answerTeamInvite'>> => {
    let workspaceId = '';
    const done = await reply(async () => {
      if (!current(owner, store)) throw new Error("Sign in first");
      if (accept) workspaceId = (await post<{ workspaceId: string }>(store, `/api/invitations/${seg(token)}/accept`)).body.workspaceId;
      else {
        // A public link is not this account's to spend; Not now just leaves it alone.
        try { await del(store, `/api/invitations/${seg(token)}`); }
        catch (error) { if (!(error instanceof Refused && error.status === 404)) throw error; }
      }
    });
    return { ...done, owner, workspaceId };
  },
  changeSidebarDood: ([owner, op, agentId, value], store) => reply(async () => {
    if (!current(owner, store)) throw new Error("Sign in first");
    if (op === 'rename') await patch(store, `/api/agents/${seg(agentId)}`, { name: value });
    else if (op === 'move') await post(store, `/api/agents/${seg(agentId)}/move`, { workspaceId: value });
    // Preserve computers unless explicitly deleting them in the full profile settings.
    else if (op === 'delete') await del(store, `/api/agents/${seg(agentId)}?computers=keep`);
    else throw new Error('Unknown Dood action');
  }),
  orderTeamDoods: ([owner, workspaceId, ids, reset], store) => reply(async () => {
    if (!current(owner, store)) throw new Error("Sign in first");
    return reset ? del(store, `${base(workspaceId)}/agent-order`) : put(store, `${base(workspaceId)}/agent-order`, { ids });
  }),
  loadTeamAccess: async ([owner], store): Promise<Result<'loadTeamAccess'>> => {
    if (!current(owner, store)) return { owner: '', waiting: false, admin: false };
    const me = await get<{ waiting?: boolean; admin?: boolean }>(store, '/api/me');
    return { owner, waiting: me.waiting === true, admin: me.admin === true };
  },
  loadTeamFirstDood: async ([owner, workspaceId], store): Promise<Result<'loadTeamFirstDood'>> => {
    if (!current(owner, store) || workspaceId === '') return { owner: '', workspaceId: '', agentId: '' };
    const { agents } = await get<{ agents: { id: string; workspaceId?: string; createdAt: number }[] }>(store, '/api/agents');
    return { owner, workspaceId, agentId: agents.filter(a => a.workspaceId === workspaceId).sort((a, b) => a.createdAt - b.createdAt)[0]?.id ?? '' };
  },
};
