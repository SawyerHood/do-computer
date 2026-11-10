// The data module: it only gathers each area's sources (data/<area>.ts) into one table and
// answers from it. Shared plumbing is data/api.ts.
import type { Answer, Sources } from './app.contract.d.ts';
import { API } from './data/api.ts';
import { chatSources } from './data/chat.ts';
import { sessionSources } from './data/session.ts';
import { shellSources } from './data/shell.ts';

// What the module may reach: the deployment (data/api.ts `API`, written out again because the
// build reads this line without running the module) and the session in the secret store.
export const grants = 'net.fetch http://127.0.0.1:3911\nsecret.keep session';
// server.ts reads the address from here.
export { API };

const sources: Sources = {
  ...sessionSources,
  ...shellSources,
  ...chatSources,
  // A new area spreads its sources here.
};

// `exactTime()` is the runtime's to answer, and the browser does. The build answers it here
// only while it renders the page to compile its Markdown (an app with `markup="markdown"`),
// where the render's bundle forgets the reserved source and asks this module (PORTING.md).
const AT_BUILD = { epochAtZero: 0, utcOffset: 0 };
export const answer: Answer = (source, args, store, storage, native) =>
  (Object.hasOwn(sources, source) ? sources[source](args, store, storage, native) : AT_BUILD) as ReturnType<Answer>;
