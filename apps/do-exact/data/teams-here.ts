// Who is where in a team: its presence socket (apps/web/src/server/presence.ts), as the React app's
// `usePresence` and `useHere` (lib/workspaces.ts). The socket follows the team on screen; where this
// page is and whether its person is writing is said on it, when it opens and whenever it changes.
import type { Result, Sources } from '../app.contract.d.ts';
import type { PresenceEvent, PresenceUpdate } from '../protocol/workspace.ts';
import { isPersonalWorkspace } from '../protocol/workspace.ts';
import { current, follow, NOBODY, seg } from './api.ts';

const NOBODY_HERE: Result<'followHere'> = { owner: NOBODY, workspaceId: '', places: [], changes: 0, lost: false };

/** Where this page is, said again each time the socket opens; and how to say it while it is open. */
let place: PresenceUpdate = { agentId: null, chatId: null, typing: false };
let tell: { workspaceId: string; say: (value: unknown) => void } | undefined;
/** What the team said changed (people, Doods, its name), counted for whoever is signed in. */
let changed = { owner: NOBODY, workspaceId: '', changes: 0 };

export const teamsHereSources: Pick<Sources, 'followHere' | 'sayHere'> = {
  followHere: ([owner, workspaceId], store): Result<'followHere'> | Promise<Result<'followHere'>> => {
    if (workspaceId === '' || isPersonalWorkspace(workspaceId) || !current(owner, store)) return NOBODY_HERE;
    if (changed.owner !== owner || changed.workspaceId !== workspaceId) changed = { owner, workspaceId, changes: 0 };
    const mine = changed;
    let places: Result<'followHere'>['places'] = [];
    let lost = false;
    const now = () => ({ owner, workspaceId, places, changes: mine.changes, lost });
    return follow<Result<'followHere'>, PresenceEvent>(store, `/api/presence/${seg(workspaceId)}`, {
      open: (say) => {
        tell = { workspaceId, say };
        say(place);
        return now();
      },
      each: (event, say) => {
        tell = { workspaceId, say };
        if (event.type === 'presence') {
          places = event.here.map((p) => ({ userId: p.userId, agentId: p.agentId ?? '', chatId: p.chatId ?? '', typing: p.typing }));
        } else if (event.type === 'changed') mine.changes++;
        return now();
      },
      lost: () => {
        if (tell?.workspaceId === workspaceId) tell = undefined;
        // Nobody is here as far as this page can tell, until it is back.
        places = [];
        lost = true;
        return now();
      },
      now,
    });
  },
  sayHere: ([owner, workspaceId, agentId, chatId, typing], store) => {
    if (!current(owner, store)) return { ok: false, error: '' };
    place = { agentId: agentId === '' ? null : agentId, chatId: chatId === '' ? null : chatId, typing };
    if (tell?.workspaceId === workspaceId) tell.say(place);
    return { ok: true, error: '' };
  },
};
