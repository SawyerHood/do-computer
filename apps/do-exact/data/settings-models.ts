// The models a workspace's Doods can run on, and those the deployment offers everyone: the
// deployment's own, the providers there are and which one is signed in to, and signing in to one
// with a subscription or a key (apps/web/src/components/settings/models.tsx). A key or a token
// typed here goes to the server in the answer to the sign-in's question and nowhere else: it is
// never an argument of a resource, never in an answer, and the view forgets it once it is sent.
import type { Result, Sources } from '../app.contract.d.ts';
import type { ModelOption } from '../protocol/agent.ts';
import type { ModelLogin, ModelLoginMethod, ModelProvider } from '../protocol/model-access.ts';
import { current, del, get, NOBODY, post, Refused, reply, seg } from './api.ts';

type Providers = Result<'loadModelProviders'>;
type Login = Result<'loadModelLogin'>;

/** A way of signing in, as a button names it: pi's "Anthropic (Claude Pro/Max)" is "Claude Pro or Max" here (models.tsx `short`). */
export function short(method: ModelLoginMethod): string {
  const inside = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(method.label);
  const name = inside === null ? method.label.replace(/ OAuth$/, '') : inside[2] === 'subscription' ? inside[1]! : inside[2]!;
  return name.replace(/ subscription$/, '').replace('/', ' or ');
}

/** What a provider offers, in a few words, for one that is not signed in to (models.tsx `offer`). */
function offer(provider: ModelProvider, deployment: boolean): string {
  if (deployment) return 'Already here. Sign in to use your own account.';
  const account = provider.methods.find((m) => m.type === 'oauth');
  const key = provider.methods.some((m) => m.type === 'api_key');
  const first = account === undefined ? undefined : account.subscription ? 'A subscription' : 'An account';
  return `${[first, key ? (first === undefined ? 'A key' : 'a key') : undefined].filter((p) => p !== undefined).join(' or ')}.`;
}

/** A provider's own choices of how, as they turn out from a page (models.tsx `WAYS`). */
const WAYS: Record<string, { label: string; description: string }> = {
  browser: { label: 'On a sign-in page', description: 'Its page ends at an address that you paste back here.' },
  device_code: { label: 'With a code', description: 'Enter a short code on its page. Nothing to paste back.' },
};

const NO_LOGIN: Login = {
  owner: NOBODY, scopeId: '', loginId: '', rev: 0, status: '', promptId: '', promptType: '', promptLabel: '', placeholder: '', pasted: '', address: false,
  options: [], authUrl: '', deviceCode: '', deviceUri: '', progress: '', notes: [], error: '',
};

function loginOf(owner: string, scopeId: string, login: ModelLogin, title: string): Login {
  const prompt = login.prompt;
  const address = /localhost|127\.0\.0\.1/.test(prompt?.placeholder ?? '');
  const asked = (prompt?.message ?? '').replace(/^Enter /, '').replace(/:$/, '');
  return {
    owner,
    scopeId,
    loginId: login.id,
    rev: login.rev,
    status: login.status,
    promptId: prompt?.id ?? '',
    promptType: prompt?.type ?? '',
    // What a field asks for; one that would only say the window's title again says "Key".
    promptLabel: prompt === null ? '' : asked === title ? 'Key' : asked,
    placeholder: prompt?.placeholder ?? '',
    // What is pasted back from a provider's page, by its name.
    pasted: prompt?.type !== 'manual_code' ? '' : address ? 'The address you end up at' : 'The code it shows',
    address,
    options: (prompt?.options ?? []).map((o) => ({ id: o.id, label: WAYS[o.id]?.label ?? o.label, description: WAYS[o.id]?.description ?? o.description ?? '' })),
    authUrl: login.authUrl?.url ?? '',
    deviceCode: login.deviceCode?.userCode ?? '',
    deviceUri: login.deviceCode?.verificationUri ?? '',
    progress: login.progress ?? '',
    notes: login.notes.map((n) => n.message),
    error: login.error ?? '',
  };
}

/** A login's answer, as a mutation's reply: whether it went through, why not, and the login it started. */
async function started(write: () => Promise<{ body: { login: ModelLogin } }>): Promise<Result<'startModelLogin'>> {
  try {
    const { body } = await write();
    return { ok: true, error: '', loginId: body.login.id };
  } catch (e) {
    if ((e as { code?: string }).code === 'bake') throw e;
    return { ok: false, error: e instanceof Refused ? e.message : 'Can’t reach the server. Check your connection and try again.', loginId: '' };
  }
}

export const modelSettingsSources: Pick<Sources, 'loadModelProviders' | 'loadModelLogin' | 'signOutOfProvider' | 'startModelLogin' | 'answerModelLogin' | 'cancelModelLogin'> = {
  // A workspace's providers, or with "deployment" the deployment's own, and what the deployment
  // offers without anyone signing in (models.tsx `Section`).
  loadModelProviders: async ([owner, scopeId, meId], store): Promise<Providers> => {
    if (scopeId === '' || !current(owner, store)) return { owner: NOBODY, scopeId: '', own: '', ownCount: 0, providers: [] };
    const server = scopeId === 'deployment';
    const [{ providers }, { models }] = await Promise.all([
      get<{ providers: ModelProvider[] }>(store, `/api/workspaces/${seg(scopeId)}/model-providers`),
      get<{ models: ModelOption[] }>(store, server ? '/api/models' : `/api/models?workspaceId=${seg(scopeId)}`),
    ]);
    const own = models.filter((m) => m.signIn === undefined);
    const through = [...new Set(own.map((m) => m.provider).filter((p): p is string => typeof p === 'string' && p !== ''))];
    // With none set apart, as where there are only a few, all of them come first.
    const any = providers.some((p) => p.featured);
    return {
      owner,
      scopeId,
      own: through.length === 0
        ? 'A built-in echo model that repeats what it is told: this deployment has no model key and is signed in to nothing.'
        : `${own.length} model${own.length === 1 ? '' : 's'} through ${through.join(' and ')}, ${server ? 'offered to everyone' : 'paid for by this deployment. Always there'}.`,
      ownCount: own.length,
      providers: providers.map((p) => {
        const signedIn = p.signedIn;
        const method = p.methods.find((m) => m.type === signedIn?.type);
        return {
          id: p.id,
          name: p.name,
          first: !any || p.featured || signedIn !== null,
          signedIn: signedIn !== null,
          byMe: signedIn !== null && signedIn.byId === meId,
          // Said in the view with the day it was signed in on, which only the view's clock knows.
          words: signedIn === null ? offer(p, !server && through.includes(p.name)) : signedIn.type === 'api_key' ? 'A key' : method?.subscription ? `${short(method)} subscription` : 'An account',
          by: signedIn === null ? '' : `by ${signedIn.byId === meId ? 'you' : (signedIn.by ?? 'someone')}`,
          at: signedIn?.at ?? 0,
          models: signedIn === null ? '' : `${signedIn.models} model${signedIn.models === 1 ? '' : 's'}`,
          methods: p.methods.map((m) => ({
            type: m.type,
            short: short(m),
            label: m.label,
            subscription: m.subscription,
          })),
        };
      }),
    };
  },
  // How a sign-in stands, asked again while it waits.
  loadModelLogin: async ([owner, scopeId, loginId, title], store): Promise<Login> => {
    if (loginId === '' || !current(owner, store)) return NO_LOGIN;
    const { login } = await get<{ login: ModelLogin }>(store, `/api/workspaces/${seg(scopeId)}/model-logins/${seg(loginId)}`);
    return loginOf(owner, scopeId, login, title);
  },
  signOutOfProvider: ([scopeId, providerId], store) => reply(() => del(store, `/api/workspaces/${seg(scopeId)}/model-providers/${seg(providerId)}`)),
  startModelLogin: ([scopeId, providerId, type], store) => started(() => post<{ login: ModelLogin }>(store, `/api/workspaces/${seg(scopeId)}/model-logins`, { providerId, type })),
  // The value may be a key: it is sent, and kept nowhere here.
  answerModelLogin: ([scopeId, loginId, promptId, value], store) => reply(() => post(store, `/api/workspaces/${seg(scopeId)}/model-logins/${seg(loginId)}/answer`, { promptId, value })),
  cancelModelLogin: ([scopeId, loginId], store) => reply(() => del(store, `/api/workspaces/${seg(scopeId)}/model-logins/${seg(loginId)}`)),
};
