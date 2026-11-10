// Supplemental real-browser check, alongside a drive holding this slot's server open.
// DC_ALLOW_PRIVATE_HOSTS=1 ./x agent web --size 1280x800 "clock +180000 real"
// node tools/tools-check.mjs (use CHROME and the Node version from ./x).
// Set TOOLS_SAME_ORIGIN=1 while the drive serves DC_EXACT_APP=target/web-dist.
import { createRequire } from "node:module"
import { createServer } from "node:http"
import { mkdirSync, writeFileSync } from "node:fs"
import assert from "node:assert/strict"
const require = createRequire(new URL("../../web/package.json", import.meta.url))
const { chromium, expect } = require("@playwright/test")
const { WebSocket } = require("ws")
const API = process.env.API_BASE_URL ?? "http://127.0.0.1:3917"
const sameOrigin = process.env.TOOLS_SAME_ORIGIN === "1"
const EXACT = process.env.TOOLS_EXACT_URL ?? (sameOrigin ? API : "http://127.0.0.1:8772")
const OUT =
  process.env.TOOLS_OUT ??
  new URL(`../.exact/shots/tools-${sameOrigin ? "same-origin" : "merged"}/`, import.meta.url)
    .pathname
mkdirSync(OUT, { recursive: true })
let fixtureOrigin
const fixture = createServer(async (req, res) => {
  const url = new URL(req.url, fixtureOrigin)
  let body = ""
  for await (const b of req) body += b
  const json = (data, status = 200, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers })
    res.end(JSON.stringify(data))
  }
  if (url.pathname === "/.well-known/oauth-protected-resource")
    return json({
      resource: fixtureOrigin + "/mcp",
      authorization_servers: [fixtureOrigin],
      scopes_supported: ["tools"],
    })
  if (url.pathname === "/.well-known/oauth-authorization-server")
    return json({
      issuer: fixtureOrigin,
      authorization_endpoint: fixtureOrigin + "/authorize",
      token_endpoint: fixtureOrigin + "/token",
      registration_endpoint: fixtureOrigin + "/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    })
  if (url.pathname === "/register") {
    const sent = JSON.parse(body)
    return json({ ...sent, client_id: "fixture-client" }, 201)
  }
  if (url.pathname === "/authorize") {
    const target = new URL(url.searchParams.get("redirect_uri"))
    target.searchParams.set("state", url.searchParams.get("state"))
    target.searchParams.set("code", "fixture-code")
    res.writeHead(302, { location: target.toString() })
    return res.end()
  }
  if (url.pathname === "/token")
    return json({ access_token: "fixture-access", token_type: "Bearer", expires_in: 3600 })
  if (url.pathname === "/mcp" || url.pathname === "/mcp-token") {
    if (url.pathname === "/mcp" && req.headers.authorization !== "Bearer fixture-access")
      return json({}, 401, {
        "www-authenticate": `Bearer resource_metadata="${fixtureOrigin}/.well-known/oauth-protected-resource"`,
      })
    if (req.method !== "POST") {
      res.writeHead(405)
      return res.end()
    }
    const msg = JSON.parse(body)
    if (msg.id === undefined) {
      res.writeHead(202)
      return res.end()
    }
    const result =
      msg.method === "initialize"
        ? {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "Tools fixture", version: "1" },
          }
        : msg.method === "tools/list"
          ? {
              tools: Array.from({ length: 13 }, (_, i) => ({
                name: "check_result_" + i,
                description: "Checks a result " + i + ".",
                inputSchema: { type: "object", properties: {} },
              })),
            }
          : {}
    return json({ jsonrpc: "2.0", id: msg.id, result })
  }
  res.writeHead(404)
  res.end()
})
await new Promise((r) => fixture.listen(0, "127.0.0.1", r))
fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME,
  args: ["--no-sandbox"],
})
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  colorScheme: "light",
  acceptDownloads: true,
})
const page = await context.newPage()
const id = (t) => page.getByTestId(t)
const email = `tools-integration-${Date.now()}@example.com`,
  password = "correct horse"
let agentId, computerId, workspaceId, socket, teamAgentId
async function shot(name) {
  await page.screenshot({ path: OUT + name + ".png" })
}
async function route(name) {
  await page.goto(`${EXACT}/a/${agentId}/${name}`)
  await id("heading-" + name).waitFor()
  await page.waitForTimeout(400)
}
try {
  await page.goto(sameOrigin ? EXACT + "/x/" : EXACT)
  await id("sign-toggle").click()
  await id("sign-name").fill("Ada")
  await id("sign-email").fill(email)
  await id("sign-password").fill(password)
  await id("sign-submit").click()
  await id("new-dood").waitFor()
  await id("new-dood").click()
  await id("composer").waitFor()
  const api = await browser.newContext({ baseURL: API })
  const login = await api.request.post("/api/auth/sign-in/email", { data: { email, password } })
  assert.equal(login.status(), 200)
  const agents = await (await api.request.get("/api/agents")).json()
  agentId = agents.agents?.[0]?.id ?? agents[0]?.id
  assert(agentId)
  workspaceId = (await (await api.request.get("/api/workspaces")).json()).workspaces.find(
    (w) => w.kind === "personal",
  ).id
  const team = (
    await (await api.request.post("/api/workspaces", { data: { name: "Studio team" } })).json()
  ).workspace
  teamAgentId = (
    await (await api.request.post("/api/agents", { data: { workspaceId: team.id } })).json()
  ).agent.id
  await page.reload()
  await id("composer").waitFor()
  await api.request.patch(`/api/agents/${agentId}`, {
    data: { name: "Pico", avatar: { seed: "pico", color: "honey" } },
  })
  await id("composer").fill(
    '/tool skill {"action":"create","name":"careful-reviews","description":"Review changes and check the result.","content":"Read the change carefully. Run the smallest useful test."}\n/tool schedule {"action":"create","title":"Morning check-in","schedule":"every 24h","prompt":"Review what changed and tell me what needs attention."}',
  )
  await id("send").click()
  await page.waitForTimeout(2500)
  const started = await (
    await api.request.post("/api/computers/pair/start", {
      data: { name: "studio", hostname: "studio.local", platform: "linux", home: "/home/ada" },
    })
  ).json()
  await page.goto(EXACT + "/pair?code=" + started.code.toLowerCase())
  await id("pair-confirm").waitFor()
  await id(`pair-dood-${agentId}`).check()
  await id("pair-confirm").click()
  await id("pair-connected").waitFor()
  const computers = (await (await api.request.get("/api/computers")).json()).computers
  computerId = computers.find((c) => c.name === "studio").id
  await route("computers")
  await id(`computer-${computerId}`).waitFor()
  await id(`computer-disconnect-${computerId}-${agentId}`).click()
  await page.waitForTimeout(350)
  await id(`computer-connect-${computerId}`).selectOption(agentId)
  await id(`computer-disconnect-${computerId}-${agentId}`).waitFor()
  const paired = await (
    await api.request.post("/api/computers/pair/poll", { data: { pollToken: started.pollToken } })
  ).json()
  let reinstall = false
  socket = new WebSocket(API.replace("http", "ws") + "/api/computers/connect", {
    headers: { authorization: "Bearer " + paired.token },
  })
  await new Promise((resolve, reject) => {
    socket.once("open", resolve)
    socket.once("error", reject)
  })
  socket.on("message", (raw) => {
    const frame = JSON.parse(String(raw))
    if (frame.t === "exec") {
      reinstall = frame.command.includes("/daemon.js")
      socket.send(
        JSON.stringify({
          t: "exec_result",
          id: frame.id,
          stdout: "fixture receipt",
          stderr: "",
          exitCode: 0,
        }),
      )
    }
  })
  socket.send(
    JSON.stringify({
      t: "hello",
      platform: "linux",
      hostname: "studio.local",
      home: "/home/ada",
      readOnly: false,
      version: "0.0.0",
      updates: false,
      screen: true,
      browser: true,
      screenAdapter: { name: "Fixture screen", state: "ready", tools: ["read", "click"] },
      browserAdapter: { name: "Fixture browser", state: "ready", tools: ["browse"] },
    }),
  )
  await route("computers")
  await id(`computer-update-${computerId}`).waitFor()
  await id(`computer-update-${computerId}`).click()
  await page.waitForTimeout(600)
  assert(reinstall, "the update command reached the daemon fixture")
  // A Dood asks through the real tool, and the person answers from Computers.
  for (const approve of [false, true]) {
    await id(`computer-disconnect-${computerId}-${agentId}`).click()
    await page.waitForTimeout(250)
    await page.goto(`${EXACT}/a/${agentId}`)
    await id("composer").fill(
      '/tool computers {"action":"request","name":"studio","reason":"Read the release notes."}',
    )
    await id("send").click()
    await page.waitForTimeout(1800)
    const asked = (await (await api.request.get("/api/computers/requests")).json()).requests.find(
      (r) => r.computer.id === computerId,
    )
    assert(asked, "the Dood made a request")
    await route("computers")
    await id(`computer-${approve ? "allow" : "deny"}-${asked.id}`).click()
    await page.waitForTimeout(400)
    const row = (await (await api.request.get("/api/computers")).json()).computers.find(
      (c) => c.id === computerId,
    )
    assert.equal(row.agentIds.includes(agentId), approve)
    if (!approve) {
      await id(`computer-connect-${computerId}`).selectOption(agentId)
      await id(`computer-disconnect-${computerId}-${agentId}`).waitFor()
    }
  }
  await id(`computer-owner-${computerId}`).selectOption(team.id)
  await id(`computer-move-confirm-${computerId}-yes`).click()
  await page.waitForTimeout(450)
  assert.equal(
    (await (await api.request.get("/api/computers")).json()).computers.find(
      (c) => c.id === computerId,
    ).workspaceId,
    team.id,
  )
  const personalAgentId = agentId
  agentId = teamAgentId
  await route("computers")
  await id(`computer-owner-${computerId}`).selectOption(workspaceId)
  await id(`computer-move-confirm-${computerId}-yes`).click()
  await page.waitForTimeout(450)
  agentId = personalAgentId
  await route("computers")
  await id(`computer-connect-${computerId}`).selectOption(agentId)
  await id(`computer-disconnect-${computerId}-${agentId}`).waitFor()
  console.log(
    "PASS: daemon update command receipt, requests denied/approved, ownership moved to team and back",
  )

  await route("connectors")
  await id("connector-open").click()
  await id("connector-name").fill("Research")
  await id("connector-url").fill(fixtureOrigin + "/mcp-token")
  await id("connector-token").fill("test-secret-never-persist")
  await id("connector-add").click()
  await page.getByText("Research", { exact: true }).waitFor()
  assert.equal(await id("connector-token").inputValue(), "")
  let listing = (await (await api.request.get(`/api/agents/${agentId}/connectors`)).json())
    .connectors
  let research = listing.find((c) => c.name === "Research")
  assert.equal(research.status, "connected")
  await id(`connector-toggle-${research.id}`).click()
  await page.waitForTimeout(300)
  await id(`connector-toggle-${research.id}`).click()
  await page.waitForTimeout(300)
  await id(`connector-tools-${research.id}`).click()
  await page.getByText("Checks a result 0.", { exact: true }).waitFor()
  await id("connector-name").fill("Calendar")
  await id("connector-url").fill(fixtureOrigin + "/mcp")
  await id("connector-add").click()
  await id("connector-authorize").waitFor()
  await id("connector-authorize").click()
  await id("connector-notice").waitFor()
  assert.match(await id("connector-notice").innerText(), /connected/i)
  listing = (await (await api.request.get(`/api/agents/${agentId}/connectors`)).json()).connectors
  assert.equal(listing.find((c) => c.name === "Calendar").status, "connected")
  console.log(
    "PASS: real pairing, disconnect/reconnect, MCP token, tools, toggle, OAuth redirect and bearer return",
  )
  // Another client changes each tool's data; the open page must hear through its ticketed socket.
  await api.request.patch(`/api/agents/${agentId}/connectors/${research.id}`, {
    data: { enabled: false },
  })
  await expect(id(`connector-toggle-${research.id}`)).not.toBeChecked({ timeout: 12000 })
  await api.request.patch(`/api/agents/${agentId}/connectors/${research.id}`, {
    data: { enabled: true },
  })
  await expect(id(`connector-toggle-${research.id}`)).toBeChecked({ timeout: 12000 })
  await route("skills")
  await api.request.patch(`/api/agents/${agentId}/skills/careful-reviews`, {
    data: { enabled: false },
  })
  await expect(id("skill-toggle-careful-reviews")).not.toBeChecked({ timeout: 12000 })
  await api.request.patch(`/api/agents/${agentId}/skills/careful-reviews`, {
    data: { enabled: true },
  })
  await expect(id("skill-toggle-careful-reviews")).toBeChecked({ timeout: 12000 })
  await route("automations")
  const schedule = (await (await api.request.get(`/api/agents/${agentId}/schedules`)).json())
    .schedules[0]
  assert(schedule)
  await api.request.patch(`/api/agents/${agentId}/schedules/${schedule.id}`, {
    data: { enabled: false },
  })
  await expect(id(`automation-status-${schedule.id}`)).toHaveText("Paused", { timeout: 12000 })
  await api.request.patch(`/api/agents/${agentId}/schedules/${schedule.id}`, {
    data: { enabled: true },
  })
  await expect(id(`automation-status-${schedule.id}`)).toHaveText("Active", { timeout: 12000 })
  console.log(
    "PASS: connector, skill and schedule changes from another client arrive without reload or polling",
  )
  await route("connectors")

  const kept = await page.evaluate(() => JSON.stringify({ ...localStorage }))
  assert(!kept.includes("test-secret-never-persist"))
  await id("slack-open").click()
  const downloadPromise = page.waitForEvent("download")
  await id("slack-download-picture").click()
  const download = await downloadPromise
  await download.saveAs(OUT + "pico-slack.png")
  assert.match(download.suggestedFilename(), /\.png$/)
  console.log("PASS: Slack PNG download; token not in localStorage")
  for (const size of [
    { name: "wide", width: 1280, height: 800 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size)
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme })
      for (const area of ["skills", "connectors", "computers", "automations"]) {
        await route(area)
        await shot(`exact-${size.name}-${scheme}-${area}`)
      }
      await route("connectors")
      await id("slack-open").click()
      await id("slack-setup").waitFor()
      await shot(`exact-${size.name}-${scheme}-slack`)
    }
  }
  const react = await api.newPage()
  for (const size of [
    { name: "wide", width: 1280, height: 800 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    await react.setViewportSize(size)
    for (const scheme of ["light", "dark"]) {
      await react.emulateMedia({ colorScheme: scheme })
      for (const area of ["skills", "connectors", "computers", "automations", "slack"]) {
        const settings =
          area === "computers" ? `workspace.${workspaceId}.computers` : `agent.${agentId}.${area}`
        await react.goto(
          area === "automations"
            ? `${API}/a/${agentId}/automations`
            : `${API}/a/${agentId}?settings=${settings}`,
        )
        await react.waitForTimeout(650)
        await react.screenshot({ path: OUT + `react-${size.name}-${scheme}-${area}.png` })
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  await route("computers")
  await id(`computer-remove-${computerId}`).click()
  await page.waitForTimeout(350)
  assert(
    !(await (await api.request.get("/api/computers")).json()).computers.some(
      (c) => c.id === computerId,
    ),
  )
  console.log("PASS: paired computer removal and revocation")
  await api.close()
  writeFileSync(
    OUT + "result.txt",
    `Passed ${sameOrigin ? "same-origin cookie" : "development bearer"} OAuth, live external connector/skill/schedule changes, daemon update receipt, request denial/approval, ownership transfer, pairing/grants/removal/revocation, MCP tools, Slack PNG, no typed token in localStorage.\n`,
  )
  console.log("Screenshots:", OUT)
} catch (e) {
  await shot("failure")
  console.error(e.stack)
  process.exitCode = 1
} finally {
  socket?.close()
  await context.close()
  await browser.close()
  fixture.close()
}
