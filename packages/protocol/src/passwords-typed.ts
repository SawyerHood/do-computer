/**
 * What a person types for a saved login or a saved card, checked and shaped before it is sent.
 * The web app and the phone ask for the same things in the same words, so the rules are here
 * once and not in each of them.
 */
import {
  cardBrand,
  cardDigits,
  isCardNumber,
  LOGIN_PASSWORD,
  LOGIN_USERNAME,
  MAX_LOGIN_NAME_CHARS,
  MAX_LOGIN_SITES,
  MAX_PASSWORD_CHARS,
  MAX_USERNAME_CHARS,
  type SaveCardRequest,
  type SavedCard,
  type SavedLogin,
} from "./passwords.ts"
import { siteHost } from "./screen.ts"
import type { WorkspaceSummary } from "./workspace.ts"

/**
 * Whether a workspace has a Passwords section in its settings for this person: where it keeps
 * logins or cards and they may see them. The server says which of the two each workspace has.
 */
export const keepsSecrets = (
  workspace: Pick<WorkspaceSummary, "savedLogins" | "savedCards">,
): boolean => workspace.savedLogins === true || workspace.savedCards === true

/** The sites of a login with one more, as it was typed: its host, or why it cannot be added. */
export function withSite(
  sites: readonly string[],
  typed: string,
): { sites: string[] } | { problem: string } {
  const host = siteHost(typed)
  if (host === null) {
    return { problem: `“${typed.trim()}” is not a site. Type one like github.com.` }
  }
  if (sites.includes(host)) return { sites: [...sites] }
  if (sites.length >= MAX_LOGIN_SITES) {
    return { problem: `A login can be for at most ${MAX_LOGIN_SITES} sites.` }
  }
  return { sites: [...sites, host] }
}

/** What is typed of a login. Whichever of these a form does not ask for is left out. */
export type TypedLogin = {
  name?: string
  username?: string
  password?: string
  sites?: readonly string[]
  /** A site typed and not yet added, which saving adds. */
  site?: string
}

/**
 * What of a login is sent, from what was typed: the same with its name and username trimmed
 * and the site still being typed among its sites. Or why it cannot be saved, said before
 * anything is sent.
 */
export function loginToSend<T extends TypedLogin>(
  typed: T,
): { problem: string } | { login: Omit<T, "site" | "sites"> & { sites?: string[] } } {
  const { site, sites: listed, ...rest } = typed
  const login: Omit<TypedLogin, "site" | "sites"> & { sites?: string[] } = { ...rest }
  if (login.name !== undefined) {
    login.name = login.name.trim()
    if (login.name === "") return { problem: "Give it a name." }
    if (login.name.length > MAX_LOGIN_NAME_CHARS) return { problem: "That name is too long." }
  }
  if (login.username !== undefined) {
    login.username = login.username.trim()
    if (login.username === "") return { problem: "Type the username or email." }
    if (login.username.length > MAX_USERNAME_CHARS) {
      return { problem: "That username is too long." }
    }
  }
  if (login.password !== undefined) {
    if (login.password === "") return { problem: "Type the password." }
    if (/[\r\n]/.test(login.password)) return { problem: "A password has to be a single line." }
    if (login.password.length > MAX_PASSWORD_CHARS) {
      return { problem: "That password is too long to save." }
    }
  }
  if (listed !== undefined) {
    let sites = [...listed]
    if (site !== undefined && site.trim() !== "") {
      const added = withSite(sites, site)
      if ("problem" in added) return added
      sites = added.sites
    }
    if (sites.length === 0) return { problem: "Add the site it is used on." }
    login.sites = sites
  }
  return { login: login as Omit<T, "site" | "sites"> & { sites?: string[] } }
}

/**
 * What answers an agent's asking for a login: the two values under the names the request has
 * them by, and the sites, the one that asked first. Or why it cannot be sent.
 */
export function loginAnswer(
  asked: string,
  typed: { username: string; password: string; sites: readonly string[]; site: string },
): { problem: string } | { values: Record<string, string>; sites: string[] } {
  const first = siteHost(asked) ?? asked
  const sent = loginToSend({
    ...typed,
    sites: [first, ...typed.sites.filter((site) => site !== first && site !== asked)],
  })
  if ("problem" in sent) return sent
  return {
    values: { [LOGIN_USERNAME]: sent.login.username, [LOGIN_PASSWORD]: sent.login.password },
    sites: sent.login.sites ?? [first],
  }
}

type Unit = "minute" | "hour" | "day" | "week" | "month" | "year"

/**
 * "2 hours ago", as the browser says it. A phone's JavaScript engine may have no
 * `Intl.RelativeTimeFormat`, and there it is said the same way in plain English.
 */
function ago(amount: number, unit: Unit): string {
  const Relative = (Intl as { RelativeTimeFormat?: typeof Intl.RelativeTimeFormat })
    .RelativeTimeFormat
  if (Relative !== undefined) {
    return new Relative("en", { numeric: "auto" }).format(-amount, unit)
  }
  if (amount === 1) {
    if (unit === "day") return "yesterday"
    return unit === "minute" || unit === "hour" ? `1 ${unit} ago` : `last ${unit}`
  }
  return `${amount} ${unit}s ago`
}

/** When a login or a card was last used and by which Dood: "Used 2 hours ago by Juniper". */
export function usedWords(
  login: Pick<SavedLogin, "usedAt" | "usedBy">,
  now: number = Date.now(),
): string {
  if (login.usedAt === null) return "Not used yet"
  const minutes = Math.round((now - login.usedAt) / 60_000)
  const hours = Math.round(minutes / 60)
  const days = Math.round(hours / 24)
  const when =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? ago(minutes, "minute")
        : hours < 24
          ? ago(hours, "hour")
          : days < 7
            ? ago(days, "day")
            : days < 30
              ? ago(Math.round(days / 7), "week")
              : days < 365
                ? ago(Math.round(days / 30), "month")
                : ago(Math.round(days / 365), "year")
  return `Used ${when}${login.usedBy === null ? "" : ` by ${login.usedBy}`}`
}

/** A card number as it is shown while it is typed: its digits, in groups of four. */
export const groupedCardNumber = (typed: string): string =>
  (
    typed
      .replace(/\D/g, "")
      .slice(0, 19)
      .match(/.{1,4}/g) ?? []
  ).join(" ")

/**
 * When a card expires as it is shown while it is typed on a keypad that has no slash: the
 * month's two digits, then a slash once the year is begun. Taking back the year's first digit
 * takes the slash with it, so that nothing has to be deleted twice.
 */
export function groupedExpiry(typed: string): string {
  const digits = typed.replace(/\D/g, "").slice(0, 4)
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}/${digits.slice(2)}`
}

/**
 * When a card expires, from how it was typed: "08/28", "8 / 2028", "0828".
 * Null for anything else.
 */
export function cardExpiry(typed: string): Pick<SavedCard, "expMonth" | "expYear"> | null {
  const [, month, year] = /^\s*(\d{1,2})\s*[/-]?\s*(\d{2}|\d{4})\s*$/.exec(typed) ?? []
  const expMonth = Number(month)
  if (year === undefined || expMonth < 1 || expMonth > 12) return null
  return { expMonth, expYear: year.length === 2 ? 2000 + Number(year) : Number(year) }
}

/** Whether a card has expired. It is good to the end of the month it names. */
export const cardExpired = (
  card: Pick<SavedCard, "expMonth" | "expYear">,
  now: Date = new Date(),
): boolean => card.expYear * 12 + card.expMonth - 1 < now.getUTCFullYear() * 12 + now.getUTCMonth()

/**
 * What a card will be called if it is given no name, which is what the server calls it: "Visa
 * ending 4242". Until its number is all there, that example.
 */
export function cardNameFor(number: string): string {
  const digits = cardDigits(number)
  return isCardNumber(digits)
    ? `${cardBrand(digits) ?? "Card"} ending ${digits.slice(-4)}`
    : "Visa ending 4242"
}

/**
 * A saved card in a line: its kind, the end of its number, when it expires, the name on it. One
 * that was given no name is called by its kind and the end of its number, which is then not
 * said a second time.
 */
export function cardWords(
  card: Pick<SavedCard, "brand" | "last4" | "expMonth" | "expYear" | "holder"> & { name?: string },
): string {
  const expires = `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`
  const kind = `${card.brand ?? "Card"} ending ${card.last4}`
  return [
    ...(card.name === kind ? [] : [kind]),
    `expires ${expires}`,
    ...(card.holder === "" ? [] : [card.holder]),
  ].join(" · ")
}

/**
 * What is wrong with a saved card that only removing it and adding it again puts right, or
 * undefined where nothing is.
 */
export function cardTrouble(
  card: Pick<SavedCard, "unreadable" | "expMonth" | "expYear">,
  now: Date = new Date(),
): string | undefined {
  if (card.unreadable) return "Its number can no longer be read: remove it and add it again"
  if (cardExpired(card, now)) return "It has expired: remove it and add the new one"
  return undefined
}

/** What is typed of a card. Never its security code, which is not asked for and not kept. */
export type TypedCard = {
  number: string
  expires: string
  holder: string
  postalCode: string
  name: string
}

/** A card form with nothing typed in it, which is also what one is emptied to once it is sent. */
export const NO_CARD: TypedCard = { number: "", expires: "", holder: "", postalCode: "", name: "" }

/**
 * What of a card is sent, from what was typed: its number as digits, the month and year it
 * expires, and whichever of the rest was filled in. Or why it cannot be saved, said before
 * anything is sent.
 */
export function cardToSend(
  typed: TypedCard,
  now: Date = new Date(),
): { problem: string } | { card: SaveCardRequest } {
  const number = cardDigits(typed.number)
  if (number === "") return { problem: "Type the card number." }
  if (!isCardNumber(number)) {
    return { problem: "That is not a card number. Check it against the card." }
  }
  const expiry = cardExpiry(typed.expires)
  if (expiry === null) return { problem: "Type the month and year it expires, like 08/28." }
  if (cardExpired(expiry, now)) return { problem: "That card has expired." }
  const card: SaveCardRequest = { number, ...expiry }
  for (const key of ["holder", "postalCode", "name"] as const) {
    const value = typed[key].trim()
    if (value !== "") card[key] = value
  }
  return { card }
}
