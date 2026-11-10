// A Dood from its first moment: the first run's agent, named, coloured and told who it met
// (components/welcome/scene.tsx `named`), what it thinks with (`thinks`, thinking.tsx), and
// that its owner has watched it hatch (`update({ hatched: true })`).
import type { Result, Sources } from '../app.contract.d.ts';
import type { AgentSummary, ModelOption } from '../protocol/agent.ts';
import { AVATAR_COLORS } from '../protocol/avatars.ts';
import { personalWorkspaceId } from '../protocol/workspace.ts';
import { current, get, NOBODY, patch, post, reply, seg } from './api.ts';

type Source = Result<'loadWelcomeModels'>['sources'][number];

/** As many models of one place as the first run's card offers (apps/web/src/lib/welcome-models.ts). */
const SHOWN = 6;
const UNSUGGESTED = 4;

/** What a model is called, without the maker's name that a catalogue of many makers puts first. */
const called = (model: ModelOption) => model.name.replace(/^[^:]{1,24}:\s+/, '');

/** The few of a place's models worth offering: the suggested ones, where it has any. */
function few(models: readonly ModelOption[], keep: string): ModelOption[] {
  if (models.length <= SHOWN) return [...models];
  const suggested = models.filter((model) => model.recommended === true);
  const shown = (suggested.length === 0 ? models.slice(0, UNSUGGESTED) : suggested).slice(0, SHOWN);
  const kept = models.find((model) => model.id === keep);
  return kept === undefined || shown.includes(kept) ? shown : [kept, ...shown.slice(0, SHOWN - 1)];
}

/**
 * What there is to choose from, by where it comes from: what the deployment includes, on the
 * model it starts a new agent on, then each provider the person has signed in to. The same
 * reading as the React app's `sources` (lib/welcome-models.ts), which is not in the protocol.
 */
function sourcesOf(models: readonly ModelOption[], currentModel: string): Source[] {
  const own = models.filter((model) => model.signIn === undefined);
  const start = own.find((model) => model.id === currentModel) ?? own.find((model) => model.recommended === true) ?? own[0];
  const found = new Map<string, ModelOption[]>();
  for (const model of models) {
    if (model.signIn === undefined) continue;
    const key = `${model.provider ?? ''}/${model.signIn.subscription ? 'subscription' : 'key'}`;
    found.set(key, [...(found.get(key) ?? []), model]);
  }
  const option = (model: ModelOption) => ({ id: model.id, name: called(model) });
  return [
    ...(start === undefined ? [] : [{ key: 'own', label: 'Included', tag: '', first: start.id, models: few(own, start.id).map(option) }]),
    ...[...found].map(([key, theirs]): Source => {
      const [{ provider, signIn }] = theirs as [ModelOption, ...ModelOption[]];
      const kind = signIn!.subscription ? 'subscription' : 'key';
      const shown = few(theirs, currentModel);
      return { key, label: `Your ${provider ?? 'own'} ${kind}`, tag: `On your ${kind}`, first: (shown.find((model) => model.id === currentModel) ?? shown[0]!).id, models: shown.map(option) };
    }),
  ];
}

export const doodSources: Pick<Sources, 'loadDoodColors' | 'nameFirstDood' | 'loadWelcomeModels' | 'thinkWith' | 'markHatched'> = {
  // The colours a creature can be: only the colour is picked, its features grow from its seed.
  loadDoodColors: async () => AVATAR_COLORS.map(({ id, label, hex }) => ({ id, label, hex })),
  // The first run's agent: made (unless it was already, on a try that failed after), then told
  // what it is called, how it looks, who named it and where they are.
  nameFirstDood: async ([agentId, name, color, seed, person], store): Promise<Result<'nameFirstDood'>> => {
    let id = agentId;
    let model = '';
    const done = await reply(async () => {
      if (id === '') id = (await post<{ agent: AgentSummary }>(store, '/api/agents', {})).body.agent.id;
      const { body } = await patch<{ agent: AgentSummary }>(store, `/api/agents/${seg(id)}`, {
        name,
        avatar: { color, seed },
        user: `Their name is ${person}.`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      model = body.agent.model;
    });
    return { ...done, agentId: id, model };
  },
  // What the person's own workspace can think with, grouped by where it comes from.
  loadWelcomeModels: async ([owner, userId, currentModel], store): Promise<Result<'loadWelcomeModels'>> => {
    if (userId === '' || !current(owner, store)) return { owner: NOBODY, sources: [] };
    const { models } = await get<{ models: ModelOption[] }>(store, `/api/models?workspaceId=${seg(personalWorkspaceId(userId))}`);
    return { owner, sources: sourcesOf(models, currentModel) };
  },
  thinkWith: ([agentId, model], store) => reply(() => patch(store, `/api/agents/${seg(agentId)}`, { model })),
  // Its owner has watched it hatch: it is never shown as an egg again.
  markHatched: ([agentId], store) => reply(() => patch(store, `/api/agents/${seg(agentId)}`, { hatched: true })),
};
