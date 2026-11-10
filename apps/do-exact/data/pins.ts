import type { Result, Sources } from '../app.contract.d.ts';
import type { LibraryListing } from '../protocol/agent.ts';
import { pinnedEntries, type Pin } from '../protocol/pins.ts';
import { embedKind } from '../protocol/embed.ts';
import { current, get, put, del, reply, seg, NOBODY } from './api.ts';
import { viewUrl } from './library.ts';
export const libraryPinSources: Pick<Sources, 'loadLibraryPins' | 'pinLibrary'> = {
  loadLibraryPins: async ([owner, agentId], store): Promise<Result<'loadLibraryPins'>> => {
    if (!current(owner, store) || agentId === '') return { owner: NOBODY, agentId: '', pins: [] };
    const { pins } = await get<{ pins: Pin[] }>(store, `/api/agents/${seg(agentId)}/pins`);
    if (pins.length === 0) return { owner, agentId, pins: [] };
    const listing = await get<LibraryListing>(store, `/api/agents/${seg(agentId)}/library`);
    return { owner, agentId, pins: await Promise.all(pinnedEntries(pins, listing.files).map(async ({ pin, file, title }) => ({ fileId: pin.fileId, currentId: file?.id ?? '', title, missing: file === undefined, kind: file ? embedKind(file.name, file.contentType) : 'other', url: file ? `${viewUrl(agentId, listing.view, file.path)}?v=${file.rev}` : '', preview: file && embedKind(file.name, file.contentType) === 'markdown' ? (await (await fetch(`${viewUrl(agentId, listing.view, file.path)}?v=${file.rev}`)).text()).slice(0, 1200) : '', when: file ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(file.updatedAt)) : '' }))) };
  },
  pinLibrary: ([agentId, fileId, pinned], store) => reply(() => pinned ? put(store, `/api/agents/${seg(agentId)}/pins/${seg(fileId)}`) : del(store, `/api/agents/${seg(agentId)}/pins/${seg(fileId)}`)),
};
