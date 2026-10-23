import {
  type BrowserFront,
  type BrowserPaid,
  CARD_CODE,
  DEFAULT_BROWSER_TIMEOUT_MS,
  type Json,
  type PayDetails,
  type PayField,
  paySite,
  type SavedCard,
  type UsingAgent,
} from "@do-computer/protocol"
import type { Context } from "@earendil-works/chord"
import { type ToolCall, Type } from "@earendil-works/pi-ai"
import {
  defineExtension,
  defineTool,
  type Extension,
  section,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable"
import type { Described } from "./approvals.ts"
import { type ComputerTarget, isPaired } from "./computers.ts"
import { cardVault } from "./vault-cards.ts"
import { type VaultAccess, VaultError } from "./vault.ts"

export const PAY_TOOL = "pay"

/** How many other boxes a call may have filled in beside the card. */
const MAX_FIELDS = 20
/** How long a security code someone typed is held for the payment it was typed for. */
const CODE_MS = 15 * 60_000
/** How long what a call was found to ask for is kept for the doing of it. */
const DESCRIBED_MS = 30_000

export type PaysOptions = {
  /** Who the agent is, as it is said on the computer and to whoever watches. */
  readonly agent: (context: Context) => Promise<UsingAgent>
  /** The computer a call names, or means by naming none, ready to work on; or why there is none. */
  readonly computer: (
    name: string | undefined,
    context: Context,
  ) => Promise<ComputerTarget | string>
  /** Where the agent's workspace keeps its cards. Resolves with undefined where it has none to use. */
  readonly vault: VaultAccess
  /** What kind of conversation a chat is: one with a person, a scheduled run, a thread in Slack. */
  readonly chatKind: (chatId: string, context: Context) => Promise<string | undefined>
  /** Give back the yes that a payment used up, where it came to nothing with no card typed. */
  readonly returnPass?: (chatId: string, binding: string, context: Context) => Promise<void>
  readonly now?: () => number
}

const fail = (text: string): ToolExecutionResult => ({
  isError: true,
  output: [{ type: "text", text }],
})

const said = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** A card as it is named to the agent and to people: what it is called, and how its number ends. */
const named = (card: SavedCard) =>
  card.name.includes(card.last4) ? `"${card.name}"` : `"${card.name}" (ending ${card.last4})`

/** What a yes to one payment is a yes to: this card, on this site. */
const bindingOf = (cardId: string, site: string) => `pay:${cardId}@${site}`

/** A call as it is told apart from the others of its chat: by what it asked for. */
const callKey = (chatId: string, args: { card?: unknown; computer?: unknown; button?: unknown }) =>
  JSON.stringify([chatId, args.card ?? null, args.computer ?? null, args.button ?? null])

const words = (value: unknown, limit: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : ""

/** The other boxes a call asks to have filled in, or what is wrong with how it asked. */
function fieldsOf(value: unknown): PayField[] | string {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_FIELDS) {
    return `\`fields\` is a list of at most ${MAX_FIELDS} boxes, each with \`box\` and \`text\`.`
  }
  const fields: PayField[] = []
  for (const entry of value as { box?: unknown; text?: unknown }[]) {
    const box = words(entry?.box, 120)
    if (box === "" || typeof entry?.text !== "string" || entry.text.length > 500) {
      return "Each of `fields` has `box`, the box's label, and `text`, what to put in it."
    }
    fields.push({ box, text: entry.text })
  }
  return fields
}

/** What a call would come to, found out by looking and with nothing done yet. */
type Plan =
  | { do: "fail"; text: string }
  | { do: "pay"; target: ComputerTarget; card: SavedCard; site: string; url: string; title: string }

/**
 * Paying on a website with a card the workspace saved. The agent names a card and the button
 * that pays; the card's number goes from where it is kept to the computer, which types it and
 * presses the button in one step, and is in nothing the agent is sent, says or leaves behind.
 *
 * A card has no site of its own, as a login has, so a person is asked every time, and types
 * the card's security code as they say yes. The code is held here in memory for the one
 * payment and written nowhere.
 */
export class Pays {
  readonly extension: Extension
  readonly #options: PaysOptions
  readonly #now: () => number
  /** Security codes typed with a yes, by what the yes was for, until they are used or too old. */
  readonly #held = new Map<string, { code: string; at: number }>()
  /** What each call that was asked about was found to be asking for. See `SignIns`. */
  readonly #described = new Map<string, { binding: string | null; at: number }>()

  constructor(options: PaysOptions) {
    this.#options = options
    this.#now = options.now ?? Date.now
    this.extension = defineExtension({
      name: "dc.pay",
      tools: [this.#tool()],
      sections: [
        section(
          "pay",
          () =>
            `When a website in a computer's browser wants a card to pay with, use \`${PAY_TOOL}\`: your workspace keeps cards for that, and one is typed for you without your seeing its number. A person is asked every time, and says yes or no knowing the site and what you say it is for, so say exactly what is being bought and for how much. Never ask anyone for a card's number or its code in a chat, and do not type one into a page yourself.`,
        ),
      ],
    })
  }

  /**
   * Hold the security code someone typed as they said yes to a payment, for that payment.
   * Resolves with what is wrong with it, where it is not a code.
   */
  hold(binding: string, typed: string): string | undefined {
    const code = typed.trim()
    if (!CARD_CODE.test(code)) {
      return "Type the card's security code: the three or four digits printed on it."
    }
    const now = this.#now()
    for (const [key, entry] of this.#held) {
      if (now - entry.at > CODE_MS) this.#held.delete(key)
    }
    this.#held.set(binding, { code, at: now })
    return undefined
  }

  /** The computer a call is for, where it is one with a browser to pay in. */
  async #target(name: unknown, context: Context): Promise<ComputerTarget | string> {
    const wanted = typeof name === "string" && name.trim() !== "" ? name : undefined
    const target = await this.#options.computer(wanted, context)
    if (typeof target === "string") return target
    if (!isPaired(target.computer) || target.sandbox.use === undefined) {
      return "Paying happens in a browser on somebody's own computer: one they connected themselves. Name one with `computer`."
    }
    return target
  }

  /** Look, and say what a call with these arguments would do. Nothing is typed or asked here. */
  async #plan(args: { card?: unknown; computer?: unknown }, context: Context): Promise<Plan> {
    const actor = await this.#options.vault().catch(() => undefined)
    if (actor === undefined)
      return { do: "fail", text: "Saved cards are not available to you here." }
    const target = await this.#target(args.computer, context)
    if (typeof target === "string") return { do: "fail", text: target }
    let front: BrowserFront
    try {
      front = (await target.sandbox.use!("browser", { op: "front" })) as BrowserFront
    } catch (error) {
      return { do: "fail", text: said(error) }
    }
    const site = paySite(front.url)
    if (front.url === undefined || site === null) {
      return {
        do: "fail",
        text: "There is no page open that a card can be typed on: it has to be a website reached by https. Open the page that asks for the card with the `browser` tool first, then call this again.",
      }
    }
    let cards: SavedCard[]
    try {
      cards = await cardVault.list(actor)
    } catch (error) {
      return { do: "fail", text: said(error) }
    }
    if (cards.length === 0) {
      return {
        do: "fail",
        text: "No card is saved for this workspace. A person adds one under Passwords in the workspace's settings: tell them so, and do not ask for a card's number in the chat.",
      }
    }
    const wanted = typeof args.card === "string" ? args.card.trim() : ""
    const card =
      wanted === ""
        ? cards.length === 1
          ? cards[0]
          : undefined
        : (cards.find((entry) => entry.id === wanted) ??
          cards.find((entry) => entry.name.toLowerCase() === wanted.toLowerCase()) ??
          cards.find((entry) => entry.last4 === wanted))
    if (card === undefined) {
      return {
        do: "fail",
        text: `${wanted === "" ? "More than one card is saved" : `There is no saved card called "${wanted}"`}. The saved cards are: ${cards.map(named).join(", ")}. Say which with \`card\`.`,
      }
    }
    return { do: "pay", target, card, site, url: front.url, title: front.title ?? "" }
  }

  /**
   * What a call asks to do, for the person who is asked whether it may: which card, on which
   * site as the browser has it, the button that will be pressed, and what the agent says it is
   * for. A yes is for that card on that site, once, and comes with the card's security code.
   */
  async describe(call: ToolCall, chatId: string, context: Context): Promise<Described | undefined> {
    if (call.name !== PAY_TOOL) return undefined
    const args = call.arguments as Record<string, unknown>
    const plan = await this.#plan(args, context)
    const binding = plan.do === "pay" ? bindingOf(plan.card.id, plan.site) : null
    const now = this.#now()
    for (const [key, entry] of this.#described) {
      if (now - entry.at > DESCRIBED_MS) this.#described.delete(key)
    }
    this.#described.set(callKey(chatId, args), { binding, at: now })
    if (plan.do !== "pay" || binding === null) return { pass: true }
    const purpose = words(args.purpose, 300)
    const button = words(args.button, 80)
    return {
      title: `Pay on ${plan.site} with ${plan.card.name}`,
      detail: [
        `Card: ${plan.card.brand ?? "Card"} ending ${plan.card.last4}`,
        `Page: ${plan.url.slice(0, 300)}`,
        button === "" ? "" : `It will press: “${button}”`,
        // The agent's own words, said to be so: nothing here checks them against the page.
        purpose === "" ? "It did not say what this is for." : `It says: “${purpose}”`,
      ]
        .filter(Boolean)
        .join("\n"),
      binding,
      wants: { label: "Security code" },
    }
  }

  #tool() {
    return defineTool({
      name: PAY_TOOL,
      // Described to the model only once it loads it (`deferred.ts`).
      deferred: true,
      description:
        "Pay on the page in front in a computer's browser, with a card your workspace has saved. You are never shown the card's number: it is typed for you and the button that pays is pressed, in one step. " +
        "Get the page ready with `browser` first: everything chosen, the total showing, the card's boxes on the page. Then call this with `button`, the words on the button that pays, exactly as the page has them. " +
        "The page is loaded afresh before the card is typed, so anything typed into it before is gone: give whatever else the page needs beside the card in `fields`, each with `box` (the box's label) and `text`. The name on the card and its postal code are filled in from the card. " +
        "A person is asked every time, and types the card's security code as they say yes. Say what is being bought and the total in `purpose`: they decide on your word and the site's address. " +
        "Afterwards look at the page with `browser` to see whether it went through. A bank may go on to ask for a code or an approval, which is the person's to give in the browser's window.",
      parameters: Type.Object({
        button: Type.String({
          description: "The words on the button that pays, such as “Pay $12.98”",
        }),
        purpose: Type.String({
          description: "What is being bought, from whom, and the total, for the person to read",
        }),
        card: Type.Optional(
          Type.String({
            description: "The name of the saved card to use. Left out where there is only one",
          }),
        ),
        fields: Type.Optional(
          Type.Array(
            Type.Object({
              box: Type.String({ description: "The box's label, such as Email" }),
              text: Type.String({ description: "What to put in it" }),
            }),
            { maxItems: MAX_FIELDS, description: "Other boxes the page needs filled in" },
          ),
        ),
        computer: Type.Optional(
          Type.String({
            description:
              "Name of the computer whose browser it is. It can be left out when there is only one you can use.",
          }),
        ),
      }),
      execute: async (args, api, context) => {
        const chatId = String(api.conversationId)
        // Somebody has to be there to say yes and to type the code.
        if ((await this.#options.chatKind(chatId, context)) !== "chat") {
          return fail(
            "A saved card can be used only in a conversation with a person: someone has to say that it may, and type its security code. Say in your answer what you would have bought.",
          )
        }
        const button = words(args.button, 80)
        if (button === "") return fail("Say which button pays, in `button`: the words on it.")
        const fields = fieldsOf(args.fields)
        if (typeof fields === "string") return fail(fields)
        const key = callKey(chatId, args)
        const asked = this.#described.get(key)
        this.#described.delete(key)
        const plan = await this.#plan(args, context)
        if (plan.do === "fail") return fail(plan.text)
        const binding = bindingOf(plan.card.id, plan.site)
        // The page is looked at twice: once to ask a person, and now. If it is no longer the
        // page they were asked about, their yes was not for this.
        if (
          asked === undefined ||
          this.#now() - asked.at > DESCRIBED_MS ||
          asked.binding !== binding
        ) {
          return fail(
            "The page in front changed while this was being asked about, so nothing was typed. Look at the page with `browser`, and call this again if it is still the one to pay on.",
          )
        }
        const held = this.#held.get(binding)
        if (held === undefined || this.#now() - held.at > CODE_MS) {
          this.#held.delete(binding)
          return fail(
            "The card's security code is no longer held: it is kept only for a few minutes after it is typed, and for one payment. Call this again, and the person will be asked.",
          )
        }
        const computer = { id: plan.target.id, name: plan.target.computer.name }
        const details = (
          outcome: PayDetails["pay"]["outcome"],
          site: string | null,
        ): PayDetails => ({
          pay: { computer, card: plan.card.name, last4: plan.card.last4, site, outcome },
        })
        const actor = await this.#options.vault()
        if (actor === undefined) return fail("Saved cards are not available to you here.")
        await api.details(details("paying", plan.site) as unknown as Json, context)
        const agent = await this.#options.agent(context)
        let paid: BrowserPaid
        try {
          const card = await cardVault.use(actor, plan.card.id, agent.name)
          paid = (await plan.target.sandbox.use!("browser", {
            op: "pay",
            agent,
            card: { ...card, code: held.code },
            fields,
            button,
            timeoutMs: DEFAULT_BROWSER_TIMEOUT_MS,
            say: `Paying on ${plan.site}`,
          })) as BrowserPaid
        } catch (error) {
          // Whether the card was typed is not known: the code has had its one use.
          this.#held.delete(binding)
          return {
            ...fail(
              error instanceof VaultError
                ? said(error)
                : "Paying could not be tried: the computer did not answer, or would not. Look at the page with `browser` before trying again, in case it went through.",
            ),
            details: details("failed", plan.site) as unknown as Json,
          }
        }
        if (paid.outcome !== "sent" && paid.typed === false) {
          // Nothing of the card was typed: the yes, and the code that came with it, still stand.
          await this.#options.returnPass?.(chatId, binding, context)
        } else {
          this.#held.delete(binding)
        }
        const site = paid.site ?? plan.site
        const page =
          paid.url === undefined || paid.url === ""
            ? ""
            : ` The page is now ${paid.url}${paid.title ? ` “${paid.title}”` : ""}.`
        const text =
          paid.outcome === "sent"
            ? `The card ${named(plan.card)} was typed on ${site} and “${button}” was pressed, and the page moved on.${page} Whether the payment went through is for the page to say: look at it with \`browser\` before you tell anyone it did.`
            : `${paid.message || "It did not pay."}${page}`
        return {
          ...(paid.outcome === "sent" ? {} : { isError: true }),
          output: [{ type: "text", text }],
          details: details(paid.outcome, site) as unknown as Json,
        }
      },
    })
  }
}
