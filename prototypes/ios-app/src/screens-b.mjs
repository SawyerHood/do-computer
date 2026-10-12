// An agent's own page, its wardrobe, the library, automations, settings and getting in.
import { fileURLToPath } from "node:url"
import { GH, GOOGLE, back, cre, face, gb, ic, keyboard, menu, nav, phone, picture, row, sect, seg, who } from "./kit.mjs"

const pick = (v) => `<span class="v" style="display:flex;align-items:center;gap:3px">${v}<svg class="ic" width="12" height="16" viewBox="0 0 12 16" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round"><path d="m3 6 3-3 3 3M3 10l3 3 3-3"/></svg></span>`
const lt = (t, small) => `<h1 class="lt" style="margin-top:50px">${t}${small ? `<small>${small}</small>` : ""}</h1>`
const grey = (inner, navHtml) => `<div class="body">${inner}</div><div class="fade-top gr"></div>${navHtml}`
const mid = (t) => t

/* ---------- the agent's page ---------- */
const apple = `<svg class="ic" width="26" height="26" viewBox="0 0 24 24"><path d="M12 7.500c-2-1.600-6.500-1-6.500 4 0 4 2.500 8 4.500 8 .900 0 1.300-.500 2-.500s1.100.500 2 .500c2 0 4.500-4 4.500-8 0-5-4.500-5.600-6.500-4z" fill="#e5484d"/><path d="M12 7.500c0-1.500.600-2.800 2-3.500" stroke="#7a4a1c" stroke-width="1.600" fill="none" stroke-linecap="round"/><path d="M12.500 5.500c1-1.800 3-2 4-1.500-.500 1.500-2 2.300-4 1.500z" fill="#2f9e63"/></svg>`
const care = (n) =>
  `<div style="display:flex;gap:10px;justify-content:center;margin-top:12px"><span class="btn s line" style="height:44px;border-radius:22px;padding:0 16px 0 12px">${apple}Treat</span>` +
  `<span class="btn s line" style="height:44px;border-radius:22px;padding:0 16px 0 12px;color:var(--a)">${ic("gift", 24)}<span style="color:var(--ink)">Box</span><span class="pill go">${n}</span></span>` +
  `<span class="btn s line" style="height:44px;border-radius:22px;padding:0 16px 0 12px">${ic("hanger", 24)}Wardrobe</span></div>`
const hearts = `<span style="position:absolute;right:92px;top:8px;color:#e5647c;opacity:.9">${ic("heart", 22, 0).replace('fill="none"', 'fill="currentColor"')}</span><span style="position:absolute;right:76px;top:38px;color:#e5647c;opacity:.55">${ic("heart", 15, 0).replace('fill="none"', 'fill="currentColor"')}</span>`
const quick = (items) => `<div class="quick">${items.map(([i, t]) => `<div>${ic(i, 26)}<span style="color:var(--ink)">${t}</span></div>`).join("")}</div>`
const G1 = phone(
  grey(
    `<div class="hero" style="position:relative;padding-top:4px">${hearts}${cre("juniperHero", 196)}<h2>Juniper</h2><p>Research and writing · Personal</p>${care(2)}</div>` +
      quick([["chats", "Side chats"], ["folder", "Library"], ["clock", "Automations"]]) +
      sect("At work now", [
        row({ lead: `<span class="spin" style="margin:0 7px"></span>`, t: "2 sub-agents", s: "Status page, Email list", go: 1 }),
        row({ sq: ["term", "#4b5559"], t: "1 command in the background", s: "pnpm test --filter web · 4m", go: 1 }),
        row({ sq: ["desktop", "#2f7fd6"], t: "Using the MacBook Air", s: "Screen and browser", tail: `<span class="pill go">Live</span>`, go: 1 }),
      ]),
    nav(back(), "", gb(ic("dots", 22))),
  ),
  { agent: "juniper" },
)
const G2 = phone(
  grey(
    sect("In the main chat", [
      row({ sq: ["clip", "#8a6fd1"], t: "Shared here", v: "3 files", go: 1 }),
      row({ sq: ["list", "#4b5559"], t: "What it did", v: "12 steps", go: 1 }),
      row({ sq: ["people", "#c0607a"], t: "From other agents", v: "1", go: 1 }),
      row({ sq: ["hash", "#611f69"], t: "From Slack", v: "2", go: 1 }),
      row({ t: "Start fresh", cls: "tint" }),
    ], "Start fresh drops the earlier conversation and keeps what Juniper remembers.") +
      sect("Juniper", [
        row({ sq: ["person", "#b87a12"], t: "Profile", s: "Name, look and personality", go: 1 }),
        row({ sq: ["brain", "#d0577b"], t: "Memory", go: 1 }),
        row({ sq: ["cpu", "#2f7fd6"], t: "Model and computers", go: 1 }),
        row({ sq: ["bolt", "#e2a400"], t: "Skills", v: "7", go: 1 }),
        row({ sq: ["plug", "#2f9e63"], t: "Connectors", v: "Gmail, Slack +1", go: 1 }),
        row({ sq: ["shield", "#127a78"], t: "Permissions", go: 1 }),
        row({ sq: ["chart", "#6b7780"], t: "Usage", v: "$4.12", go: 1 }),
      ]) +
      sect("", [row({ t: "Delete Juniper", cls: "red" })]),
    nav(back(), mid("Juniper"), gb(ic("dots", 22))),
  ),
  { agent: "juniper" },
)
const G3 = phone(
  grey(
    sect("What it can do", [
      row({ t: "Run commands", tail: pick("Allow") }),
      row({ t: "Create and change files", tail: pick("Allow") }),
      row({ t: "Send you files", tail: pick("Allow") }),
      row({ t: "Share files with the workspace", tail: pick("Allow") }),
      row({ t: "Make shared files public", tail: pick("Ask first") }),
    ], "With Ask first it stops, says what it wants to do, and waits for your answer in the chat or on the lock screen.") +
      sect("Connectors", [row({ t: "Gmail", tail: pick("Ask first") }), row({ t: "Slack", tail: pick("Ask first") }), row({ t: "Linear", tail: pick("Allow") })]) +
      sect("Your computers", [row({ t: "MacBook Air", s: "Run commands, screen, browser", tail: pick("Ask first") }), row({ t: "Studio Mac", s: "Only read files", tail: pick("Never") })]) +
      menu([["Allow", ""], ["Ask first", "check"], ["Never", ""]], "right:20px;top:372px;width:200px"),
    nav(back(), mid("Permissions"), ""),
  ),
  { agent: "juniper" },
)
const G4 = phone(
  grey(
    sect("Model", [row({ t: "Model", v: "Claude Sonnet 5.5", go: 1 }), `<div class="row" style="flex-direction:column;align-items:stretch;gap:8px;padding:11px 16px 13px"><b style="font-weight:400">Thinking</b>${seg(["Off", "Low", "Medium", "High"], 2)}</div>`], "Sign-ins to model providers are the workspace’s.") +
      sect("While it works", [row({ t: "Wait until it has finished", sw: false })], "Off, what you send is read at its next step. On, it waits its turn.") +
      sect("Computers it can use", [
        row({ sq: ["desktop", "#2f7fd6"], t: "MacBook Air", s: "Yours · screen · browser", tail: `<span class="pill ok">Online</span>` }),
        row({ sq: ["term", "#4b5559"], t: "computer", s: "Built-in shell", tail: `<span class="pill ok">Online</span>` }),
        row({ t: "Connect another…", cls: "tint" }),
      ]),
    nav(back(), mid("Model and computers"), ""),
  ),
  { agent: "juniper" },
)

/* ---------- the wardrobe ---------- */
const RAR = { common: "#9aa4a6", uncommon: "#4fb06a", rare: "#3d8fe0", epic: "#a56be0", legendary: "#f0b545" }
const worn = (key, name, r, on) => `<div class="tile${on ? " on" : ""}" style="--r:${RAR[r]}">${cre(key, 72)}${name}<i></i></div>`
const unfound = (r) => `<div class="tile un" style="--r:${RAR[r]}"><b>?</b><i></i></div>`
const W1 = phone(
  grey(
    `<div class="hero" style="padding-top:0"><div style="display:flex;align-items:flex-end;justify-content:center;gap:6px"><span style="padding-bottom:30px">${apple.replace('width="26" height="26"', 'width="46" height="46"')}</span>${cre("juniperHero", 176)}<span style="padding-bottom:28px;color:var(--a);position:relative">${ic("gift", 48, 1.500)}<span class="pill" style="position:absolute;top:-6px;right:-10px;background:var(--a);color:#fff">2</span></span></div><h2 style="font-size:24px">Juniper</h2><p>12 of 200 found · next box in 7 hours</p></div>` +
      `<div style="margin:0 16px 14px">${seg(["Hats 5/81", "Glasses 3/40", "Face 2/40", "Neck 2/39"], 0)}</div>` +
      `<div class="tiles">${worn("juniperBare", "Nothing", "common")}${worn("w_wizard", "Wizard hat", "rare", true)}${worn("w_party", "Party hat", "common")}${worn("w_tophat", "Top hat", "uncommon")}${worn("w_crown", "Crown", "epic")}${worn("w_frog", "Frog hood", "uncommon")}${unfound("common")}${unfound("common")}${unfound("rare")}</div>` +
      `<div class="rar">${Object.entries(RAR).map(([k, c]) => `<span style="--r:${c}">${k[0].toUpperCase() + k.slice(1)}</span>`).join("")}</div>`,
    nav(back(), "", ""),
  ),
  { agent: "juniper" },
)
const rays = Array.from({ length: 12 }, (_, i) => `<i style="position:absolute;left:50%;top:50%;width:560px;height:46px;margin:-23px 0 0 -280px;background:linear-gradient(90deg,transparent,rgba(120,180,255,.16) 35%,rgba(120,180,255,.16) 65%,transparent);transform:rotate(${i * 15}deg);display:block"></i>`).join("")
const W2 = phone(
  `<div class="body" style="background:radial-gradient(90% 60% at 50% 38%,#254a86 0%,#14213f 55%,#0a0e1a 100%);padding-top:0"><div style="position:absolute;left:0;right:0;top:120px;height:420px;overflow:hidden">${rays}</div>` +
    `<div style="position:absolute;left:0;right:0;top:176px;text-align:center;color:#fff">${cre("w_wizard", 260, "margin:0 auto")}` +
    `<span class="pill" style="background:#3d8fe0;color:#fff;font-size:13px;padding:4px 12px;letter-spacing:.06em">RARE</span><h2 style="font-size:32px;font-weight:700;letter-spacing:-.02em;margin-top:10px">Wizard hat</h2><p style="opacity:.7;margin-top:4px;font-size:16px">A hat · 13 of 200 found</p></div>` +
    `<div style="position:absolute;left:20px;right:20px;bottom:54px;display:grid;gap:10px"><span class="btn" style="background:#fff;color:#14213f">Wear it</span><span class="btn" style="background:rgba(255,255,255,.14)">Keep it for later</span><span style="text-align:center;color:#fff;opacity:.8;font-size:16px;padding-top:6px">Open another · 1 waiting</span></div></div>` +
    nav(gb(ic("x", 20, 2.200), "g"), "", ""),
  { agent: "juniper", dark: true, white: true, keep: true },
)

/* ---------- the library ---------- */
const fold = (name, n, shared) => row({ lead: `<span style="color:var(--tint);margin:0 3px">${ic("folder", 26, 1.700).replace('fill="none"', 'fill="currentColor" fill-opacity=".18"')}</span>`, t: name, v: (shared ? `<span style="display:inline-flex;vertical-align:-4px;margin-right:6px;color:var(--tint)">${ic("link", 17, 2)}</span>` : "") + n, go: 1 })
const file = (name, meta, shared) => row({ lead: `<span style="color:var(--ink2);margin:0 3px">${ic("doc", 26, 1.500)}</span>`, t: name, s: meta, tail: shared ? `<span style="color:var(--tint)">${ic("link", 18, 2)}</span>` : "" })
const searchBar = (hint) => `<div class="fade-bot gr"></div><div class="bar"><div class="srch g">${ic("search", 20, 2)}<span style="flex:1">${hint}</span></div></div>`
const L1 = phone(
  `<div class="body lg">${nav(back(), "", gb(ic("plus", 22, 2)) + gb(ic("dots", 22)))}${lt("Library", "Personal · Juniper, Moss and Otto share it")}` +
    sect("", [fold("notes", "1"), fold("pricing", "2", true), file("numbers.csv", "918 B · Juniper · today"), file("q3-plans.pdf", "1.2 MB · you · yesterday")]) +
    sect("Shared with a link", [row({ sq: ["globe", "#127a78"], t: "Pricing relaunch plan", s: "Anyone with the link", go: 1 }), row({ sq: ["people", "#6b7780"], t: "pricing", s: "People in Personal", go: 1 })]) +
    sect("", [row({ sq: ["trash", "#8b949a"], t: "Recently deleted", v: "2", go: 1 })]) +
    `</div>${searchBar("Filter files")}`,
  { agent: "juniper" },
)
const docBody =
  `<div class="doc"><h1>Pricing page relaunch</h1><p>The redesign lifted visits and hurt sign-ups. This is the plan to get both.</p>` +
  `<h2>What changes</h2><ul><li>The three plans go back in one row.</li><li>The Team card gets its old button.</li></ul>` +
  `<h2>Numbers to watch</h2><table><tr><th>Measure</th><th>Before</th><th>Now</th><th>Goal</th></tr><tr><td>Visits a month</td><td>14,950</td><td>18,240</td><td>18,000</td></tr><tr><td>Sign-up rate</td><td>4.1%</td><td>3.4%</td><td>4.5%</td></tr><tr><td>Team plan clicks</td><td>17%</td><td>9%</td><td>18%</td></tr></table>` +
  `<h2>Steps</h2><div class="tk"><i class="on">${ic("check", 14, 3)}</i>Pull thirty days of analytics</div><div class="tk"><i class="on">${ic("check", 14, 3)}</i>Draft the new Team copy</div><div class="tk"><i></i>Build the one-row layout</div><div class="tk"><i></i>Run it against the old page</div></div>`
const docBar = `<div class="fade-bot"></div><div class="bar" style="justify-content:space-between"><div class="g" style="border-radius:24px;padding:5px;width:170px">${seg(["Read", "Edit"], 0).replace('class="seg"', 'class="seg" style="background:transparent;font-size:15px"')}</div>${gb(ic("history", 22) + ic("share", 22), "")}</div>`
const docNav = nav(back(), `<span style="text-align:center;line-height:1.15;display:block">plan.md<small style="display:block;font-size:12px;font-weight:400;color:var(--ink2)">pricing · saved</small></span>`, gb(ic("dots", 22)))
const L2 = phone(`<div class="body" style="padding-top:112px">${docBody}</div><div class="fade-top"></div>${docNav}${docBar}`, { page: true, agent: "juniper" })
const radio = (on) => `<span style="width:24px;height:24px;border-radius:12px;display:grid;place-items:center;flex:none;${on ? "background:var(--tint);color:#fff" : "box-shadow:inset 0 0 0 1.500px var(--ink3)"}">${on ? ic("check", 15, 3) : ""}</span>`
const L3 = phone(
  `<div class="body" style="padding-top:112px">${docBody}</div><div class="fade-top"></div>${docNav}<div class="scrim"></div>` +
    `<div class="sheet" style="height:560px"><div class="grab"></div><div class="sh"><b>Share plan.md</b><span></span>${gb(ic("x", 20, 2.200))}</div>` +
    sect("", [row({ t: "Share with a link", sw: true }), row({ lead: `<span style="color:var(--tint)">${ic("link", 22, 2)}</span>`, t: `<span class="mono" style="font-size:15px">do.computer/s/k3v9p</span>`, tail: `<span class="btn s q">Copy</span>` })]) +
    sect("Who can open it", [row({ t: "People in Personal", s: "They sign in first", tail: radio(false) }), row({ t: "Anyone with the link", s: "No sign-in needed", tail: radio(true) })]) +
    `<div style="margin:0 16px;display:grid;gap:10px"><span class="btn">${ic("share", 20, 2)}Send the link…</span><span class="btn q" style="color:var(--red)">Stop sharing</span></div></div>`,
  { page: true, agent: "juniper" },
)
const fmt = `<div class="g" style="position:absolute;left:10px;right:10px;bottom:301px;z-index:47;height:46px;border-radius:23px;display:flex;align-items:center;justify-content:space-around;padding:0 8px;font-weight:600">` +
  `<span>B</span><span style="font-style:italic;font-family:Georgia,serif">I</span><span>H</span>${ic("list", 21, 2)}${ic("check", 21, 2.200)}<span class="mono" style="font-size:14px">&lt;/&gt;</span>${ic("link", 21, 2)}</div>`
const L4 = phone(
  `<div class="body" style="padding-top:112px"><pre class="mono" style="margin:0;padding:0 20px;font-size:14px;line-height:1.6;white-space:pre-wrap;color:var(--ink)"><span style="color:var(--tint);font-weight:700"># Pricing page relaunch</span>\n\nThe redesign lifted visits and hurt sign-ups. This is the plan to get both.\n\n<span style="color:var(--tint);font-weight:700">## What changes</span>\n\n- The three plans go back in one row.\n- The Team card gets its old button,\n  <span style="background:var(--fill);border-radius:4px">\`Start free\`</span>.<span style="display:inline-block;width:2px;height:18px;background:var(--tint);vertical-align:-3px"></span></pre></div>` +
    `<div class="fade-top"></div>${nav(back(), `<span style="text-align:center;line-height:1.15;display:block">plan.md<small style="display:block;font-size:12px;font-weight:400;color:var(--ink2)">Not saved</small></span>`, gb("Done", "fill"))}${fmt}${keyboard()}`,
  { page: true, agent: "juniper" },
)

/* ---------- automations ---------- */
const auto = (t, when, last, pill, style = "") =>
  `<div class="row" style="align-items:flex-start;padding:12px 16px;${style}"><div class="t"><b class="w">${t}</b><span>${when}</span>${last ? `<span style="margin-top:5px;color:var(--ink)">${last}</span>` : ""}</div>${pill}</div>`
const swipe =
  `<div style="position:relative;display:flex;align-items:stretch"><div style="flex:1;min-width:0">${auto("Morning inbox", "Daily, 9:00 AM", "", "")}</div><div style="display:flex;font-size:13px;font-weight:600;color:#fff">` +
  [["play", "Run now", "var(--tint)"], ["pause", "Pause", "#8b949a"], ["trash", "Delete", "var(--red)"]].map(([i, t, c]) => `<span style="width:64px;background:${c};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">${ic(i, 22, 2)}${t}</span>`).join("") +
  `</div></div>`
const U1 = phone(
  `<div class="body lg">${nav(back(), "", gb(ic("dots", 22)))}${lt("Automations", "Things Juniper does on its own. To add one, ask in chat.")}` +
    sect("", [
      auto("Pricing page numbers", "Every 6 hours · next 11:23 PM", "2h ago: nothing moved", `<span class="pill go">Running</span>`),
      swipe,
      auto("Friday wrap-up", "Fridays at 4:00 PM", "", `<span class="pill">Paused</span>`),
      auto("Remind me about the contract", "Once, Oct 20 at 10:00 AM", "", `<span class="pill ok">Active</span>`),
    ]) +
    `</div>`,
  { agent: "juniper" },
)
const U2 = phone(
  grey(
    `<h1 class="lt" style="margin-top:6px;font-size:30px">Morning inbox</h1>` +
      sect("", [row({ t: "Active", sw: true }), row({ t: "Schedule", v: "Every day at 9:00 AM" }), row({ t: "Next run", v: "Tomorrow, 9:00 AM" })]) +
      sect("What it is told", [`<div class="row"><div class="t" style="line-height:1.4">Read the inbox and list what needs an answer today.</div></div>`]) +
      sect("Checks first on computer", [`<div class="row"><div class="t mono" style="font-size:14px">gmail unread --since 24h | wc -l</div></div>`], "It only starts Juniper when the check finds something. 5 of the last 7 found nothing.") +
      sect("Runs", [row({ t: "Today, 9:00 AM", s: "3 need an answer", go: 1 }), row({ t: "Yesterday, 9:00 AM", s: "Nothing new, so it did not start", go: 0 }), row({ t: "Run now", cls: "tint" })]),
    nav(back(), "", gb(ic("dots", 22))),
  ),
  { agent: "juniper" },
)

/* ---------- settings ---------- */
const arow = (key, name, s) => row({ lead: cre(key, 34), t: name, s, go: 1 })
const S1 = phone(
  grey(
    sect("", [row({ lead: face("SH", "#127a78", 54), t: `<span style="font-size:20px;font-weight:600;color:var(--ink);margin:0">Sawyer Hood</span>`, s: "sawyer@tidewater.studio · do.computer" })]) +
      sect("", [row({ sq: ["gear", "#8b949a"], t: "General", s: "Appearance and defaults", go: 1 }), row({ sq: ["bell", "#e5484d"], t: "Notifications", v: "On", go: 1 })]) +
      sect("Workspaces", [
        row({ lead: `<span class="sq" style="background:#127a78;font-weight:700;font-size:15px">P</span>`, t: "Personal", s: "Only you · 3 agents", go: 1 }),
        row({ lead: `<span class="sq" style="background:#c0607a;font-weight:700;font-size:15px">T</span>`, t: "Tidewater", s: "Team · 4 people · 3 agents", go: 1 }),
        row({ lead: `<span class="sq" style="background:#7d5a9a;font-weight:700;font-size:15px">N</span>`, t: "Northwind", s: "Priya invited you", tail: `<span class="btn s q">View</span>` }),
        row({ t: "New team", cls: "tint" }),
      ]) +
      sect("Agents", [arow("juniper", "Juniper", "Personal"), arow("moss", "Moss", "Personal"), arow("otto", "Otto", "Personal"), arow("pip", "Pip", "Tidewater")]),
    nav("", mid("Settings"), gb("Done", "t")),
  ),
)
const S2 = phone(
  grey(
    sect("", [row({ t: "Appearance", tail: pick("System") })]) +
      sect("New agents start with", [row({ t: "Model", v: "Claude Sonnet 5.5", go: 1 }), row({ t: "Computer", v: "Built-in shell", go: 1 })], "Agents you already have keep theirs. Change one in its own settings.") +
      sect("Notifications", [row({ t: "Allow notifications", sw: true }), row({ t: "Answer from the lock screen", sw: true }), row({ t: "Send a test", cls: "tint" })], "When an agent answers, asks first, or finishes a scheduled run.") +
      sect("This phone", [row({ t: "Server", v: "do.computer" }), row({ t: "Sign out", cls: "red" })]),
    nav(back(), mid("General"), ""),
  ),
)
const member = (id, name, mail, role) => row({ lead: who(id, 36), t: name, s: mail, tail: role === "Owner" ? `<span class="v">Owner</span>` : pick(role) })
const S3 = phone(
  `<div class="body lg">${nav(back(), "", gb(ic("dots", 22)))}${lt("Tidewater", "Team · 4 people · 3 agents")}` +
    sect("People", [
      member("me", "Sawyer Hood", "sawyer@tidewater.studio", "Owner"),
      member("maya", "Maya Okafor", "maya@tidewater.studio", "Admin"),
      member("jon", "Jon Reyes", "@jreyes", "Member"),
      row({ lead: `<span class="face" style="width:36px;height:36px;background:var(--fill);color:var(--ink2)">${ic("mail", 18, 2)}</span>`, t: "priya@hey.com", s: "Invited 2 days ago", tail: `<span class="btn s q">Copy link</span>` }),
      row({ t: "Invite people", cls: "tint" }),
    ]) +
    sect("", [row({ sq: ["desktop", "#2f7fd6"], t: "Computers", v: "3", go: 1 }), row({ sq: ["spark", "#8a6fd1"], t: "Models", s: "Signed in to Anthropic and OpenAI", go: 1 })]) +
    sect("", [row({ t: "Delete team", cls: "red" })]) +
    `</div>`,
)
const S4 = phone(
  grey(
    `<div class="sect"><div class="grp" style="padding:14px 16px"><div style="display:flex;gap:10px;align-items:center">${cre("otto", 40)}<div style="flex:1"><b style="font-weight:600;display:block">Otto asks to use Studio Mac</b><span style="font-size:14px;color:var(--ink2)">It could only read files there.</span></div></div><div style="display:flex;gap:8px;margin-top:12px"><span class="btn s q" style="flex:1;height:40px;border-radius:20px">Don’t allow</span><span class="btn s" style="flex:1;height:40px;border-radius:20px">Allow</span></div></div></div>` +
      sect("MacBook Air", [
        row({ sq: ["desktop", "#2f7fd6"], t: "studio-macbook-air", s: "macOS · screen · browser", tail: `<span class="pill ok">Online</span>` }),
        row({ t: "Belongs to", tail: pick("Tidewater") }),
        row({ t: "Open to", tail: pick("Chosen agents") }),
        row({ t: "Agents", v: "Juniper, Pip", go: 1 }),
        row({ t: "Update the daemon", cls: "tint" }),
      ]) +
      sect("", [row({ t: "Show the browser agents use", sw: true })], "Agents’ browser opens in a window on the computer, where you can watch.") +
      sect("", [row({ t: "Add a computer", cls: "tint" }), row({ lead: `<span style="color:var(--tint)">${ic("qr", 24)}</span>`, t: "Connect a computer of your own", cls: "tint", go: 1 })], "Sends the install command to your Mac, or confirms the code it shows."),
    nav(back(), mid("Computers"), gb(ic("plus", 22, 2))),
  ),
)

/* ---------- getting in ---------- */
const icon = picture(fileURLToPath(new URL("../../../apps/web/public/icon-192.png", import.meta.url)))
const field = (label, value = "") => `<div class="row"><div class="t" style="display:flex;gap:12px"><span style="width:86px">${label}</span><span style="color:var(--ink3)">${value}</span></div></div>`
const E1 = phone(
  `<div class="body" style="padding:118px 24px 0"><img src="${icon}" alt="" style="width:76px;height:76px;border-radius:18px;display:block;box-shadow:0 6px 18px rgba(0,0,0,.14)"><h2 style="font-size:32px;font-weight:700;letter-spacing:-.02em;margin-top:22px">Welcome back</h2><p style="color:var(--ink2);margin-top:6px">Sign in to pick up where you and your agent left off.</p>` +
    `<div style="display:grid;gap:10px;margin-top:26px"><span class="btn" style="background:var(--ink);color:var(--bg)">${GH}Continue with GitHub</span><span class="btn line">${GOOGLE}Continue with Google</span></div>` +
    `<div style="display:flex;align-items:center;gap:12px;color:var(--ink2);font-size:14px;margin:20px 0"><i style="flex:1;height:1px;background:var(--sep);display:block"></i>or<i style="flex:1;height:1px;background:var(--sep);display:block"></i></div>` +
    `<div class="grp" style="margin-bottom:14px">${field("Email", "you@example.com")}${field("Password", "Required")}</div><span class="btn">Sign in</span>` +
    `<p style="text-align:center;margin-top:18px;font-size:16px">New here? <span style="color:var(--tint);font-weight:500">Create an account</span></p></div>` +
    `<div style="position:absolute;left:0;right:0;bottom:44px;text-align:center;font-size:14px;color:var(--ink2)">Server: do.computer · <span style="color:var(--tint)">Change</span></div>`,
)
const swatch = (c, on) => `<span style="width:36px;height:36px;border-radius:18px;background:${c};display:block;${on ? "box-shadow:0 0 0 3px var(--card),0 0 0 5.500px " + c : ""}"></span>`
const E2 = (shots) =>
  phone(
    `<div class="body" style="padding:0;background:#0d1b3d url(${picture(shots + "web-welcome.jpg")}) center top / cover"></div>` +
      `<div class="g" style="position:absolute;left:18px;right:18px;top:392px;border-radius:24px;padding:14px 18px;z-index:40;font-size:18px;line-height:1.35">I do not have a name yet. What will you call me?</div>` +
      `<div class="sheet white" style="padding:0 20px 44px"><div class="grab"></div><div style="padding-top:22px"><div class="grp" style="background:var(--fill);display:flex;align-items:center;padding:0 8px 0 16px;height:54px;border-radius:18px"><span style="flex:1;font-size:20px;font-weight:600">Juniper<span style="display:inline-block;width:2px;height:22px;background:var(--tint);vertical-align:-4px;margin-left:1px"></span></span><span class="btn s q" style="background:var(--card)">${ic("spark", 17, 2)}Suggest</span></div>` +
      `<div style="display:flex;justify-content:space-between;padding:20px 4px">${["#c8643c", "#5f8a4e", "#3f8fc9", "#8a5fc0", "#d9962b", "#5b6876", "#c0607a", "#27365e"].map((c, i) => swatch(c, i === 4)).join("")}</div><span class="btn" style="background:#d9962b">That’s your name</span></div></div>`,
    { white: true, keep: true },
  )
const E3 = phone(
  `<div class="body" style="padding:150px 24px 0;text-align:center"><span class="sq" style="width:72px;height:72px;border-radius:20px;background:#c0607a;font-size:34px;font-weight:700;margin:0 auto">T</span>` +
    `<h2 style="font-size:30px;font-weight:700;letter-spacing:-.02em;margin-top:20px">Join Tidewater</h2><p style="color:var(--ink2);margin-top:6px">Maya Okafor invited you.</p>` +
    `<div style="display:flex;justify-content:center;gap:4px;margin:26px 0 8px">${cre("pip", 84)}${cre("ledger", 84)}${cre("scout", 84)}</div><p style="font-size:16px;color:var(--ink2);padding:0 12px">You would share Pip, Ledger and Scout, their library and two computers with 3 people.</p></div>` +
    `<div style="position:absolute;left:24px;right:24px;bottom:54px;display:grid;gap:10px"><span class="btn" style="background:#c0607a">Join Tidewater</span><span class="btn q">Not now</span><p style="text-align:center;font-size:14px;color:var(--ink2);padding-top:6px">Signed in as sawyer@tidewater.studio</p></div>`,
)

/* ---------- outside the app ---------- */
const X1 = phone(
  `<div class="wall"></div><div class="lock-t"><small>Monday, October 12</small><b>9:41</b></div>` +
    `<div class="nt" style="top:330px"><div class="h"><span class="app">${cre("juniper", 34)}</span><b>Juniper is working</b><time>now</time></div><div style="margin-top:8px;opacity:.85">Reading analytics-export.csv · step 4</div><div class="prog"><i></i></div></div>` +
    `<div class="nt" style="top:452px"><div class="h"><span class="app" style="background:#dcebfb">${cre("otto", 34)}</span><b>Otto asks first</b><time>2m ago</time></div><div style="margin-top:8px">Send an email to dana@tidewater.studio: “Thursday still works. I moved the review to 2.”</div><div class="acts"><span>Don’t allow</span><span>Always</span><span style="background:#fff;color:#14213f">Allow once</span></div></div>` +
    `<div class="nt" style="top:642px"><div class="h"><span class="app" style="background:#e9e1f3">${cre("ledger", 34)}</span><b>Ledger · Weekly numbers</b><time>8:00</time></div><div style="margin-top:8px;opacity:.85">Revenue is up 4%, and two invoices are late.</div></div>`,
  { white: true, keep: true, dark: true },
)
const appIcon = (inner, label, bg) => `<span style="display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;width:68px;white-space:nowrap"><span style="width:60px;height:60px;border-radius:15px;background:${bg};display:grid;place-items:center;color:#fff">${inner}</span>${label}</span>`
const X2 = phone(
  `<div class="body" style="padding:0;background:linear-gradient(135deg,#f6d9a5,#e59d5c 55%,#b9624a)"></div><div class="scrim"></div>` +
    `<div class="sheet" style="height:610px"><div class="grab"></div><div class="sh" style="justify-content:flex-start;gap:12px"><span style="width:50px;height:50px;border-radius:10px;background:linear-gradient(135deg,#f6d9a5,#e59d5c 55%,#b9624a);display:block"></span><span style="flex:1;line-height:1.25"><span style="font-weight:600;display:block">1 Photo Selected</span><small style="font-size:13px;color:var(--ink2)">Whiteboard, Oct 12</small></span>${gb(ic("x", 20, 2.200))}</div>` +
    `<div style="display:flex;gap:6px;padding:4px 14px 18px">${appIcon(ic("share", 28), "AirDrop", "#2f7fd6")}${appIcon(ic("chats", 28), "Messages", "#34c759")}${appIcon(`<img src="${icon}" alt="" style="width:60px;height:60px;border-radius:15px;display:block">`, "Do Computer", "transparent")}${appIcon(ic("mail", 28), "Mail", "#3d8fe0")}${appIcon(ic("note", 28), "Notes", "#f0b545")}</div>` +
    sect("Send to", [row({ lead: cre("juniper", 36), t: "Juniper", s: "Main chat", tail: `<span style="color:var(--tint)">${ic("check", 20, 2.600)}</span>` }), row({ lead: cre("moss", 36), t: "Moss" }), row({ lead: cre("pip", 36), t: "Pip", s: "Tidewater" })]) +
    `<div class="sect"><div class="grp" style="padding:12px 16px;min-height:74px;color:var(--ink)">Turn this whiteboard into a checklist in the library<span style="display:inline-block;width:2px;height:20px;background:var(--tint);vertical-align:-4px;margin-left:1px"></span></div></div>` +
    `<div style="margin:0 16px"><span class="btn">Send to Juniper</span></div></div>`,
  { keep: true },
)

export const sectionsB = (shots) => [
  {
    id: "agent",
    name: "The agent",
    note: "Tapping an agent’s name opens <b>its own page</b>, the way a contact opens in Messages. It holds what the web splits between the agent’s panel (desktop only) and its settings, so a phone finally gets the running work, the files shared in a chat and Start fresh.",
    cells: [
      [G1, "The agent’s page", "The creature large and alive: stroke it, feed it, open its box. Then its side chats, library and automations, and what it is doing right now."],
      [G2, "Further down", "What belongs to the chat, then every section of the agent’s settings as rows that push in. The web shows these as a window over the chat."],
      [G3, "Permissions", "Allow, Ask first or Never for each thing, as a pop-up menu on the row where the web has three buttons."],
      [G4, "Model and computers", "The model picker pushes in with search. Thinking is a segmented control, and steer or queue is one switch."],
    ],
  },
  {
    id: "wardrobe",
    name: "Wardrobe",
    note: "The creature’s game gets <b>its own page</b>, as you asked for on a phone. Nothing of it is in the app today beyond the outfit being worn.",
    cells: [
      [W1, "The wardrobe", "Treats on one side and the box on the other, with how many wait. Four slots, three tiles across, rarity along the foot of each tile. Tap to wear, tap again to take off."],
      [W2, "Opening a box", "Played in three.js on the creature’s own stage as on the web, with a tap of haptics at each jolt. Wear it, keep it, or open the next one."],
    ],
  },
  {
    id: "library",
    name: "Library",
    note: "Today the app has a flat list that downloads. This is the web’s library: <b>folders, a viewer, editing, versions, sharing and Recently deleted</b>.",
    cells: [
      [L1, "Files and folders", "A folder pushes in like the Files app. Swipe a row to share, rename or delete. The + button makes a document or uploads from Photos, Files or the camera."],
      [L2, "A document", "Markdown is drawn with its tables and task lists. Read and Edit are one control in a glass bar, beside versions and sharing. Pages, pictures and PDFs open in the same place."],
      [L3, "Sharing", "The web’s share popover as a sheet: the link, who can open it, and Stop sharing. “Send the link” is the system’s share sheet."],
      [L4, "Editing", "The format buttons ride on the keyboard. It saves as you type, and a change someone else made asks “Show theirs” or “Keep mine”."],
    ],
  },
  {
    id: "automations",
    name: "Automations",
    note: "The cards from the web as a list. The three buttons on every card become <b>swipe actions</b>, and a card’s detail gets a page of its own.",
    cells: [
      [U1, "The list", "Swipe for Run now, Pause and Delete. Delete asks first, which the app today does not."],
      [U2, "One automation", "Its schedule, what it is told, the check it runs first, and its runs. A run opens the chat it happened in."],
    ],
  },
  {
    id: "settings",
    name: "Settings",
    note: "Your face on the agents list opens Settings as a sheet: <b>what is yours, then workspaces and agents to go inside</b>, the same order as the web’s one settings window.",
    cells: [
      [S1, "Settings", "An invitation waits among the workspaces. An agent’s row opens the same page as its name in a chat."],
      [S2, "General", "Appearance follows the phone unless you say otherwise. Notifications are the system’s own, so there is no “add to Home Screen” step."],
      [S3, "A workspace", "People with their roles, who is invited, and the way in to its computers and model sign-ins."],
      [S4, "Computers", "An agent asking for a computer is answered here or in the chat. Each computer says who owns it and which agents may use it."],
    ],
  },
  {
    id: "start",
    name: "Getting in",
    note: "The app today signs in with an email and password only, and asks for a server address first. Here it <b>starts on do.computer</b> with the same sign-ins as the web, and the first run is the real scene.",
    cells: [
      [E1, "Sign in", "GitHub and Google through the system’s sign-in sheet. Self-hosters change the server at the foot."],
      [E2(shots), "The first run", "The egg, the island and the sky are the web’s own scene drawn natively. Its cards (who you are, a name and color, a model) come up as sheets."],
      [E3, "An invitation", "An invitation link opens the app straight here."],
    ],
  },
  {
    id: "outside",
    name: "Outside the app",
    note: "These two are <b>not on the web</b> and were not asked for. They are what a native app can do that a web page cannot. Say if you want them in.",
    cells: [
      [X1, "The lock screen", "An ask can be answered without opening the app. A Live Activity shows the step an agent is on, and scheduled runs arrive as notifications."],
      [X2, "Send to an agent", "From any app’s share sheet: a photo, a file or a link goes to an agent’s chat with a line of what to do."],
    ],
  },
]
