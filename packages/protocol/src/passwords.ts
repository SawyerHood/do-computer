/**
 * Saved logins: a username and a password a workspace keeps for its agents to sign in with on
 * the sites each is for. An agent uses one without ever being shown the password, and nobody is
 * shown it again once it is saved: it can be replaced or removed, and that is all.
 */

/**
 * Who has saved logins on a deployment (`DC_SECRETS`). `admins`, which is what an unset one
 * means: those its `DC_ADMIN_EMAILS` names, in a workspace where everyone is one of them.
 */
export type SecretsMode = "off" | "admins" | "on"

/** A saved login as people and agents are shown it: everything but the password. */
export type SavedLogin = {
  id: string
  /** What it is called, by people and by the agent that asks for it. */
  name: string
  username: string
  /** The sites it is typed on, as host names: these and their subdomains, and nowhere else. */
  sites: string[]
  /** Who saved it, where that is known. */
  addedBy: { id: string; name: string } | null
  addedAt: number
  /** When a password was last given for it. */
  changedAt: number
  /** When an agent last signed in with it, and what that agent is called. */
  usedAt: number | null
  usedBy: string | null
  /**
   * True where what is kept can no longer be read: the deployment's key was changed after it
   * was saved. It has to be given its password again before anything can sign in with it.
   */
  unreadable?: true
}

export type SavedLoginsState = { logins: SavedLogin[] }

export type SaveLoginRequest = {
  name: string
  username: string
  password: string
  sites: string[]
}

/** What to change of a saved login. A password given here replaces the one kept. */
export type ChangeLoginRequest = {
  name?: string
  username?: string
  password?: string
  sites?: string[]
}

export const MAX_SAVED_LOGINS = 200
export const MAX_LOGIN_SITES = 8
export const MAX_LOGIN_NAME_CHARS = 60
export const MAX_USERNAME_CHARS = 320
export const MAX_PASSWORD_CHARS = 1024

/** The names the two things asked for in a request for a login go by. */
export const LOGIN_USERNAME = "username"
export const LOGIN_PASSWORD = "password"

/**
 * What a call of the `sign_in` tool leaves with it, for a chat to show: where it signed in, as
 * whom, and how it went. Nothing of the password.
 */
export type SignInDetails = {
  signIn: {
    computer: { id: string; name: string }
    /** The saved login's name. */
    login: string
    username: string
    /** The host of the page, as the browser gave it. */
    site: string | null
    outcome: "signing_in" | "signed_in" | "wrong_site" | "no_form" | "still_asking" | "failed"
  }
}

/**
 * Which kinds of thing a deployment keeps for its Doods to use unseen (`DC_SECRET_KINDS`):
 * logins for websites, and cards to pay with. Unset, it is logins alone.
 */
export type SecretKind = "passwords" | "cards"
export const SECRET_KINDS = ["passwords", "cards"] as const satisfies readonly SecretKind[]

/**
 * A saved card as people and agents are shown it: what it is called, whose it is, when it runs
 * out, and the last four digits of its number. Never the number, and its security code is not
 * kept at all: whoever says a card may be used types the code then, for that one use.
 */
export type SavedCard = {
  id: string
  name: string
  /** The name on the card. Empty where none was given. */
  holder: string
  /** Visa, Mastercard and so on, where the number says. */
  brand: string | null
  last4: string
  expMonth: number
  /** The year in full, such as 2028. */
  expYear: number
  /** The postal code its bills go to, which many shops ask for with it. Empty where none was given. */
  postalCode: string
  addedBy: { id: string; name: string } | null
  addedAt: number
  usedAt: number | null
  usedBy: string | null
  /** True where the number kept can no longer be read: see `SavedLogin.unreadable`. */
  unreadable?: true
}

export type SavedCardsState = { cards: SavedCard[] }

export type SaveCardRequest = {
  /** Left out, it is called after its kind and its last four digits. */
  name?: string
  holder?: string
  number: string
  expMonth: number
  expYear: number
  postalCode?: string
}

export const MAX_SAVED_CARDS = 20
export const MAX_CARD_HOLDER_CHARS = 100
export const MAX_POSTAL_CODE_CHARS = 12
/** A card's security code is three or four digits. */
export const CARD_CODE = /^\d{3,4}$/

/** The digits of a card number as it was typed, with its spaces and dashes taken out. */
export const cardDigits = (typed: string): string => typed.replace(/[\s-]/g, "")

/** Whether digits are a card number that could exist: of a length one has, and adding up (Luhn). */
export function isCardNumber(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false
  let sum = 0
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index])
    if (index % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

/** Whose card a number is, from how it starts. Null for one that is not known here. */
export function cardBrand(digits: string): string | null {
  const two = Number(digits.slice(0, 2))
  const four = Number(digits.slice(0, 4))
  if (digits.startsWith("4")) return "Visa"
  if ((two >= 51 && two <= 55) || (four >= 2221 && four <= 2720)) return "Mastercard"
  if (two === 34 || two === 37) return "American Express"
  if (four === 6011 || two === 65) return "Discover"
  if (two === 35) return "JCB"
  return null
}

/**
 * What a call of the `pay` tool leaves with it, for a chat to show: which card, on which site,
 * and how it went. Nothing of the card's number but its last four digits.
 */
export type PayDetails = {
  pay: {
    computer: { id: string; name: string }
    /** The saved card's name. */
    card: string
    last4: string
    /** The host of the page, as the browser gave it. */
    site: string | null
    outcome: "paying" | "sent" | "no_form" | "still_asking" | "failed"
  }
}
