// A workspace's saved logins and cards (apps/web/src/components/settings/passwords.tsx,
// cards.tsx). Nothing here ever reads a password or a card number back: the server sends none.
// What is typed for one reaches this module only as a mutation's arguments, is checked and
// shaped by the protocol's own functions, sent, and kept nowhere.
import type { Result, Sources } from '../app.contract.d.ts';
import type { SavedCard, SavedLogin } from '../protocol/passwords.ts';
import { cardDigits, isCardNumber, MAX_LOGIN_NAME_CHARS, MAX_LOGIN_SITES, MAX_PASSWORD_CHARS, MAX_USERNAME_CHARS, type SaveCardRequest } from '../protocol/passwords.ts';
import { siteHost } from '../protocol/screen.ts';

// The checks of packages/protocol/src/passwords-typed.ts, said again: Exact refuses a data
// module that imports a file mentioning `Date.now()` or `new Date()`, even as a default
// parameter, and that file does (GAPS.md, "Settings"). Keep the two the same.

function withSite(sites: readonly string[], typed: string): { sites: string[] } | { problem: string } {
  const host = siteHost(typed);
  if (host === null) return { problem: `“${typed.trim()}” is not a site. Type one like github.com.` };
  if (sites.includes(host)) return { sites: [...sites] };
  if (sites.length >= MAX_LOGIN_SITES) return { problem: `A login can be for at most ${MAX_LOGIN_SITES} sites.` };
  return { sites: [...sites, host] };
}

type TypedLogin = { name?: string; username?: string; password?: string; sites?: readonly string[]; site?: string };

function loginToSend(typed: TypedLogin): { problem: string } | { login: { name?: string; username?: string; password?: string; sites?: string[] } } {
  const { site, sites: listed, ...rest } = typed;
  const login: { name?: string; username?: string; password?: string; sites?: string[] } = { ...rest };
  if (login.name !== undefined) {
    login.name = login.name.trim();
    if (login.name === '') return { problem: 'Give it a name.' };
    if (login.name.length > MAX_LOGIN_NAME_CHARS) return { problem: 'That name is too long.' };
  }
  if (login.username !== undefined) {
    login.username = login.username.trim();
    if (login.username === '') return { problem: 'Type the username or email.' };
    if (login.username.length > MAX_USERNAME_CHARS) return { problem: 'That username is too long.' };
  }
  if (login.password !== undefined) {
    if (login.password === '') return { problem: 'Type the password.' };
    if (/[\r\n]/.test(login.password)) return { problem: 'A password has to be a single line.' };
    if (login.password.length > MAX_PASSWORD_CHARS) return { problem: 'That password is too long to save.' };
  }
  if (listed !== undefined) {
    let sites = [...listed];
    if (site !== undefined && site.trim() !== '') {
      const added = withSite(sites, site);
      if ('problem' in added) return added;
      sites = added.sites;
    }
    if (sites.length === 0) return { problem: 'Add the site it is used on.' };
    login.sites = sites;
  }
  return { login };
}

type Expiry = { expMonth: number; expYear: number };

function cardExpiry(typed: string): Expiry | null {
  const [, month, year] = /^\s*(\d{1,2})\s*[/-]?\s*(\d{2}|\d{4})\s*$/.exec(typed) ?? [];
  const expMonth = Number(month);
  if (year === undefined || expMonth < 1 || expMonth > 12) return null;
  return { expMonth, expYear: year.length === 2 ? 2000 + Number(year) : Number(year) };
}

/** Whether a card has expired by `month` ("2026-11"). It is good to the end of the month it names. */
function cardExpired(card: Expiry, month: string): boolean {
  const [year, m] = month.split('-').map(Number);
  return card.expYear * 12 + card.expMonth - 1 < (year ?? 0) * 12 + (m ?? 1) - 1;
}

function cardWords(card: Pick<SavedCard, 'brand' | 'last4' | 'expMonth' | 'expYear' | 'holder' | 'name'>): string {
  const expires = `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`;
  const kind = `${card.brand ?? 'Card'} ending ${card.last4}`;
  return [...(card.name === kind ? [] : [kind]), `expires ${expires}`, ...(card.holder === '' ? [] : [card.holder])].join(' · ');
}

function cardTrouble(card: SavedCard, month: string): string {
  if (card.unreadable === true) return 'Its number can no longer be read: remove it and add it again';
  if (cardExpired(card, month)) return 'It has expired: remove it and add the new one';
  return '';
}

function cardToSend(typed: { number: string; expires: string; holder: string; postalCode: string; name: string }, month: string): { problem: string } | { card: SaveCardRequest } {
  const number = cardDigits(typed.number);
  if (number === '') return { problem: 'Type the card number.' };
  if (!isCardNumber(number)) return { problem: 'That is not a card number. Check it against the card.' };
  const expiry = cardExpiry(typed.expires);
  if (expiry === null) return { problem: 'Type the month and year it expires, like 08/28.' };
  if (cardExpired(expiry, month)) return { problem: 'That card has expired.' };
  const card: SaveCardRequest = { number, ...expiry };
  for (const key of ['holder', 'postalCode', 'name'] as const) {
    const value = typed[key].trim();
    if (value !== '') card[key] = value;
  }
  return { card };
}
import { current, del, get, NOBODY, patch, post, Refused, reply, seg } from './api.ts';

/** A refusal said before anything is sent, as a write's reply. */
const refuse = (problem: string) => ({ ok: false, error: problem });

export const passwordSources: Pick<Sources, 'loadSavedLogins' | 'loadSavedCards' | 'addSite' | 'saveLogin' | 'changeLogin' | 'removeLogin' | 'saveCard' | 'removeCard'> = {
  loadSavedLogins: async ([owner, workspaceId, asked], store): Promise<Result<'loadSavedLogins'>> => {
    if (!asked || workspaceId === '' || !current(owner, store)) return { owner: NOBODY, workspaceId: '', kept: false, logins: [] };
    try {
      const { logins } = await get<{ logins: SavedLogin[] }>(store, `/api/workspaces/${seg(workspaceId)}/passwords`);
      return {
        owner,
        workspaceId,
        kept: true,
        logins: logins.map((l) => ({ id: l.id, name: l.name, username: l.username, sites: [...l.sites], usedAt: l.usedAt ?? 0, usedBy: l.usedBy ?? '', unreadable: l.unreadable === true })),
      };
    } catch (e) {
      // A workspace that keeps no logins, or keeps them from this person, has none to show.
      if (e instanceof Refused && (e.status === 403 || e.status === 404)) return { owner, workspaceId, kept: false, logins: [] };
      throw e;
    }
  },
  // `month` ("2026-11") is the view's, for telling a card that has expired.
  loadSavedCards: async ([owner, workspaceId, asked, month], store): Promise<Result<'loadSavedCards'>> => {
    if (!asked || workspaceId === '' || !current(owner, store)) return { owner: NOBODY, workspaceId: '', kept: false, cards: [] };
    try {
      const { cards } = await get<{ cards: SavedCard[] }>(store, `/api/workspaces/${seg(workspaceId)}/cards`);
      return {
        owner,
        workspaceId,
        kept: true,
        cards: cards.map((c) => ({ id: c.id, name: c.name, words: cardWords(c), trouble: cardTrouble(c, month), usedAt: c.usedAt ?? 0, usedBy: c.usedBy ?? '' })),
      };
    } catch (e) {
      if (e instanceof Refused && (e.status === 403 || e.status === 404)) return { owner, workspaceId, kept: false, cards: [] };
      throw e;
    }
  },
  // A site typed into a login's list, as its host, or why it is not one (login-fields.tsx `SitesField`).
  addSite: async ([sites, typed]) => {
    const added = withSite(sites, typed);
    return 'problem' in added ? { ok: false, error: added.problem, sites: [...sites] } : { ok: true, error: '', sites: added.sites };
  },
  saveLogin: async ([workspaceId, name, username, password, sites, site], store) => {
    const sent = loginToSend({ name, username, password, sites, site });
    if ('problem' in sent) return refuse(sent.problem);
    return reply(() => post(store, `/api/workspaces/${seg(workspaceId)}/passwords`, { ...sent.login, sites: sent.login.sites ?? [] }));
  },
  // "password" gives it a new password and nothing else; "change" everything but the password.
  changeLogin: async ([workspaceId, loginId, what, name, username, password, sites, site], store) => {
    const sent = what === 'password' ? loginToSend({ password }) : loginToSend({ name, username, sites, site });
    if ('problem' in sent) return refuse(sent.problem);
    return reply(() => patch(store, `/api/workspaces/${seg(workspaceId)}/passwords/${seg(loginId)}`, sent.login));
  },
  removeLogin: ([workspaceId, loginId], store) => reply(() => del(store, `/api/workspaces/${seg(workspaceId)}/passwords/${seg(loginId)}`)),
  saveCard: async ([workspaceId, number, expires, holder, postalCode, name, month], store) => {
    const sent = cardToSend({ number, expires, holder, postalCode, name }, month);
    if ('problem' in sent) return refuse(sent.problem);
    return reply(() => post(store, `/api/workspaces/${seg(workspaceId)}/cards`, sent.card));
  },
  removeCard: ([workspaceId, cardId], store) => reply(() => del(store, `/api/workspaces/${seg(workspaceId)}/cards/${seg(cardId)}`)),
};
