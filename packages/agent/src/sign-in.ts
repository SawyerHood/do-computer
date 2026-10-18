import {
  type BrowserFront,
  type BrowserSignedIn,
  DEFAULT_BROWSER_TIMEOUT_MS,
  type Json,
  type SavedLogin,
  type SignInDetails,
  signInSite,
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
import { ASKED_THROUGH_MAIN } from "./bus.ts"
import { type ComputerTarget, isPaired } from "./computers.ts"
import { vault, type VaultAccess, VaultError } from "./vault.ts"

export const SIGN_IN_TOOL = "sign_in"

export type SignInsOptions = {
  /** Who the agent is, as it is said on the computer and to whoever watches. */
  readonly agent: (context: Context) => Promise<UsingAgent>
  /** The computer a call names, or means by naming none, ready to work on; or why there is none. */
  readonly computer: (
    name: string | undefined,
    context: Context,
  ) => Promise<ComputerTarget | string>
  /** Where the agent's workspace keeps its logins. Resolves with undefined where it has none to use. */
  readonly vault: VaultAccess
  /** What kind of conversation a chat is: one with a person, a scheduled run, a thread in Slack. */
  readonly chatKind: (chatId: string, context: Context) => Promise<string | undefined>
  /**
   * Whether a chat can ask a person for a login: one with people in it, or a sub-agent that asks
   * through a main chat with the bus on (`bus.ts`). Absent: only a chat with people in it.
   */
  readonly canAsk?: (chatId: string, context: Context) => Promise<boolean>
  /**
   * Ask the person to save a login for a site, in the chat that needs it. Resolves with whether
   * this is the first time it was asked.
   */
  readonly askForLogin: (
    input: { chatId: string; purpose: string | null; site: string },
    context: Context,
  ) => Promise<{ fresh: boolean }>
  /**
   * Give back the yes that a sign-in used up, where it came to nothing with no password typed:
   * the page had no form yet, say. Whoever said yes meant the sign-in, not the one attempt.
   */
  readonly returnPass?: (chatId: string, binding: string, context: Context) => Promise<void>
}

const fail = (text: string): ToolExecutionResult => ({
  isError: true,
  output: [{ type: "text", text }],
})

const said = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** A login as it is named to the agent: what it is called, and whom it signs in as. */
const named = (login: SavedLogin) => `"${login.name}" (${login.username})`

/** What a call would come to, found out by looking and with nothing done yet. */
type Plan =
  /** It cannot be tried, and this is why. */
  | { do: "fail"; text: string }
  /** No login is saved for the site: the person would be asked for one. */
  | { do: "ask"; site: string }
  /** The login it names is for other sites than the page in front. Nothing would be typed. */
  | { do: "wrong_site"; target: ComputerTarget; login: SavedLogin; host: string | null }
  | { do: "sign_in"; target: ComputerTarget; login: SavedLogin; site: string; url: string }

/**
 * What stands for a password wherever one might have come back in something the agent is told.
 * None should: the computer answers with nothing made from it. This is for the day it does.
 */
function without(text: string, password: string): string {
  if (password === "") return text
  let out = text.split(password).join("[password]")
  const encoded = encodeURIComponent(password)
  if (encoded !== password) out = out.split(encoded).join("[password]")
  return out
}

/**
 * Signing in on a website with a login the workspace saved. The agent names a login, or lets
 * the page say which; the password goes from where it is kept to the computer, which types it,
 * and is in nothing the agent is sent, says, or leaves behind in a chat.
 */
export class SignIns {
  readonly extension: Extension
  readonly #options: SignInsOptions
  /**
   * What each call that was asked about was found to be asking for, kept for the moment
   * between the asking and the doing: what is done must be what was asked about.
   */
  readonly #described = new Map<string, { binding: string | null; at: number }>()

  constructor(options: SignInsOptions) {
    this.#options = options
    this.extension = defineExtension({
      name: "dc.sign-in",
      tools: [this.#tool()],
      sections: [
        section(
          "sign-in",
          () =>
            `When a website in a computer's browser wants you to sign in, use \`${SIGN_IN_TOOL}\`: your workspace keeps logins for that, and one is typed for you without your seeing its password. Where none is saved for the site, the same tool asks the person to save one, in a form and not in the chat. So there is no need to ask anyone for a password, and a password is better not written into a chat or a script, where it stays. If the person would rather do it another way, do it their way.`,
        ),
      ],
    })
  }

  /** The computer a call is for, where it is one with a browser to sign in on. */
  async #target(name: unknown, context: Context): Promise<ComputerTarget | string> {
    const wanted = typeof name === "string" && name.trim() !== "" ? name : undefined
    const target = await this.#options.computer(wanted, context)
    if (typeof target === "string") return target
    if (!isPaired(target.computer) || target.sandbox.use === undefined) {
      return "Signing in happens in a browser on somebody's own computer: one they connected themselves. Name one with `computer`."
    }
    return target
  }

  /** Look, and say what a call with these arguments would do. Nothing is typed or asked here. */
  async #plan(args: { login?: unknown; computer?: unknown }, context: Context): Promise<Plan> {
    const actor = await this.#options.vault().catch(() => undefined)
    if (actor === undefined) {
      return { do: "fail", text: "Saved logins are not available to you here." }
    }
    const target = await this.#target(args.computer, context)
    if (typeof target === "string") return { do: "fail", text: target }
    let front: BrowserFront
    try {
      front = (await target.sandbox.use!("browser", { op: "front" })) as BrowserFront
    } catch (error) {
      return { do: "fail", text: said(error) }
    }
    if (front.url === undefined || front.url === "" || front.url === "about:blank") {
      return {
        do: "fail",
        text: "There is no page open to sign in on. Open the site's sign-in page with the `browser` tool first, then call this again.",
      }
    }
    let logins: SavedLogin[]
    try {
      logins = await vault.list(actor)
    } catch (error) {
      return { do: "fail", text: said(error) }
    }
    let host: string | null = null
    try {
      host = new URL(front.url).hostname
    } catch {
      // Not an address: no login is for it.
    }
    const wanted = typeof args.login === "string" ? args.login.trim() : ""
    if (wanted !== "") {
      const login =
        logins.find((entry) => entry.id === wanted) ??
        logins.find((entry) => entry.name.toLowerCase() === wanted.toLowerCase())
      if (login === undefined) {
        const names = logins.map(named).join(", ")
        return {
          do: "fail",
          text: `There is no saved login called "${wanted}". ${names === "" ? "None is saved yet: leave `login` out, and the person is asked to save one for this site." : `The saved logins are: ${names}.`}`,
        }
      }
      const site = signInSite(front.url, login.sites)
      if (site === null) return { do: "wrong_site", target, login, host }
      return { do: "sign_in", target, login, site, url: front.url }
    }
    const fitting = logins.filter((login) => signInSite(front.url, login.sites) !== null)
    if (fitting.length > 1) {
      return {
        do: "fail",
        text: `More than one saved login is for ${host}: ${fitting.map(named).join(", ")}. Say which with \`login\`.`,
      }
    }
    const [login] = fitting
    if (login === undefined) {
      // A login is typed on https alone, so one is asked for only where it could be used.
      const site = signInSite(front.url, host === null ? [] : [host])
      if (site === null) {
        return {
          do: "fail",
          text: `The page in front (${front.url.slice(0, 200)}) is not one a login can be typed on: it has to be a website reached by https.`,
        }
      }
      return { do: "ask", site }
    }
    return {
      do: "sign_in",
      target,
      login,
      site: signInSite(front.url, login.sites)!,
      url: front.url,
    }
  }

  /**
   * What a call asks to do, for the person who is asked whether it may: which login, as whom,
   * and on which site, read from the browser and not from what the agent said. A yes is for
   * that login on that site alone.
   */
  async describe(call: ToolCall, chatId: string, context: Context): Promise<Described | undefined> {
    if (call.name !== SIGN_IN_TOOL) return undefined
    const args = call.arguments as Record<string, unknown>
    const plan = await this.#plan(args, context)
    const binding = plan.do === "sign_in" ? bindingOf(plan.login.id, plan.site) : null
    const now = Date.now()
    for (const [key, entry] of this.#described) {
      if (now - entry.at > DESCRIBED_MS) this.#described.delete(key)
    }
    this.#described.set(callKey(chatId, args), { binding, at: now })
    if (plan.do !== "sign_in" || binding === null) return { pass: true }
    return {
      title: `Sign in to ${plan.site} as ${plan.login.username}`,
      detail: `Saved login: ${plan.login.name}\nPage: ${plan.url.slice(0, 300)}`,
      binding,
    }
  }

  /**
   * What the call now being done was found to ask for when it was asked about, a moment ago:
   * a login on a site, null for one that was going to type nothing, and undefined for a call
   * nobody had to be asked about.
   */
  #askedAbout(chatId: string, args: Record<string, unknown>): string | null | undefined {
    const key = callKey(chatId, args)
    const entry = this.#described.get(key)
    this.#described.delete(key)
    return entry === undefined || Date.now() - entry.at > DESCRIBED_MS ? undefined : entry.binding
  }

  #tool() {
    return defineTool({
      name: SIGN_IN_TOOL,
      description:
        "Sign in on the page in front in a computer's browser, with a login your workspace has saved. You are never shown the password: it is typed for you, and only on the sites that login is for. " +
        "Open the site's sign-in page with `browser` first, then call this. Leave `login` out to use the one saved for that site; where there are several the answer names them, and you say which. " +
        "Where none is saved, the person is asked to save one: a form appears above their message box, what they type never passes through this conversation, and their answer reaches you later as a message. Say what it is for in `purpose`. " +
        "Afterwards look at the page with `browser`. A site may go on to ask for a code or a puzzle, which is the person's to do: tell them, and they can do it in the browser's window.",
      parameters: Type.Object({
        login: Type.Optional(
          Type.String({
            description:
              "The name of the saved login to use. Left out: the one saved for the site in front",
          }),
        ),
        purpose: Type.Optional(
          Type.String({
            description: "What signing in is for, in a sentence, for the person to read",
          }),
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
        const kind = await this.#options.chatKind(chatId, context)
        // Anyone in a Slack workspace can speak to the agent there, and is not whom a login was saved for.
        if (kind === "slack") {
          return fail(
            "A saved login cannot be used from Slack: anyone there can ask, and it was saved for the people of the workspace. Say so, and that it can be done from the app.",
          )
        }
        const asked = this.#askedAbout(chatId, args)
        const plan = await this.#plan(args, context)
        // The page is looked at twice: once to ask a person, and now. If it is no longer the
        // page they were asked about, their yes was not for this.
        if (
          asked !== undefined &&
          plan.do === "sign_in" &&
          asked !== bindingOf(plan.login.id, plan.site)
        ) {
          return fail(
            "The page in front changed while this was being asked about, so nothing was typed. Look at the page with `browser`, and call this again if it is still the one to sign in on.",
          )
        }
        if (plan.do === "fail") return fail(plan.text)
        if (plan.do === "ask") {
          const asks = kind === "chat" || (await this.#options.canAsk?.(chatId, context)) === true
          if (!asks) {
            return fail(
              `No login is saved for ${plan.site}, and only a conversation with a person can ask for one: there has to be someone to type it. Say in your answer that one is needed.`,
            )
          }
          const purpose = typeof args.purpose === "string" ? args.purpose : ""
          const { fresh } = await this.#options.askForLogin(
            {
              chatId,
              purpose: purpose.replace(/\s+/g, " ").trim().slice(0, 300) || null,
              site: plan.site,
            },
            context,
          )
          return {
            output: [
              {
                type: "text",
                text: fresh
                  ? kind === "chat"
                    ? `No login is saved for ${plan.site}, so the person has been asked for one: a form is in front of them, above their message box. Their answer will reach you as a message, which may take a while: do not wait for it or ask again. Tell them in a sentence what you need it for.`
                    : `No login is saved for ${plan.site}, so the person has been asked for one. ${ASKED_THROUGH_MAIN}`
                  : `You have already asked for a login for ${plan.site}, and the person has not answered yet. Do not ask again: the answer will reach you as a message.`,
              },
            ],
          }
        }
        const computer = { id: plan.target.id, name: plan.target.computer.name }
        const details = (
          outcome: SignInDetails["signIn"]["outcome"],
          site: string | null,
        ): SignInDetails => ({
          signIn: {
            computer,
            login: plan.login.name,
            username: plan.login.username,
            site,
            outcome,
          },
        })
        if (plan.do === "wrong_site") {
          return {
            isError: true,
            output: [
              {
                type: "text",
                text: `Nothing was typed. The login ${named(plan.login)} is for ${plan.login.sites.join(", ")}, and the page in front is ${plan.host ?? "not a website"}. If that page claims to be one of those sites, it is not: do not sign in there, and tell the person.`,
              },
            ],
            details: details("wrong_site", plan.host) as unknown as Json,
          }
        }
        const actor = await this.#options.vault()
        if (actor === undefined) return fail("Saved logins are not available to you here.")
        await api.details(details("signing_in", plan.site) as unknown as Json, context)
        const agent = await this.#options.agent(context)
        let password = ""
        let signed: BrowserSignedIn
        try {
          const login = await vault.use(actor, plan.login.id, agent.name)
          password = login.password
          signed = (await plan.target.sandbox.use!("browser", {
            op: "sign_in",
            agent,
            login,
            timeoutMs: DEFAULT_BROWSER_TIMEOUT_MS,
            say: `Signing in to ${plan.site}`,
          })) as BrowserSignedIn
        } catch (error) {
          const text = without(said(error), password)
          return {
            ...fail(error instanceof VaultError ? text : `Signing in could not be tried: ${text}`),
            details: details("failed", plan.site) as unknown as Json,
          }
        }
        const clean = (text: string | undefined) => without(text ?? "", password)
        const site = signed.site ?? plan.site
        if (signed.outcome !== "signed_in" && signed.typed === false) {
          await this.#options.returnPass?.(chatId, bindingOf(plan.login.id, plan.site), context)
        }
        const page =
          signed.url === undefined || signed.url === ""
            ? ""
            : ` The page is now ${clean(signed.url)}${signed.title ? ` “${clean(signed.title)}”` : ""}.`
        const text =
          signed.outcome === "signed_in"
            ? `Signed in to ${site} as ${plan.login.username}.${page} Look at it with \`browser\` before going on: a site may still ask for a code.`
            : `${clean(signed.message) || "It did not sign in."}${page}`
        return {
          ...(signed.outcome === "signed_in" ? {} : { isError: true }),
          output: [{ type: "text", text }],
          details: details(signed.outcome, site) as unknown as Json,
        }
      },
    })
  }
}

/** How long what a call was found to ask for is kept for the doing of it. */
const DESCRIBED_MS = 30_000

/** A call as it is told apart from the others of its chat: by what it asked for. */
const callKey = (chatId: string, args: { login?: unknown; computer?: unknown }) =>
  JSON.stringify([chatId, args.login ?? null, args.computer ?? null])

/** What a yes to one sign-in is a yes to: this login, on this site. */
export const bindingOf = (loginId: string, site: string) => `sign_in:${loginId}@${site}`
