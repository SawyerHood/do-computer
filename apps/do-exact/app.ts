// The data module: it only gathers each area's sources (data/<area>.ts) into one table and
// answers from it. Shared plumbing is data/api.ts.
import type { Answer, Sources } from './app.contract.d.ts';
import { setApi } from './data/api.ts';
import { composerJobSources } from './data/composer-jobs.ts';
import { composerSources } from './data/composer.ts';
import { threadsSources } from './data/threads.ts';
import { chatSources } from './data/chat.ts';
import { sessionSources } from './data/session.ts';
import { shellSources } from './data/shell.ts';
import { teamsSources } from './data/teams.ts';
import { transportSources } from './data/transport.ts';
import { doodSettingsSources } from './data/settings-dood.ts';
import { accountSettingsSources } from './data/settings-account.ts';
import { modelSettingsSources } from './data/settings-models.ts';
import { passwordSources } from './data/settings-passwords.ts';
import { notificationSources } from './data/settings-notifications.ts';
import { waitlistSources } from './data/settings-waitlist.ts';
import { librarySources } from './data/library.ts';
import { libraryPinSources } from './data/pins.ts';
import { librarySiteSources } from './data/sites.ts';

// The deployment's address, a setting (app.json "env") that only this file may read: the
// environment's value, else the server server.ts starts. `./x` sets it per checkout. Its sockets'
// address is a setting of its own, since the build reads `grants` without running anything that
// could make one from the other: the same host, `ws:` for `http:` and `wss:` for `https:`.
export const API = import.meta.env.API_BASE_URL ?? 'http://127.0.0.1:3911';
export const SOCKETS = import.meta.env.API_SOCKET_URL ?? 'ws://127.0.0.1:3911';
setApi(API, SOCKETS);
// What the module may reach: the deployment, its sockets, the session in the secret store and the files a person picks.
export const grants = `net.fetch ${API}\nnet.websocket ${SOCKETS}\nsecret.keep session\nfs.read app:/tmp\nfs.write app:/tmp\nfs.read doc:/`;

const sources: Sources = {
  ...sessionSources,
  ...shellSources,
  ...chatSources,
  ...teamsSources,
  ...transportSources,
  ...composerSources,
  ...composerJobSources,
  ...threadsSources,
  // --- settings ---
  ...doodSettingsSources,
  ...accountSettingsSources,
  ...modelSettingsSources,
  ...passwordSources,
  ...notificationSources,
  ...waitlistSources,
  ...librarySources,
  ...libraryPinSources,
  ...librarySiteSources,
  // A new area spreads its sources here.
};

// `exactTime()` is the runtime's to answer, and the browser does. The build answers it here
// only while it renders the page to compile its Markdown (an app with `markup="markdown"`),
// where the render's bundle forgets the reserved source and asks this module (PORTING.md).
const AT_BUILD = { epochAtZero: 0, utcOffset: 0 };
export const answer: Answer = (source, args, store, storage, native) =>
  (Object.hasOwn(sources, source) ? sources[source](args, store, storage, native) : AT_BUILD) as ReturnType<Answer>;
