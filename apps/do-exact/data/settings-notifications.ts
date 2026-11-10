// This browser's notifications (apps/web/src/lib/notifications.ts): the key a browser subscribes
// with, and telling the server of a subscription and of its end. The browser's side (its
// permission, its service worker, the subscription) is the do-push view's (modules/web/push.js).
import type { Result, Sources } from '../app.contract.d.ts';
import { current, get, NOBODY, post, Refused, reply } from './api.ts';

export const notificationSources: Pick<Sources, 'loadPushKey' | 'registerBrowser' | 'unregisterBrowser' | 'sendTestPush'> = {
  loadPushKey: async ([owner, asked], store): Promise<Result<'loadPushKey'>> => {
    if (!asked || !current(owner, store)) return { owner: NOBODY, key: '' };
    const { key } = await get<{ key: string }>(store, '/api/push/key');
    return { owner, key };
  },
  // The subscription as the browser gave it (`PushSubscription.toJSON()`), as text.
  registerBrowser: ([subscription], store) => reply(() => post(store, '/api/push/register', { subscription: JSON.parse(subscription) })),
  unregisterBrowser: ([endpoint], store) => reply(() => post(store, '/api/push/unregister', { token: endpoint })),
  // Whether this browser's push service took a notification sent to it now.
  sendTestPush: async ([endpoint], store): Promise<Result<'sendTestPush'>> => {
    try {
      const { body } = await post<{ ok: boolean }>(store, '/api/push/test', { endpoint });
      return { ok: true, error: '', sent: body.ok };
    } catch (e) {
      if ((e as { code?: string }).code === 'bake') throw e;
      return { ok: false, error: e instanceof Refused ? e.message : 'Can’t reach the server. Check your connection and try again.', sent: false };
    }
  },
};
