import type { Result, Sources, Store } from '../app.contract.d.ts';
import type { AgentSummary, LibraryFile, LibraryListing, LibraryVersion } from '../protocol/agent.ts';
import { embedKind } from '../protocol/embed.ts';
import { delimiterOf, parseDelimited, TABLE_ROWS } from '../protocol/delimited.ts';
import { dirOf, resolveLink, pageShownAt } from '../protocol/library-links.ts';
import { API, current, get, NOBODY, post, patch, del, seg, session, Refused, reply, follow } from './api.ts';

type File = Result<'loadLibrary'>['files'][number];
const base = (id: string) => `/api/agents/${seg(id)}/library`;
export const viewUrl = (agentId: string, view: string, path: string) => `${API}/d/${seg(agentId)}/${seg(view)}/${path.split('/').map(seg).join('/')}`;
const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const when = (n: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(n));
const kindOf = (f: LibraryFile) => {
  const kind = embedKind(f.name, f.contentType);
  return ['markdown', 'page', 'text'].includes(kind) && f.size > 1048576 ? 'other' : kind;
};
async function raw(store: Store, path: string, init: RequestInit = {}): Promise<Response> {
  const token = session(store);
  const response = await fetch(`${API}${path}`, { ...init, exactTimeout: 20000, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Refused(response.status, body.error ?? `The server answered ${response.status}.`);
  }
  return response;
}
const blank = { edit: false, open: false, ok: false, error: '', conflict: false, fileId: '', path: '', rev: 0, text: '' };
async function written(write: () => Promise<LibraryFile>, text = '', open = true, edit = false): Promise<Result<'writeLibrary'>> {
  try { const f = await write(); return { ...blank, open, edit, ok: true, fileId: f.id, path: f.path, rev: f.rev, text }; }
  catch (e) { const r = await reply(async () => { throw e; }); return { ...blank, ...r, conflict: e instanceof Refused && e.status === 409, text }; }
}
const made = async (store: Store, path: string, init: RequestInit) => (await raw(store, path, init)).json() as Promise<LibraryFile>;
export const librarySources: Pick<Sources, 'followLibrary' | 'locateLibrary' | 'loadLibrary' | 'readLibrary' | 'createLibrary' | 'writeLibrary' | 'moveLibrary' | 'deleteLibrary' | 'restoreLibrary' | 'libraryVersions' | 'revertLibrary' | 'uploadLibrary'> = {
  followLibrary: ([owner, agentId], store) => {
    if (!current(owner, store) || agentId === '') return { changes: 0, lost: false };
    let changes = 0;
    return follow<Result<'followLibrary'>, { type: string; what?: string }>(store, `/api/agents/${seg(agentId)}/events`, {
      each: (e: { type: string; what?: string }) => ({ changes: e.type === 'ready' || ['library', 'pins', 'sites'].includes(e.what ?? '') ? ++changes : changes, lost: false }),
      lost: () => ({ changes, lost: true }),
      now: () => ({ changes, lost: false }),
    });
  },
  locateLibrary: ([url]) => { const q = new URL(url, 'http://local').searchParams; return { file: q.get('file') ?? '', path: q.get('path') ?? '', mode: q.get('mode') ?? 'read' }; },
  loadLibrary: async ([owner, agentId], store): Promise<Result<'loadLibrary'>> => {
    if (!current(owner, store) || agentId === '') return { owner: NOBODY, agentId: '', files: [], rows: [], deleted: [], total: '0 B' };
    const listing = await get<LibraryListing>(store, base(agentId));
    const agents = await get<{ agent: AgentSummary }>(store, `/api/agents/${seg(agentId)}`).catch(() => ({ agent: { name: 'A Dood' } }));
    const convert = (f: LibraryFile): File => ({ id: f.id, path: f.path, name: f.name, size: f.size, rev: f.rev, kind: kindOf(f), url: `${viewUrl(agentId, listing.view, f.path)}?v=${kindOf(f) === 'page' ? pageShownAt(listing.files, f) : f.rev}`, href: `/a/${seg(agentId)}/library?path=${seg(f.path)}`, bytes: bytes(f.size), when: when(f.updatedAt), by: f.updatedBy === 'agent' ? (agents.agent.name || 'A Dood') : 'You', preview: '', depth: f.path.split('/').length - 1 });
    const sorted = [...listing.files].sort((a, b) => b.updatedAt - a.updatedAt);
    const files = await Promise.all(sorted.map(async (f, i) => {
      const shaped = convert(f);
      if (i < 8 && shaped.kind === 'markdown' && f.size < 65536) shaped.preview = (await raw(store, `${base(agentId)}/${seg(f.id)}?rev=${f.rev}`).then(r => r.text()).catch(() => '')).slice(0, 1200);
      return shaped;
    }));
    const rows: Result<'loadLibrary'>['rows'] = [];
    const folders = new Set<string>();
    for (const f of files) { const bits = f.path.split('/'); for (let i = 1; i < bits.length; i++) folders.add(bits.slice(0, i).join('/')); }
    for (const path of folders) rows.push({ id: `dir:${path}`, path, name: path.split('/').pop()!, folder: true, depth: path.split('/').length - 1, fileId: '' });
    for (const f of files) rows.push({ id: f.id, path: f.path, name: f.name, folder: false, depth: f.depth, fileId: f.id });
    const children = (dir: string): typeof rows => rows.filter(r => dirOf(r.path) === dir).sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name)).flatMap(r => r.folder ? [r, ...children(r.path)] : [r]);
    return { owner, agentId, files, rows: children(''), deleted: listing.deleted.map(f => ({ ...convert(f), when: when(f.deletedAt), by: f.deletedBy === 'agent' ? 'by a Dood' : 'by you' })), total: bytes(files.reduce((n, f) => n + f.size, 0)) };
  },
  readLibrary: async ([owner, agentId, fileId, rev, kind, path, size], store): Promise<Result<'readLibrary'>> => {
    const empty = { owner: NOBODY, fileId: '', rev: 0, text: '', rendered: '', rows: [], cut: false };
    if (!current(owner, store) || fileId === '' || (size > 1048576 && kind !== 'table') || !['markdown', 'text', 'page', 'table'].includes(kind)) return empty;
    const response = await raw(store, `${base(agentId)}/${seg(fileId)}?rev=${rev}`, kind === 'table' && size > 1048576 ? { headers: { range: 'bytes=0-262143' } } : {});
    const text = await response.text();
    const listing = kind === 'markdown' ? await get<LibraryListing>(store, base(agentId)) : undefined;
    const paths = new Set(listing?.files.map(f => f.path));
    const rendered = kind !== 'markdown' ? text : text.replace(/(!?)\[([^\]]*)\]\(([^\s)]+)\)/g, (whole, image: string, title: string, href: string) => {
      const target = resolveLink(dirOf(path), href);
      if (!target || !paths.has(target)) return whole;
      return `${image}[${title}](${image ? viewUrl(agentId, listing!.view, target) : `/a/${seg(agentId)}/library?path=${seg(target)}`})`;
    });
    const table = kind === 'table' ? parseDelimited(text, delimiterOf(path), { rows: TABLE_ROWS, whole: response.status !== 206 }) : { rows: [], cut: false };
    return { owner, fileId, rev, text, rendered, rows: table.rows.map((cells, i) => ({ id: String(i), cells: cells.map((text, col) => ({ id: String(col), text })) })), cut: table.cut };
  },
  createLibrary: ([agentId, dir], store) => written(() => made(store, `${base(agentId)}?path=${seg(`${dir === '' ? '' : `${dir}/`}Untitled.md`)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: '# Untitled\n\n' }), '# Untitled\n\n'),
  writeLibrary: ([agentId, fileId, content, rev, overwrite], store) => written(() => made(store, `${base(agentId)}/${seg(fileId)}${overwrite ? '' : `?rev=${rev}`}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: content }), content, false, true),
  moveLibrary: ([agentId, fileId, path], store) => written(async () => (await patch<LibraryFile>(store, `${base(agentId)}/${seg(fileId)}`, { path })).body),
  deleteLibrary: async ([agentId, fileId], store) => { const r = await reply(() => del(store, `${base(agentId)}/${seg(fileId)}`)); return { ...blank, open: true, ...r }; },
  restoreLibrary: ([agentId, fileId], store) => written(async () => (await post<LibraryFile>(store, `${base(agentId)}/deleted/${seg(fileId)}/restore`)).body),
  libraryVersions: async ([owner, agentId, fileId], store): Promise<Result<'libraryVersions'>> => {
    if (!current(owner, store) || fileId === '') return { owner: NOBODY, fileId: '', versions: [] };
    const { versions } = await get<{ versions: LibraryVersion[] }>(store, `${base(agentId)}/${seg(fileId)}/versions`);
    return { owner, fileId, versions: versions.map(v => ({ rev: v.rev, detail: `${v.by === 'agent' ? 'A Dood' : 'You'} · ${when(v.at)} · ${bytes(v.size)}` })) };
  },
  revertLibrary: ([agentId, fileId, rev], store) => written(async () => (await post<LibraryFile>(store, `${base(agentId)}/${seg(fileId)}/revert`, { rev })).body, '', false),
  uploadLibrary: async ([agentId, dir, files], store, storage) => reply(async () => {
    for (const file of files) {
      if (!file.path.startsWith('app:/tmp/picked/')) throw new Error('Choose a file to upload.');
      const data = await storage.fs.readFile(file.path).catch(e => { console.error('Library picker read failed', e); throw e; });
      await raw(store, `${base(agentId)}?name=${seg(file.name)}&dir=${seg(dir)}`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: data as BodyInit });
    }
  }),
};
