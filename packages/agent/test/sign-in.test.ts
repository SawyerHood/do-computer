import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type BrowserIO, createComputerLinkActor, DaemonCore } from "@do-computer/computers"
import { nodeDaemonIO } from "@do-computer/computers/node"
import type {
  ApprovalsState,
  BrowserFront,
  BrowserSignedIn,
  ChatState,
  ChatSummary,
  SecretRequest,
  SignInDetails,
  SignInWith,
  ToolPart,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace, type SocketLike } from "@do-computer/runtime/node"
import { justBashSandbox } from "@do-computer/sandbox"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterAll, describe, expect, it } from "vitest"
import { computerActorName, createAgentActor, createModelAccessActor, vault } from "../src/index.ts"

const PASSWORD = "tr0ub4dor & 3 horses"

const directory = mkdtempSync(join(tmpdir(), "dc-sign-in-"))
const links = new NodeActorNamespace({
  directory: join(directory, "links"),
  blobs: () => fileBlobs(join(directory, "link-blobs")),
  factory: (host) => createComputerLinkActor(host, { updateWaitMs: 50 }),
})
/** The workspaces' own actors, which keep what each saved. */
const workspaces = new NodeActorNamespace({
  directory: join(directory, "workspaces"),
  blobs: () => fileBlobs(join(directory, "workspace-blobs")),
  factory: (host) => createModelAccessActor(host, { providers: () => [], vaultKey: "a key" }),
})
const faux = fauxProvider({
  provider: "test",
  models: [{ id: "model", input: ["text", "image"] }],
  tokensPerSecond: 5_000,
})
const models = createModels()
models.setProvider(faux.provider)
/** Which agents' workspaces keep logins, as their host would answer. */
const having = new Set(["agent-1"])
const agents = new NodeActorNamespace({
  directory: join(directory, "agents"),
  blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
  factory: (host) =>
    createAgentActor(host, {
      models,
      defaultModel: "test/model",
      modelOptions: [
        { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
      ],
      keepAliveMs: 100,
      sandbox: (host) => justBashSandbox({ id: host.name, database: host.sql }),
      computerLinks: links,
      savedLogins: async (agentId) => (having.has(agentId) ? workspaces.get("team") : undefined),
    }),
})
afterAll(async () => {
  await agents.close()
  await links.close()
  await workspaces.close()
})

/** The pretend browser: the page it has in front, what it was handed to sign in with, and how that goes. */
const browser = {
  front: {
    url: "https://github.com/login",
    title: "Sign in to GitHub",
    own: false,
  } as BrowserFront,
  /** Pages it has in front for the next times it is asked, before it is `front` again. */
  next: [] as BrowserFront[],
  handed: [] as SignInWith[],
  outcome: "signed_in" as BrowserSignedIn["outcome"],
  /** Whether it got as far as typing the password. */
  typed: true,
}
const pretendBrowser = {
  run: async () => ({ output: "", shots: [], own: false }),
  view: async (after: number) => ({ active: false, seq: after }),
  hold: async () => {},
  close: async () => {},
  front: async () => browser.next.shift() ?? browser.front,
  signIn: async (_agent: unknown, login: SignInWith): Promise<BrowserSignedIn> => {
    browser.handed.push(login)
    return {
      outcome: browser.outcome,
      message:
        browser.outcome === "signed_in"
          ? ""
          : "The page still asks for a password. It was emptied.",
      site: new URL(browser.front.url!).hostname,
      typed: browser.typed,
      url: "https://github.com/",
      title: "GitHub",
      own: false,
    }
  },
} as unknown as BrowserIO

/** Run a daemon for computer `id`, connected to its link in memory. */
async function startDaemon(id: string, signIn: boolean) {
  const home = mkdtempSync(join(tmpdir(), "dc-laptop-"))
  const listeners: ((data: unknown, binary: boolean) => void)[] = []
  const toDaemon: ((data: string) => void)[] = []
  const like: SocketLike = {
    readyState: 1,
    send: (data) => queueMicrotask(() => toDaemon.forEach((listener) => listener(data))),
    close: () => {},
    on: (event: string, listener: never) => {
      if (event === "message") listeners.push(listener)
      return like
    },
  }
  const audited: Record<string, unknown>[] = []
  const daemon = new DaemonCore(
    {
      ...nodeDaemonIO({ home, audit: (entry) => audited.push(entry), shell: "sh" }),
      browser: pretendBrowser,
    },
    (frame) => {
      queueMicrotask(() => listeners.forEach((listener) => listener(frame, false)))
      return true
    },
  )
  toDaemon.push((data) => daemon.onFrame(data))
  await links.connect(computerActorName(id), like, new Request("http://link/connect"))
  const hello = {
    t: "hello",
    platform: "darwin",
    hostname: id,
    home,
    readOnly: false,
    version: "t",
    jobs: true,
    browser: true,
    ...(signIn ? { signIn: true } : {}),
  }
  listeners.forEach((listener) => listener(JSON.stringify(hello), false))
  daemon.onOpen()
  return { home, audited }
}

const ask = (agent: string, path: string, method = "GET", payload?: unknown) =>
  agents.get(agent).fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )
async function call<T>(agent: string, path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await ask(agent, path, method, payload)
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

/** Wait for the agent to have answered: it is at rest, with more said than before. */
async function settled(agent: string, chatId: string, before: number): Promise<ChatState> {
  const deadline = Date.now() + 8_000
  for (;;) {
    const state = await call<ChatState>(agent, `/chats/${chatId}`)
    if (!state.busy && state.messages.length > before + 1) return state
    if (Date.now() > deadline) throw new Error("run did not finish")
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

async function say(agent: string, chatId: string, text: string): Promise<ChatState> {
  const before = (await call<ChatState>(agent, `/chats/${chatId}`)).messages.length
  await call(agent, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  return settled(agent, chatId, before)
}

/** Do `act`, which gives the agent a turn of its own, and wait for it to have taken it. */
async function after(agent: string, chatId: string, act: () => Promise<unknown>) {
  const before = (await call<ChatState>(agent, `/chats/${chatId}`)).messages.length
  await act()
  return settled(agent, chatId, before - 1)
}

const tools = (state: ChatState) =>
  state.messages.flatMap((m) => m.parts).filter((part): part is ToolPart => part.type === "tool")
const signInOf = (part: ToolPart) => (part.details as unknown as SignInDetails | undefined)?.signIn

/** The model asks to sign in, then says a word once it has heard how that went. */
const signsIn = (args: Record<string, unknown> = {}) => [
  fauxAssistantMessage([fauxToolCall("sign_in", { computer: "MacBook", ...args })], {
    stopReason: "toolUse",
  }),
  fauxAssistantMessage("ok"),
]

async function setUp(agent: string, signIn = true) {
  await call(agent, "/init", "POST", { ownerId: "user-1" })
  const chat = await call<ChatSummary>(agent, "/chats", "POST", {})
  const { home, audited } = await startDaemon(`mac-${agent}`, signIn)
  await call(agent, `/computers/mac-${agent}`, "PUT", {
    name: "MacBook",
    platform: "darwin",
    hostname: "mac",
    home,
    readOnly: false,
    pairedAt: 1,
  })
  return { chat, audited }
}

/** Everything the agent keeps and shows of a chat, as one piece of text to look through. */
async function everythingShown(agent: string, chatId: string): Promise<string> {
  return JSON.stringify([
    await call(agent, `/chats/${chatId}`),
    await call(agent, "/approvals"),
    await call(agent, "/secrets"),
  ])
}

describe("signing in with a saved login", () => {
  let chat: ChatSummary

  /** Say no to a request. The agent is told, and has a word to say about it. */
  const refuse = (id: string) => {
    faux.setResponses([fauxAssistantMessage("understood")])
    return after("agent-1", chat.id, () =>
      call("agent-1", `/approvals/${id}`, "POST", { decision: "deny" }),
    )
  }
  let audited: Record<string, unknown>[]
  let githubId = ""

  it("asks first, saying which login and which site as the browser has it", async () => {
    ;({ chat, audited } = await setUp("agent-1"))
    const saved = await vault.save(
      workspaces.get("team"),
      { name: "GitHub", username: "sawyer@example.com", password: PASSWORD, sites: ["github.com"] },
      { id: "user-1", name: "Sawyer" },
    )
    githubId = saved.id

    faux.setResponses(signsIn())
    const [first] = tools(await say("agent-1", chat.id, "open a pull request on my GitHub"))
    expect(first!.status).toBe("error")
    expect(browser.handed).toEqual([])
    const { pending } = await call<ApprovalsState>("agent-1", "/approvals")
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      title: "Sign in to github.com as sawyer@example.com",
      detail: "Saved login: GitHub\nPage: https://github.com/login",
    })
  })

  it("types it once someone says yes, and keeps nothing of the password in the chat", async () => {
    const { pending } = await call<ApprovalsState>("agent-1", "/approvals")
    faux.setResponses(signsIn())
    const state = await after("agent-1", chat.id, () =>
      call("agent-1", `/approvals/${pending[0]!.id}`, "POST", { decision: "once" }),
    )
    // The computer was handed the login, password and all, to type.
    expect(browser.handed).toEqual([
      { name: "GitHub", username: "sawyer@example.com", password: PASSWORD, sites: ["github.com"] },
    ])
    const last = tools(state).at(-1)!
    expect(last.status).toBe("done")
    expect(signInOf(last)).toEqual({
      computer: { id: "mac-agent-1", name: "MacBook" },
      login: "GitHub",
      username: "sawyer@example.com",
      site: "github.com",
      outcome: "signed_in",
    })
    expect(JSON.stringify(last.output)).toContain("Signed in to github.com as sawyer@example.com")
    // Nowhere the agent keeps or shows anything is there a password.
    expect(await everythingShown("agent-1", chat.id)).not.toContain(PASSWORD)
    // What the computer writes down of it is the login's name.
    expect(JSON.stringify(audited)).not.toContain(PASSWORD)
    // The workspace wrote down that it was used, and by whom.
    const [login] = await vault.list(workspaces.get("team"))
    expect(login?.usedAt).toBeTypeOf("number")
  })

  it("takes a yes for one login on one site, and asks again for another", async () => {
    await vault.save(
      workspaces.get("team"),
      {
        name: "Stripe",
        username: "sawyer@example.com",
        password: "another one",
        sites: ["dashboard.stripe.com"],
      },
      undefined,
    )
    // Asked about GitHub, and told yes.
    browser.handed.length = 0
    faux.setResponses(signsIn())
    await say("agent-1", chat.id, "sign in to GitHub again")
    const { pending } = await call<ApprovalsState>("agent-1", "/approvals")
    expect(pending).toHaveLength(1)
    // By the time it tries again, the page in front is another site's.
    browser.front = { url: "https://dashboard.stripe.com/login", title: "Stripe", own: false }
    faux.setResponses(signsIn())
    await after("agent-1", chat.id, () =>
      call("agent-1", `/approvals/${pending[0]!.id}`, "POST", { decision: "once" }),
    )
    expect(browser.handed).toEqual([])
    const again = await call<ApprovalsState>("agent-1", "/approvals")
    expect(again.pending).toHaveLength(1)
    expect(again.pending[0]!.title).toBe("Sign in to dashboard.stripe.com as sawyer@example.com")
    await refuse(again.pending[0]!.id)
    // The yes was for GitHub, and is still good there.
    browser.front = { url: "https://github.com/login", title: "Sign in to GitHub", own: false }
    faux.setResponses(signsIn())
    const last = tools(await say("agent-1", chat.id, "back on GitHub now")).at(-1)!
    expect(last.status).toBe("done")
    expect(browser.handed.map((login) => login.name)).toEqual(["GitHub"])
    // And was for the once.
    faux.setResponses(signsIn())
    await say("agent-1", chat.id, "and again")
    expect(browser.handed).toHaveLength(1)
    const once = await call<ApprovalsState>("agent-1", "/approvals")
    expect(once.pending).toHaveLength(1)
    await refuse(once.pending[0]!.id)
  })

  it("types nothing on a page the login is not for, and asks nobody", async () => {
    browser.handed.length = 0
    browser.front = {
      url: "https://github-settings.example.net/login",
      title: "GitHub",
      own: false,
    }
    faux.setResponses(signsIn({ login: "GitHub" }))
    const last = tools(await say("agent-1", chat.id, "the email says to sign in here")).at(-1)!
    expect(last.status).toBe("error")
    expect(signInOf(last)).toMatchObject({
      outcome: "wrong_site",
      site: "github-settings.example.net",
    })
    expect(JSON.stringify(last.output)).toContain("Nothing was typed")
    expect(browser.handed).toEqual([])
    expect((await call<ApprovalsState>("agent-1", "/approvals")).pending).toEqual([])
    // A page that is not reached by https is not one either, whatever it is called.
    browser.front = { url: "http://github.com/login", title: "GitHub", own: false }
    faux.setResponses(signsIn({ login: "GitHub" }))
    const plain = tools(await say("agent-1", chat.id, "and here")).at(-1)!
    expect(signInOf(plain)?.outcome).toBe("wrong_site")
    expect(browser.handed).toEqual([])
    browser.front = { url: "https://github.com/login", title: "Sign in to GitHub", own: false }
  })

  it("no longer asks once someone has said always", async () => {
    browser.handed.length = 0
    faux.setResponses(signsIn())
    await say("agent-1", chat.id, "sign in")
    const { pending } = await call<ApprovalsState>("agent-1", "/approvals")
    faux.setResponses(signsIn())
    await after("agent-1", chat.id, () =>
      call("agent-1", `/approvals/${pending[0]!.id}`, "POST", { decision: "always" }),
    )
    expect(browser.handed).toHaveLength(1)
    faux.setResponses(signsIn())
    const last = tools(await say("agent-1", chat.id, "and once more")).at(-1)!
    expect(last.status).toBe("done")
    expect(browser.handed).toHaveLength(2)
    await call("agent-1", "/approvals/rules", "PATCH", { "tool:sign_in": "ask" })
  })

  it("says so where the page still asks afterwards, and the answer has no password in it", async () => {
    await call("agent-1", "/approvals/rules", "PATCH", { "tool:sign_in": "allow" })
    browser.outcome = "still_asking"
    faux.setResponses(signsIn())
    const last = tools(await say("agent-1", chat.id, "try again")).at(-1)!
    browser.outcome = "signed_in"
    expect(last.status).toBe("error")
    expect(signInOf(last)?.outcome).toBe("still_asking")
    expect(JSON.stringify(last.output)).toContain("still asks for a password")
    expect(await everythingShown("agent-1", chat.id)).not.toContain(PASSWORD)
    await call("agent-1", "/approvals/rules", "PATCH", { "tool:sign_in": "ask" })
  })

  it("does not ask again where a yes was spent on an attempt that typed no password", async () => {
    // In a chat of its own: a yes is for the chat it was asked in.
    const here = await call<ChatSummary>("agent-1", "/chats", "POST", {})
    browser.handed.length = 0
    faux.setResponses(signsIn())
    await say("agent-1", here.id, "sign in")
    const { pending } = await call<ApprovalsState>("agent-1", "/approvals")
    expect(pending).toHaveLength(1)
    // The page had no form yet: the computer was handed the login, and typed nothing of it.
    browser.outcome = "no_form"
    browser.typed = false
    faux.setResponses(signsIn())
    const state = await after("agent-1", here.id, () =>
      call("agent-1", `/approvals/${pending[0]!.id}`, "POST", { decision: "once" }),
    )
    expect(signInOf(tools(state).at(-1)!)?.outcome).toBe("no_form")
    // Once the form is there, the same yes still holds.
    browser.outcome = "signed_in"
    browser.typed = true
    faux.setResponses(signsIn())
    const last = tools(await say("agent-1", here.id, "the form is there now")).at(-1)!
    expect(last.status).toBe("done")
    expect(browser.handed).toHaveLength(2)
    expect((await call<ApprovalsState>("agent-1", "/approvals")).pending).toEqual([])

    // One that was typed and did not get in has used its yes up.
    faux.setResponses(signsIn())
    await say("agent-1", here.id, "sign in")
    const next = await call<ApprovalsState>("agent-1", "/approvals")
    browser.outcome = "still_asking"
    faux.setResponses(signsIn())
    await after("agent-1", here.id, () =>
      call("agent-1", `/approvals/${next.pending[0]!.id}`, "POST", { decision: "once" }),
    )
    browser.outcome = "signed_in"
    browser.handed.length = 0
    faux.setResponses(signsIn())
    await say("agent-1", here.id, "try once more")
    expect(browser.handed).toEqual([])
    const again = await call<ApprovalsState>("agent-1", "/approvals")
    expect(again.pending).toHaveLength(1)
    faux.setResponses([fauxAssistantMessage("understood")])
    await after("agent-1", here.id, () =>
      call("agent-1", `/approvals/${again.pending[0]!.id}`, "POST", { decision: "deny" }),
    )
  })

  it("types nothing where the page changed between the asking and the doing", async () => {
    const here = await call<ChatSummary>("agent-1", "/chats", "POST", {})
    browser.handed.length = 0
    faux.setResponses(signsIn())
    await say("agent-1", here.id, "sign in")
    const { pending } = await call<ApprovalsState>("agent-1", "/approvals")
    expect(pending[0]!.title).toBe("Sign in to github.com as sawyer@example.com")
    // They say yes to GitHub. As the Dood tries again the page is GitHub's when it is looked at
    // to see whether that was said yes to, and Stripe's a moment later when it comes to typing.
    const stripe = { url: "https://dashboard.stripe.com/login", title: "Stripe", own: false }
    faux.setResponses([
      () => {
        browser.next = [browser.front, stripe]
        return signsIn()[0]!
      },
      fauxAssistantMessage("ok"),
    ])
    const state = await after("agent-1", here.id, () =>
      call("agent-1", `/approvals/${pending[0]!.id}`, "POST", { decision: "once" }),
    )
    const last = tools(state).at(-1)!
    expect(last.status).toBe("error")
    expect(JSON.stringify(last.output)).toContain("changed while this was being asked about")
    expect(browser.handed).toEqual([])
    expect(browser.next).toEqual([])
  })

  it("asks the person to save a login where there is none, and uses it without asking twice", async () => {
    browser.handed.length = 0
    browser.front = { url: "https://vercel.com/login", title: "Vercel", own: false }
    faux.setResponses(signsIn({ purpose: "To see why the deploy failed." }))
    const asked = tools(await say("agent-1", chat.id, "why did the deploy fail?")).at(-1)!
    expect(asked.status).toBe("done")
    expect(JSON.stringify(asked.output)).toContain("the person has been asked for one")
    const { requests } = await call<{ requests: SecretRequest[] }>("agent-1", "/secrets")
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      purpose: "To see why the deploy failed.",
      destination: { kind: "login", site: "vercel.com" },
      fields: [{ name: "username" }, { name: "password" }],
    })
    // Nobody has been asked whether a login may be used: there is none yet.
    expect((await call<ApprovalsState>("agent-1", "/approvals")).pending).toEqual([])

    // The person types it into the form. The agent is told, and signs in.
    faux.setResponses(signsIn())
    const state = await after("agent-1", chat.id, () =>
      call("agent-1", `/secrets/${requests[0]!.id}`, "POST", {
        values: { username: "sawyer", password: "vercel-pass-123" },
        sites: ["vercel.com", "app.vercel.com"],
      }),
    )
    expect(browser.handed).toEqual([
      {
        name: "vercel.com",
        username: "sawyer",
        password: "vercel-pass-123",
        sites: ["vercel.com", "app.vercel.com"],
      },
    ])
    // They were not asked a second time for what they had just typed it for.
    expect((await call<ApprovalsState>("agent-1", "/approvals")).pending).toEqual([])
    expect(tools(state).at(-1)!.status).toBe("done")
    const shown = await everythingShown("agent-1", chat.id)
    expect(shown).not.toContain("vercel-pass-123")
    expect(shown).toContain('"detail":"a login for vercel.com"')

    // That was a pass for the once. The next time, they are asked.
    browser.handed.length = 0
    faux.setResponses(signsIn())
    await say("agent-1", chat.id, "sign in to Vercel again")
    expect(browser.handed).toEqual([])
    const { pending } = await call<ApprovalsState>("agent-1", "/approvals")
    expect(pending).toHaveLength(1)
    await refuse(pending[0]!.id)
    browser.front = { url: "https://github.com/login", title: "Sign in to GitHub", own: false }
  })

  it("names the logins there are when it is asked for one there is not", async () => {
    faux.setResponses(signsIn({ login: "Gitlab" }))
    const last = tools(await say("agent-1", chat.id, "use my gitlab login")).at(-1)!
    expect(last.status).toBe("error")
    const text = JSON.stringify(last.output)
    expect(text).toContain('no saved login called \\"Gitlab\\"')
    expect(text).toContain("GitHub")
    expect(text).not.toContain(PASSWORD)
  })

  it("finds a login by its id as well as its name", async () => {
    await call("agent-1", "/approvals/rules", "PATCH", { "tool:sign_in": "allow" })
    browser.handed.length = 0
    faux.setResponses(signsIn({ login: githubId }))
    await say("agent-1", chat.id, "sign in")
    expect(browser.handed[0]?.name).toBe("GitHub")
    await call("agent-1", "/approvals/rules", "PATCH", { "tool:sign_in": "ask" })
  })

  it("lists signing in among what a rule can be set for, asking first unless told otherwise", async () => {
    const state = await call<ApprovalsState>("agent-1", "/approvals")
    expect(state.subjects.map((subject) => subject.id)).toContain("tool:sign_in")
    expect(state.rules["tool:sign_in"]).toBe("ask")
  })
})

describe("an agent whose workspace keeps no logins", () => {
  it("is not told of signing in at all, and has no such tool", async () => {
    const { chat } = await setUp("agent-2")
    /** What a model is told before anything is said, as one piece of text. */
    const toldTo = async (agent: string, chatId: string) => {
      let told = ""
      faux.setResponses([
        (context) => {
          told = JSON.stringify(context.messages.filter((message) => message.role !== "user"))
          return fauxAssistantMessage("hello")
        },
      ])
      await say(agent, chatId, "hello")
      return told
    }
    const told = await toldTo("agent-2", chat.id)
    expect(told).toContain("`browser`")
    expect(told).not.toContain("sign_in")
    // An agent whose workspace does keep them is told.
    const other = await call<ChatSummary>("agent-1", "/chats", "POST", {})
    expect(await toldTo("agent-1", other.id)).toContain("`sign_in`")

    // Asking for it anyway comes to nothing, and nothing is looked up or typed.
    browser.handed.length = 0
    faux.setResponses(signsIn())
    const last = tools(await say("agent-2", chat.id, "sign in")).at(-1)!
    expect(last.status).toBe("error")
    expect(browser.handed).toEqual([])
    const state = await call<ApprovalsState>("agent-2", "/approvals")
    expect(state.pending).toEqual([])
    expect(state.subjects.map((subject) => subject.id)).not.toContain("tool:sign_in")
    expect(state.rules["tool:sign_in"]).toBeUndefined()
  })
})

describe("a computer whose program is from before signing in", () => {
  it("is not sent a login, and the agent is told why", async () => {
    having.add("agent-3")
    const { chat } = await setUp("agent-3", false)
    browser.handed.length = 0
    faux.setResponses(signsIn())
    const last = tools(await say("agent-3", chat.id, "sign in")).at(-1)!
    expect(last.status).toBe("error")
    expect(JSON.stringify(last.output)).toContain("too old")
    expect(browser.handed).toEqual([])
  })
})
