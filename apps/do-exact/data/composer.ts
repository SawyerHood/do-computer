import type { Result, Sources, Store, Storage } from '../app.contract.d.ts';
import { type AgentSummary, type ModelOption, type LibraryFile, type ThinkingLevel, filterModels, nearestThinking, isThinkingLevel, MAX_MESSAGE_IMAGES, MAX_MESSAGE_IMAGE_CHARS } from '../protocol/agent.ts';
import { API, current, get, NOBODY, patch, post, reply, Refused, seg, session, OFFLINE } from './api.ts';

type Config = Result<'loadComposer'>;
const nothing: Config = { owner: NOBODY, agentId: '', model: '', thinking: '', levels: [], models: [], more: 0, sees: false };
const money = (n: number) => n === 0 ? 'free' : `$${n < 1 ? n.toFixed(2) : n.toFixed(n < 10 ? 1 : 0)}`;
const facts = (m: ModelOption) => [m.signIn?.subscription ? 'on the subscription' : m.inputCost === 0 && m.outputCost === 0 ? 'free' : `${money(m.inputCost)} in, ${money(m.outputCost)} out per million tokens`, m.contextWindow === undefined ? '' : m.contextWindow >= 1_000_000 ? `${Math.round(m.contextWindow / 100_000) / 10}M context` : `${Math.round(m.contextWindow / 1000)}K context`].filter(Boolean).join(' · ');
const sourceOf = (m: ModelOption) => m.signIn === undefined ? `Do Computer${m.provider ? ` · ${m.provider}` : ''}` : `${m.provider ?? ''} ${m.signIn.subscription ? 'subscription' : 'key'}${m.signIn.by === null ? '' : ` · signed in by ${m.signIn.by}`}`;

// Binary requests cannot use api.post, which deliberately sends JSON.
async function binary<T>(store: Store, path: string, bytes: ArrayBuffer | Uint8Array, mime: string): Promise<T> {
  const token = session(store);
  const response = await fetch(`${API}${path}`, { method: 'POST', body: bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes, headers: { 'content-type': mime, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Refused(response.status, body.error ?? `The server answered ${response.status}.`);
  return body;
}
const why = (e: unknown) => e instanceof Refused ? e.message : OFFLINE;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(buffer: ArrayBuffer): string {
  const a = new Uint8Array(buffer), parts: string[] = [];
  for (let i = 0; i < a.length; i += 3) {
    const n = (a[i]! << 16) | ((a[i + 1] ?? 0) << 8) | (a[i + 2] ?? 0);
    parts.push(alphabet[(n >>> 18) & 63]! + alphabet[(n >>> 12) & 63]! + (i + 1 < a.length ? alphabet[(n >>> 6) & 63] : '=') + (i + 2 < a.length ? alphabet[n & 63] : '='));
  }
  return parts.join('');
}
function unbase64(text: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0 || text.length > 24_000_000) throw new Error('Bad audio.');
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const n = (alphabet.indexOf(text[i]!) << 18) | (alphabet.indexOf(text[i + 1]!) << 12) | (Math.max(0, alphabet.indexOf(text[i + 2]!)) << 6) | Math.max(0, alphabet.indexOf(text[i + 3]!));
    out.push((n >>> 16) & 255);
    if (text[i + 2] !== '=') out.push((n >>> 8) & 255);
    if (text[i + 3] !== '=') out.push(n & 255);
  }
  return new Uint8Array(out);
}
async function picture(storage: Storage, path: string, mime: string): Promise<{ mime: string; data: string; preview: string }> {
  if (!mime.startsWith('image/')) return { mime: '', data: '', preview: '' };
  try {
    const out = `${path.startsWith('app:/') ? path : 'app:/tmp/composer-image'}-message.jpg`;
    const compressed = await storage.fs.compressImage(path, out, { maxDimension: 1568, maxBytes: Math.floor((MAX_MESSAGE_IMAGE_CHARS / MAX_MESSAGE_IMAGES - 1000) * 0.75) });
    return { mime: compressed.type, data: base64(await storage.fs.readFile(out)), preview: out };
  } catch { return { mime: '', data: '', preview: '' }; }
}
function media(name: string): string {
  const ext = name.split('.').at(-1)?.toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', txt: 'text/plain', md: 'text/markdown', pdf: 'application/pdf', json: 'application/json' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream';
}

export const composerSources: Pick<Sources, 'loadComposer' | 'saveComposer' | 'uploadComposer' | 'sendComposer' | 'stopComposer' | 'transcribeComposer'> = {
  loadComposer: async ([owner, agentId, workspaceId, query], store): Promise<Config> => {
    if (!current(owner, store) || agentId === '' || workspaceId === '') return nothing;
    const { agent } = await get<{ agent: AgentSummary }>(store, `/api/agents/${seg(agentId)}`);
    const { models } = await get<{ models: ModelOption[] }>(store, `/api/models?workspaceId=${seg(workspaceId)}`);
    const selected = models.find(m => m.id === agent.model);
    const matches = filterModels(models, query).sort((a, b) => Number(a.signIn === undefined) - Number(b.signIn === undefined) || sourceOf(a).localeCompare(sourceOf(b)));
    return { owner, agentId, model: agent.model, thinking: nearestThinking(selected?.thinking ?? [], agent.thinking) ?? agent.thinking, levels: selected?.thinking ?? [], sees: selected?.images === true,
      models: matches.slice(0, 60).map(m => ({ id: m.id, name: m.name, facts: facts(m), source: sourceOf(m), suggested: m.recommended === true })), more: Math.max(0, matches.length - 60) };
  },
  saveComposer: ([agentId, workspaceId, model, wanted], store) => reply(async () => {
    const { agent } = await get<{ agent: AgentSummary }>(store, `/api/agents/${seg(agentId)}`);
    const { models } = await get<{ models: ModelOption[] }>(store, `/api/models?workspaceId=${seg(workspaceId)}`);
    const levels = models.find(m => m.id === model)?.thinking ?? [];
    const thinking: ThinkingLevel = nearestThinking(levels, isThinkingLevel(wanted) ? wanted : agent.thinking) ?? agent.thinking;
    await patch(store, `/api/agents/${seg(agentId)}`, { model, thinking });
  }),
  uploadComposer: async ([owner, agentId, chatId, key, paths, names, types, now], store, storage): Promise<Result<'uploadComposer'>> => {
    const result: Result<'uploadComposer'> = { owner, key, files: [], error: '' };
    if (!current(owner, store)) return { ...result, owner: NOBODY };
    for (let i = 0; i < paths.length; i++) {
      let path = paths[i]!, name = names[i] || decodeURIComponent(path.split('/').at(-1) ?? 'file');
      const mime = types[i] || media(name);
      if (/^image\.[a-z0-9]+$/i.test(name)) name = `pasted-${new Date(now).toISOString().slice(0, 19).replaceAll(':', '-').replace('T', '_')}${name.slice(name.lastIndexOf('.'))}`;
      try {
        // Image compression accepts app paths, while drops and pastes arrive as doc handles.
        if (path.startsWith('doc:')) {
          const copied = `app:/tmp/composer-${seg(key)}-${i}-${now}`;
          await storage.fs.copyFile(path, copied);
          path = copied;
        }
        const image = await picture(storage, path, mime);
        try {
          const file = await binary<LibraryFile>(store, `/api/agents/${seg(agentId)}/library?name=${seg(name)}&chat=${seg(chatId)}`, await storage.fs.readFile(path), mime);
          result.files.push({ id: file.id, name: file.name, stored: true, ...image });
        } catch (e) {
          if (image.data !== '') {
            result.files.push({ id: path, name, stored: false, ...image });
            result.error = `${name} could not be saved to the library (${why(e)}). It is still attached as a picture.`;
          } else result.error = `${name} could not be attached: ${why(e)}`;
        }
      } catch (e) {
        if ((e as { code?: string }).code === 'bake') throw e;
        result.error = `${name} could not be attached: ${(e as Error).message ?? 'Could not read this file.'}`;
      }
    }
    return result;
  },
  sendComposer: ([agentId, chatId, typed, files, sees, requestId], store) => reply(() => {
    const names = files.filter(f => f.stored).map(f => f.name).join(', ');
    const text = [typed.trim(), names ? `Attached: ${names}` : ''].filter(Boolean).join('\n\n') || 'Look at this.';
    const images = sees ? files.filter(f => f.data !== '').slice(0, MAX_MESSAGE_IMAGES).map(f => ({ mimeType: f.mime, data: f.data })) : [];
    return post(store, `/api/agents/${seg(agentId)}/chats/${seg(chatId)}/messages`, { text, images, requestId, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  }),
  stopComposer: ([agentId, chatId], store) => reply(() => post(store, `/api/agents/${seg(agentId)}/chats/${seg(chatId)}/abort`)),
  transcribeComposer: async ([key, ticket, message], store): Promise<Result<'transcribeComposer'>> => {
    const result = { key, ticket, text: '', end: 'draft', error: '' };
    try {
      const input = JSON.parse(message) as { audio?: string; type?: string; end?: string; error?: string };
      if (input.error) return { ...result, error: input.error };
      if (!input.audio || !input.type) return result;
      const { text } = await binary<{ text: string }>(store, '/api/transcribe', unbase64(input.audio), input.type);
      return { ...result, text, end: input.end === 'send' ? 'send' : 'draft' };
    } catch (e) { return { ...result, error: why(e) }; }
  },
};
