import type { Result, Sources } from '../app.contract.d.ts';
import type { SiteSummary } from '../protocol/sites.ts';
import { sitePath } from '../protocol/sites.ts';
import type { LibraryListing } from '../protocol/agent.ts';
import { API, current, get, NOBODY, post, patch, del, reply, seg } from './api.ts';
const base = (id: string) => `/api/agents/${seg(id)}/sites`;
export const librarySiteSources: Pick<Sources, 'loadLibrarySites' | 'shareLibrary' | 'changeLibrarySite' | 'stopLibrarySite'> = {
  loadLibrarySites: async ([owner, agentId], store): Promise<Result<'loadLibrarySites'>> => {
    if (!current(owner, store) || agentId === '') return { owner: NOBODY, agentId: '', sites: [] };
    const [{ sites }, listing] = await Promise.all([get<{ sites: SiteSummary[] }>(store, base(agentId)), get<LibraryListing>(store, `/api/agents/${seg(agentId)}/library`)]);
    return { owner, agentId, sites: sites.map(s => ({ id: s.id, path: s.path, title: s.title, public: s.public, url: `${API}${sitePath(s.id)}`, when: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(s.createdAt)), by: s.agentId ? 'A Dood' : 'You', missing: !listing.files.some(f => f.path === s.path || f.path.startsWith(`${s.path}/`)) })) };
  },
  shareLibrary: ([agentId, path], store) => reply(() => post(store, base(agentId), { path })),
  changeLibrarySite: ([agentId, siteId, publicSite], store) => reply(() => patch(store, `${base(agentId)}/${seg(siteId)}`, { public: publicSite })),
  stopLibrarySite: ([agentId, siteId], store) => reply(() => del(store, `${base(agentId)}/${seg(siteId)}`)),
};
