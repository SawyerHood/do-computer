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
  type MessagePart,
  type PayDetails,
  type SaveCardRequest,
  type SavedCard,
  type SavedLogin,
  type SignInDetails,
  siteHost,
} from "@do-computer/protocol"

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

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

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
        ? relative.format(-minutes, "minute")
        : hours < 24
          ? relative.format(-hours, "hour")
          : days < 7
            ? relative.format(-days, "day")
            : days < 30
              ? relative.format(-Math.round(days / 7), "week")
              : days < 365
                ? relative.format(-Math.round(days / 30), "month")
                : relative.format(-Math.round(days / 365), "year")
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

/** What is typed of a card. Never its security code, which is not asked for and not kept. */
export type TypedCard = {
  number: string
  expires: string
  holder: string
  postalCode: string
  name: string
}

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

const OUTCOMES: readonly string[] = [
  "signing_in",
  "signed_in",
  "wrong_site",
  "no_form",
  "still_asking",
  "failed",
] satisfies SignInDetails["signIn"]["outcome"][]

/**
 * What a `sign_in` call carries about itself, once it signed in or tried to. A call that was
 * refused before it ran, or that ended in a form shown to the person, carries nothing.
 */
export function signInOf(part: MessagePart): SignInDetails["signIn"] | undefined {
  if (part.type !== "tool" || part.name !== "sign_in") return undefined
  const signIn = (part.details as Partial<SignInDetails> | null | undefined)?.signIn
  return typeof signIn === "object" &&
    signIn !== null &&
    typeof signIn.username === "string" &&
    typeof signIn.login === "string" &&
    (signIn.site === null || typeof signIn.site === "string") &&
    OUTCOMES.includes(signIn.outcome)
    ? signIn
    : undefined
}

/**
 * A sign-in as the one line a chat keeps of it: where, as whom, and how it went. `refused` is
 * true where nothing was typed because the page was not one the login is for. One whose call
 * ended while it was still signing in was stopped, and how it went is not known.
 */
export function signInWords(
  signIn: SignInDetails["signIn"],
  running: boolean,
): {
  words: string
  going: boolean
  refused: boolean
} {
  const { site, username, login } = signIn
  const line = (words: string) => ({ words, going: false, refused: false })
  switch (signIn.outcome) {
    case "signing_in":
      if (!running) return line(`Stopped while signing in${site === null ? "" : ` to ${site}`}`)
      return {
        words: `Signing in${site === null ? "" : ` to ${site}`} as ${username}…`,
        going: true,
        refused: false,
      }
    case "signed_in":
      return line(`Signed in${site === null ? "" : ` to ${site}`} as ${username}`)
    case "wrong_site":
      return {
        words: `Did not sign in: this page is ${
          site === null ? "not" : `${site}, not`
        } one the login ${login} is for`,
        going: false,
        refused: true,
      }
    case "no_form":
      return line(`Did not sign in: no password box on ${site ?? "the page"}`)
    case "still_asking":
      return line(`${site ?? "The page"} still asks to sign in`)
    case "failed":
      return line(`Could not sign in${site === null ? "" : ` to ${site}`}`)
  }
}

const PAID: readonly string[] = [
  "paying",
  "sent",
  "no_form",
  "still_asking",
  "failed",
] satisfies PayDetails["pay"]["outcome"][]

/**
 * What a `pay` call carries about itself, once it paid or tried to. A call that was refused
 * before it ran carries nothing.
 */
export function payOf(part: MessagePart): PayDetails["pay"] | undefined {
  if (part.type !== "tool" || part.name !== "pay") return undefined
  const pay = (part.details as Partial<PayDetails> | null | undefined)?.pay
  return typeof pay === "object" &&
    pay !== null &&
    typeof pay.card === "string" &&
    (pay.site === null || typeof pay.site === "string") &&
    PAID.includes(pay.outcome)
    ? pay
    : undefined
}

/**
 * A payment as the one line a chat keeps of it: where, with which card, and how it went. One
 * whose call ended while it was still paying was stopped, and how it went is not known.
 */
export function payWords(
  pay: PayDetails["pay"],
  running: boolean,
): { words: string; going: boolean } {
  const { site, card } = pay
  const on = site === null ? "" : ` on ${site}`
  const line = (words: string) => ({ words, going: false })
  switch (pay.outcome) {
    case "paying":
      if (!running) return line(`Stopped while paying${on}`)
      return { words: `Paying${on} with ${card}…`, going: true }
    case "sent":
      return line(`Typed ${card}${on} and pressed the button`)
    case "no_form":
      return line(`Did not pay: no card boxes on ${site ?? "the page"}`)
    case "still_asking":
      return line(`${site ?? "The page"} did not take the payment`)
    case "failed":
      return line(`Could not pay${on}`)
  }
}

/**
 * The one line a chat keeps of a call that used something saved, a login or a card, and which
 * of the two it was. Undefined for every other part, and for a call that carries nothing yet.
 */
export function keptLine(
  part: MessagePart,
):
  | { of: "sign-in" | "pay"; outcome: string; words: string; going: boolean; refused: boolean }
  | undefined {
  if (part.type !== "tool") return undefined
  const running = part.status === "pending" || part.status === "running"
  const signIn = signInOf(part)
  if (signIn !== undefined) {
    return { of: "sign-in", outcome: signIn.outcome, ...signInWords(signIn, running) }
  }
  const pay = payOf(part)
  if (pay === undefined) return undefined
  return { of: "pay", outcome: pay.outcome, refused: false, ...payWords(pay, running) }
}
