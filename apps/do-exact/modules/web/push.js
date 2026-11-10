// do-push: whether this browser shows the notifications a Do Computer server pushes, as the
// React app's lib/notifications.ts. It draws nothing. A data module cannot reach the browser's
// service workers or its Notification permission, so this view does, and says what it found in
// `message=` words; the Contract caller sends what the server must hear (the subscription, its
// end) with the session, which this view never sees.
//
// Props: `vapid`, the server's key (`/api/push/key`); `ask`, `on:<n>`, `off:<n>` or
// `read:<n>`, run once each time it changes.
// Messages: `state:on|off|blocked|install|unsupported`, `endpoint:<url>` (the subscription's,
// for a test), `subscription:<json>` (to register), `removed:<url>` (to forget), `error:<words>`.
//
// The worker is served from this folder, as Exact serves `modules/web/` at `/modules/`, so its
// scope is `/modules/`: push needs no more, since it is not asked to answer the page's requests.
const WORKER = '/modules/push-worker.js';
const SCOPE = '/modules/';

const supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// An iPhone or iPad, including an iPad that says it is a Mac.
const appleMobile = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const fromBase64Url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const toBase64Url = buffer => buffer === null ? '' : btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function current() {
  const registration = await navigator.serviceWorker.getRegistration(SCOPE);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

// The worker, once it is active: a subscription needs one, and `navigator.serviceWorker.ready`
// waits for a worker of the page's own scope, which this is not.
async function active() {
  const registration = await navigator.serviceWorker.register(WORKER, { scope: SCOPE });
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  if (worker && worker.state !== 'activated') {
    await new Promise(resolve => {
      const changed = () => { if (worker.state === 'activated') { worker.removeEventListener('statechange', changed); resolve(); } };
      worker.addEventListener('statechange', changed);
      changed();
    });
  }
  return registration;
}

export function create(element, props, event) {
  let gone = false;
  let last = '';
  const say = word => { if (!gone) event(8, word); };

  async function read() {
    if (!supported()) return say(appleMobile() && !installed() ? 'state:install' : 'state:unsupported');
    if (Notification.permission === 'denied') return say('state:blocked');
    const subscription = Notification.permission === 'granted' ? await current() : null;
    if (subscription === null) return say('state:off');
    say(`endpoint:${subscription.endpoint}`);
    say('state:on');
  }

  // Asks the browser's leave, then subscribes with the server's key. A subscription made for
  // another key, as after the server's data was started afresh, is given up for one that can.
  async function on(key) {
    if (!supported()) return read();
    if (await Notification.requestPermission() !== 'granted') return read();
    const registration = await active();
    const existing = await registration.pushManager.getSubscription();
    let subscription = existing;
    if (existing === null || toBase64Url(existing.options?.applicationServerKey ?? null) !== key) {
      await existing?.unsubscribe();
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(key) });
    }
    say(`endpoint:${subscription.endpoint}`);
    say(`subscription:${JSON.stringify(subscription.toJSON())}`);
  }

  async function off() {
    const subscription = supported() ? await current() : null;
    if (subscription !== null) {
      const { endpoint } = subscription;
      await subscription.unsubscribe();
      say(`removed:${endpoint}`);
    }
    return read();
  }

  function run(props) {
    const command = props.ask ?? '';
    if (command === last) return;
    last = command;
    const [verb] = command.split(':');
    const done = verb === 'on' ? on(props.vapid ?? '') : verb === 'off' ? off() : read();
    done.catch(error => say(`error:${error instanceof Error ? error.message : String(error)}`));
  }

  read().catch(error => say(`error:${error instanceof Error ? error.message : String(error)}`));
  run(props);
  event(7);
  return {
    setProps(next) { run(next); },
    destroy() { gone = true; },
  };
}

// Goes to the page a notification that was clicked is about, which the worker asks for by a
// message: a load of that address, which Exact's router opens at.
export function listen() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', ({ data }) => {
    if (data?.type === 'dc-open' && typeof data.path === 'string' && data.path.startsWith('/')) location.assign(data.path);
  });
}
