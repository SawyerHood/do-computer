// The first section: what the web app does on a phone that the native app does not, and where
// each of those is drawn in the sections after it.
import { picture } from "./kit.mjs"

const rows = [
  ["Agents under their workspace, with the latest line, unread and working marks", "One agent at a time, picked under “You”. No teams.", "agents", "Agents"],
  ["New agent, new team, invitations", "New agent only", "agents", "Agents"],
  ["One main chat and side chats", "Every chat alike, in one flat list", "chat", "Chat"],
  ["Attaching pictures and files; steer or queue while it works", "Neither", "chat", "Chat"],
  ["Starter pills under a new agent’s hello", "The hatch, but no starters", "chat", "Chat"],
  ["Asks: approvals, computer requests, sign-ins, secrets", "Approvals only", "inchat", "In a chat"],
  ["A screen or browser in use, live, with Pause and Stop", "Nothing", "inchat", "In a chat"],
  ["Commands in the background, sub-agents, other agents, Slack threads", "Their reports only", "inchat", "In a chat"],
  ["Visuals drawn in the chat, pictures, shared pages", "A file card to download", "inchat", "In a chat"],
  ["Agent settings: profile, memory, model, skills, connectors and Slack, permissions, usage, delete", "Skills. Memory can be read, not changed.", "agent", "The agent"],
  ["Treats, boxes and the wardrobe", "It wears its outfit, and that is all", "wardrobe", "Wardrobe"],
  ["Library: folders, a viewer, editing, versions, sharing, Recently deleted", "A flat list that downloads", "library", "Library"],
  ["Automations", "There already. Delete does not ask.", "automations", "Automations"],
  ["Settings: appearance, default model and computer, notifications", "Nothing", "settings", "Settings"],
  ["Workspaces: people, roles, invitations, computers, pairing, model sign-ins", "Nothing", "settings", "Settings"],
  ["Sign in with GitHub or Google, the first-run scene, the waiting list, invitations", "Email and password, and a server address to type", "start", "Getting in"],
  ["Dictation, push notifications", "There already", "chat", "Kept"],
]
const gaps = [
  ["What it did (the steps behind an answer), files shared in a chat, the list of running commands, Start fresh", "On the web these are in the agent’s panel, which only a wide screen shows", "agent", "The agent"],
]
const tr = ([what, now, go, where]) =>
  `<tr><td>${what}</td><td class="no">${now}</td><td><a data-go="${go}">${where}</a></td></tr>`
export const today = (shots) =>
  `<p class="mk-note">I ran both at a phone’s size on the same account and went through every screen. The app today is <b>five tabs for one agent</b>; the web on a phone is the whole product. Each row is drawn in the section it names.</p>` +
  `<div class="mk-shots">${[["native-chats", "The app today: chats"], ["native-chat", "A chat"], ["native-library", "Library"], ["native-you", "You"]]
    .map(([f, t]) => `<figure><img src="${picture(`${shots}${f}.jpg`)}" alt=""><figcaption>${t}</figcaption></figure>`)
    .join("")}</div>` +
  `<div class="mk-h">On the web on a phone, and what the app does today</div>` +
  `<table class="mk-table"><tr><th>The web on a phone</th><th>The app today</th><th>Drawn in</th></tr>${rows.map(tr).join("")}</table>` +
  `<div class="mk-h">Missing on the web on a phone too</div>` +
  `<table class="mk-table"><tr><th>What</th><th>Why</th><th>Drawn in</th></tr>${gaps.map(tr).join("")}</table>`
