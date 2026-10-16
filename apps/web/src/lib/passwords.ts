import type { MessagePart, PayDetails, SignInDetails } from "@do-computer/protocol"

// What is typed for a login or a card is checked and shaped by the shared protocol, which the
// phone uses too. It is named here as well, where the web app has always found it.
export {
  cardExpired,
  cardExpiry,
  cardNameFor,
  cardToSend,
  cardWords,
  groupedCardNumber,
  loginAnswer,
  loginToSend,
  type TypedCard,
  type TypedLogin,
  usedWords,
  withSite,
} from "@do-computer/protocol"

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
