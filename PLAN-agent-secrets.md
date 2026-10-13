# Passwords and keys for agents: plan

**Status:** the first pull request is built (2026-10-13): our own store, signing in with it,
asking first, and the switch that keeps it to admins. `docs/reference/passwords.md` says what
it does as built, and HANDOFF.md section 5 how, and where the build departed from this plan.
The rest of this plan is still to come: cards next, then the others in section 6.

The owner asked for research into what OpenClaw and Hermes Agent do, for agents to be able to
use 1Password "for both browser use and other things they need to fill out", and for a plan.
Having read it, the owner decided the same day:

- **Our own store is built first, and is the first pull request**, to "see how it works".
- **1Password comes later**, on the person's computer first, with the store as the fallback
  for whoever has no 1Password. It may be that only the store is built for now.
- **1Password is not to be asked about partner access.**
- **An admin must be able to turn the whole feature off with an environment variable** (4.9).
- **On do.computer only admins may use it**, so that the owner can try it and nobody else's
  passwords are at risk while it is new (4.9).
- **Cards are the next thing after the first pull request**, and not in it (4.4). Where a card
  may be kept is still open.

Everything else below was a proposal when it was built from. Section 6 says what the first
pull request holds, section 7 what is still open, and section 8 what was and was not checked.
The findings on other projects come from reading docs and source.

An agent that has to sign in somewhere today has two ways to get the password: the person pastes
it into the chat, or the agent asks with `request_secret` and the value is written to a `.env`
file on a machine the agent works on. The first puts the password in the transcript, the search
table and the model provider's logs. The second keeps it out of those, and then leaves it one
`cat .env` away. This plan gives agents passwords and keys they can **use but not read**: the
value goes from where it is kept straight to the page or the command, and the model, the
transcript and our logs only ever hold its name.

## 1. What happens today

- **`request_secret`** (`packages/agent/src/secrets.ts`): the person types into a form above the
  message box; the values go to a dotenv file on a computer (mode 600) or become a connector's
  token; the agent is told the names. The prompt asks the agent not to read the file, and
  `docs/reference/security.md` says plainly that nothing stops it.
- **The browser tool takes one script** (`packages/agent/src/uses.ts:499`). There is no "type
  this here" step to hook: a typed value is a literal inside JavaScript the model wrote, e.g.
  `page.fill("ref/e7", "hunter2")`.
- **That script, and every other tool argument, is copied to many places:**
  - the conversation entries, and from there every client over the socket;
  - the dev-browser command line (`-e <script>`, `packages/computers/src/browser/index.ts:386`),
    so it shows in the machine's process list;
  - the daemon's `audit.log` in full, and the first 200 characters in `daemon.log`
    (`packages/computers/src/daemon-core.ts:282`, `apps/daemon/src/main.ts:191`);
  - for the screen tool's `type`, the activity line "Typing <first 40 characters>"
    (`packages/agent/src/uses.ts:104`), which also reaches the desktop overlay and live view;
  - when a tool is set to Ask first: the stored request, the push notification, and an
    "Approved: …" line put back into the conversation (`packages/agent/src/approvals.ts:513`);
  - for background commands: the search table, command and output both
    (`packages/agent/src/project.ts:497`).
- **Nothing is encrypted at rest and nothing is scrubbed.** Connector tokens
  (`dc_connector_secrets`), model sign-ins (`dc_model_credentials`), Slack tokens and the push
  keys are plain text in Durable Object storage and D1.
- **The plumbing for per-command environment variables exists end to end and is unused**
  (`ExecOptions.env`, `ExecFrame.env`, `JobFrame.env`). On a paired computer a command also
  inherits the daemon's whole environment (`packages/computers/src/node-io.ts:54`).
- **What already works well:** an agent using the owner's own Chrome is usually signed in
  already, and the agents' own Chrome keeps its sessions between runs. Most of the time no
  password is needed at all. This plan is for the times one is.

## 2. What others do

|                                            | Web sign-in                                                                                                                                                                                                                                                                                                   | Keys for commands                                                                                                                                                                                                                                                                                                  | What is recorded                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hermes Agent** (v0.21.7)                 | `browser_vault` tool since 2026-09-10: the model gets handles, the host fills over DevTools, only into a password field on the exact site the login was saved for; result says only which fields were filled. Reads 1Password and Bitwarden through their CLIs. No approval for logins; every card fill asks. | Environment variables. Any the agent is given can be echoed. An egress proxy that swaps in real keys exists for model-provider keys in Docker only.                                                                                                                                                                | Pattern scrubbing of tool output before the model sees it, plus exact-value scrubbing of what the vault filled. The session database is written unscrubbed and is searchable; several open issues. Their own SECURITY.md: scrubbing is "not a security boundary". |
| **OpenClaw** (v2026.10.3)                  | Nothing built in. Guidance is to sign in by hand in the agent's browser profile, or attach to your own Chrome. The only password-blind route is 1Password for Claude through the Claude CLI backend.                                                                                                          | A store with two kinds: `env` (the agent can read it) and `secret` (write-only). A `secret` reaches a command as a stand-in, and a local proxy swaps in the real value only for hosts the person bound it to. Off by default; not in sandboxes. A `secrets` tool has the person type a value into a masked prompt. | Masking of transcripts and tool results was added in the spring and removed on main on 2026-10-12 "for performance and source fidelity". The bundled 1Password skill runs `op read`, whose output goes to the model and the transcript.                           |
| **1Password for Claude** (Mac)             | Claude asks 1Password; the person sees which item and approves with Touch ID; 1Password fills, submits and checks while "the agent sleeps", and clears the fields if it failed. Claude gets the item's title, username and websites, never the value.                                                         | Not covered.                                                                                                                                                                                                                                                                                                       | Nothing reaches the model.                                                                                                                                                                                                                                        |
| **1Password, for everyone else**           | SDK or `op` CLI: your code resolves `op://vault/item/field` and does the filling itself. Their own tutorial for this carries a notice that it is not the approach they recommend, because the agent ends up holding the value.                                                                                | `op run` puts values in a command's environment and masks them in what it prints. With NVIDIA OpenShell: stand-ins inside the sandbox, real values swapped in outside it for approved hosts, for a limited time.                                                                                                   | —                                                                                                                                                                                                                                                                 |
| **Bitwarden Agent Access** (early preview) | Open protocol and `aac` CLI: an encrypted tunnel to the person's device, a person approves each credential. `aac connect` prints the credential, so an agent running it sees it.                                                                                                                              | `aac run` injects into a command's environment.                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                                                                 |
| **browser-use, Stagehand**                 | Named stand-ins in what the model writes, swapped for values when typed, bound to sites.                                                                                                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                  | browser-use warns that screenshots still show what was typed.                                                                                                                                                                                                     |
| **Claude Managed Agents vaults**           | —                                                                                                                                                                                                                                                                                                             | The sandbox holds a stand-in; the real secret is swapped in as the request leaves.                                                                                                                                                                                                                                 | —                                                                                                                                                                                                                                                                 |

What this adds up to:

1. **Everyone serious has converged on the same two mechanisms.** For web pages: the model
   names a login and trusted code fills it, bound to the site (Hermes, 1Password for Claude,
   browser-use). For commands: the process holds a stand-in and something outside it swaps in
   the value for an allowed host (OpenClaw, 1Password with OpenShell, Anthropic, Infisical).
2. **Scrubbing text after the fact is a backstop, never the protection.** Both projects say so,
   and OpenClaw has just taken its scrubbing out. A secret the model can read will be recorded
   somewhere.
3. **1Password's "fill it for the agent" is not open to us today.** The desktop app only
   answers apps whose signing identity is on "1Password's allowlist of trusted partner
   applications". What is open: the SDK with a prompt from the 1Password desktop app
   (`DesktopAuth`), and service accounts limited to one vault.
4. **A plain environment variable is the weak spot in both projects.** Each has had leaks or
   CVEs through it. We should not present it as more than it is.
5. **Hermes's friction is worth avoiding:** its instruction "never type a password" made agents
   refuse people's own password-manager workflows (their issue #126421).

## 3. What can be promised, and what cannot

**Can:** a password an agent uses through this is never in what the model is sent, never in a
transcript, never in search, notes, notifications or our logs, and is typed only into a password
box on a site that login belongs to.

**Cannot:**

- **Hiding a password does not limit what a signed-in agent does.** Once it is in, it can do
  whatever the account allows. Asking first and binding to a site are the limits; hiding the
  value protects the password from being recorded or reused elsewhere.
- **An agent that something it read has already turned** can run its own script in the page
  before asking for a fill. The design takes away what such a script can leave behind (4.3
  says how, and what was run to find out), and fills and submits in one step with no script in
  between.
- **An agent that can run commands on the same computer as the browser** is not walled off from
  it: a command runs as the same user and can open the browser's DevTools port itself. Nothing
  in this plan closes that. On a computer where it matters, commands can be set to Ask first or
  Never under Permissions, which is what there is today.
- **A key handed to a command as an environment variable can be read by that command.** Masking
  catches accidents. Only the swap-at-the-way-out mechanism (section 4.5) makes a key unreadable.
- **The page gets the real password**, as it must, and so does whoever runs that site.

## 4. The design

### 4.1 A secret is a name

A workspace has a list of **logins** (username, password, perhaps a one-time-code key, and the
sites they are for) and **keys** (a value, and the hosts it may be sent to). The model is told
their names and what they are for, in a prompt section:

```
Saved logins you can use with sign_in (you never see the passwords):
- GitHub — sawyer@example.com — github.com
- Stripe dashboard — sawyer@example.com — dashboard.stripe.com
Keys you can pass to a command by name: STRIPE_API_KEY (api.stripe.com)
```

Wording for the model is permissive, not prohibiting: use a saved login when there is one, ask
with `request_secret` when there is not, and if the person insists on another way, do it their
way.

### 4.2 Where the value is kept

Three places, behind one interface, so the tools in 4.3 to 4.6 do not care which:

**A. 1Password on the person's computer** (the one to lead with). The desktop app uses
`@1password/sdk` with `DesktopAuth`. The person turns on "Integrate with other apps" in
1Password once and picks a vault; 1Password then shows its own prompt, naming Do Computer, and
unlocks with Touch ID. The grant lasts until 10 minutes pass unused or 1Password locks.

- The value goes 1Password → our app on that computer → the page. **Our server never has it**,
  on do.computer or anywhere. It stores the item's id, title, username and websites.
- The grant 1Password gives is to the whole account, not the vault. Our app reads only the
  chosen vault; that is our code keeping its word, not 1Password enforcing it.
- Works only where the desktop app runs and someone can answer the prompt. That is also where
  the browser tool runs today, so the two fit.

**B. A 1Password service account**, for machines nobody sits at and for scheduled runs. Its
token reaches one vault, read-only, with no prompt. It cannot reach Personal or Private vaults,
so the person makes a vault for their agents. Limits are 1,000 reads an hour and 1,000 requests
a day on individual and Families plans. The token is itself a secret: kept in the computer's
keychain where there is a desktop app, otherwise in C.

**C. Our own store**, for people without 1Password, for self-hosters, and for cloud machines.
Kept on the server, encrypted (AES-256-GCM, a key per workspace derived from a deployment
secret), write-only: no route ever returns a value to a browser. Honest framing for the
"will people trust it" worry:

- It replaces something weaker we already do. Today the same values sit in a plain `.env` on a
  machine the agent can read.
- It is the GitHub Actions model: you can set a secret and use it, never read it back.
- Whoever runs the server can still decrypt. On a self-hosted deployment that is the owner. On
  do.computer it is us, which is why A comes first there.

Not proposed now: Bitwarden Agent Access (early preview; the interface leaves room), and
becoming a 1Password partner so that 1Password itself fills, as it does for Claude. The second
is the best experience there is, and the owner has said not to ask 1Password about it.

### 4.3 Signing in on a web page

A new tool beside `browser`, not a new function inside its scripts: anything a model-written
script can touch, it can also print or send away.

```
sign_in({ login: "GitHub" })
→ Signed in to github.com as sawyer@example.com. The page is now https://github.com/.
```

What the daemon does, in fixed code, with no model script running until it is over:

1. Reads the tab's real address from the browser and checks it against the login's sites: https,
   and the same host or a subdomain of a listed one. Otherwise it refuses and says which sites
   the login is for.
2. Stops dev-browser's daemon (`dev-browser stop`), then reloads the tab. The browser stays
   open and the agent's named pages come back on its next script. A page that another window
   of the same site opened, or that has opened one, is refused: see the table.
3. Finds the fields as a password manager does. The password goes only into a visible
   `type=password` box, never a text box. Username-then-password pages are handled in the same
   step.
4. Types and submits over a DevTools socket of the daemon's own, not through dev-browser, and
   waits for the form to go.
5. If the form is still there, empties the fields before returning.
6. Returns the site, the username and how it went. Nothing else.

**Why step 2 is more than a reload** (run here on 2026-10-13, dev-browser 1.0.0-rc.3, a
throwaway login page, headless Chromium):

| What an earlier agent script had left                                                              | Later fill, after a reload | Fill in a new tab on another socket | After `dev-browser stop`       |
| -------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------- | ------------------------------ |
| A listener added with `page.evaluate`                                                              | not leaked                 | not leaked                          | not leaked                     |
| A script for every new document (`evaluateOnNewDocument`, or the same over a raw DevTools session) | **every keystroke leaked** | not leaked                          | not leaked, in the old tab too |
| A loop left running inside dev-browser's daemon, attaching to every tab                            | not run                    | **leaked**                          | not leaked                     |
| A window of the same site that the page opened, with code left running in it                       | **leaked**                 | not run                             | **leaked**                     |

So a reload is not enough and neither is a new tab; stopping dev-browser's daemon drops
everything a script left in it. The last row was found while it was being built: such a window
is an ordinary page with a hold on the sign-in page, which nothing ends, so `sign_in` types
nothing where the page has a same-site opener or popup, and says to close it. A script can also reach dev-browser's own `process` object from
inside `node:vm` (dev-browser says it is not a sandbox). That is the reach a command already
has, and is the limit named in section 3.

When the heuristics miss, the agent may point at the fields (`username_field`, `password_field`
as selectors); the password-box rule still holds. Passkeys, push approvals and CAPTCHAs stay
with the person, in the visible browser window we already open.

### 4.4 Paying with a card

Possible, with the same idea (the Dood names a saved card, fixed code types it), and four
things that are not the same as a login:

- **A card has no site of its own.** A login is refused anywhere but its sites; a card is meant
  to be typed on shops nobody listed beforehand. So the person is the check: every use asks,
  the request shows the address of the page read from the browser, there is no "Always allow",
  and a scheduled run, a sub-agent or Slack cannot use one at all. Hermes does the same.
- **Card boxes are ordinary text boxes.** A password box shows dots and the form is gone once
  it is sent; a card number stays readable on the page, in the Dood's next look at it and in
  the live view. Two answers, both needed: `pay` fills the card and presses the pay button in
  one step where it can, and the boxes it filled are set to draw dots
  (`-webkit-text-security`) until then. What a script reads out of the box can only be masked
  after the fact, by exact value, which is the backstop of 4.8 and not a wall.
- **The boxes are usually inside the payment company's own frame** (Stripe, Adyen, Braintree,
  Shopify), often one frame for each box. DevTools can type into those, and tests written with
  Playwright do it every day, but finding the right boxes is more work than a login form, and
  it was not tried here.
- **Keeping card numbers on a server is a heavier thing than keeping passwords.** A leaked
  password is for one site and can be changed; a leaked card works everywhere. The card
  industry's rules (PCI DSS) are about exactly this, and whether they bind a service that keeps
  a person's own card for them the way a password manager does is a question for someone who
  knows them, not for this plan. It weighs on do.computer; a self-hoster keeps their own.

What follows from the last one:

- Cards are **off unless the deployment names them** in `DC_SECRET_KINDS` (4.9).
- The better thing to save is **a card made for the purpose with a limit on it** (a virtual
  card from the bank or a service like Privacy), and the form should say so.
- Cards are the strongest case for keeping the value **on the person's computer and never on
  the server**: the browser runs there anyway. That is 1Password when it comes, or a store in
  the desktop app's keychain before then.

Addresses are the easy part of the same form and carry none of this.

### 4.5 Commands

```
bash({ command: "stripe customers list", secrets: ["STRIPE_API_KEY"] })
```

- **Step one, everywhere:** the named values are put in that one command's environment, on the
  existing `env` path. They are never written to a file. What the command prints is masked on
  the machine before it leaves it: the exact value, and its base64, hex and URL-encoded forms,
  become `[STRIPE_API_KEY]`. This is the `op run` level of protection: good against accidents
  and against recording, not against an agent set on reading the value.
- **Step two, where we own the way out:** the command gets a stand-in, and the real value is
  swapped in only on requests to the hosts the key is bound to. The built-in shell on
  Cloudflare is the easy first case, because its `curl` already goes through our own fetch.
  Containers and paired computers need a proxy with its own certificate; later, if ever.
- `request_secret` gains "keep it" as a destination and that becomes its default; the `.env`
  destination stays for programs that want a file.
- For anything with an API, a connector is still better than a key in a shell: its token never
  leaves the server.

### 4.6 Typing on the screen

`screen` gains `type_secret` with a `secret` name, for password boxes in desktop apps. The
desktop app resolves the value and hands it to Cua's `type_text`; the activity line says
"Typing the password for …". It should refuse unless the focused element is a secure text field,
so a password cannot be typed into a visible box and read back off the next screenshot. Whether
Cua exposes that is not known (section 8), so this comes last.

### 4.7 Asking first

- One new ability under Permissions, "Use a saved password or key", **Ask first** by default,
  with Allow per login.
- The request shows the login's name and the site read from the browser, not anything the model
  said: "Use GitHub on github.com?"
- Outside a conversation with a person (a scheduled run, a sub-agent, Slack), only logins set
  to Allow can be used. A login from 1Password on someone's computer needs that person there
  anyway.

### 4.8 What is recorded

- Tool arguments hold names only, so every sink in section 1 gets names only.
- The daemon's `audit.log` records "sign_in GitHub on github.com", and frames that carry a
  value (store-backed logins) are never written to any log.
- Fixes that are worth doing whether or not the rest is built:
  - give dev-browser its script on stdin instead of the command line (it supports that);
  - stop putting typed text in the screen tool's activity line;
  - mask the exact values used in a run in every result that leaves the machine, and on the
    server before an entry is stored, for the values the server holds.
- The same encryption as 4.2 C for what is already stored plain: connector tokens, model
  sign-ins, Slack tokens.

### 4.9 Who has it, and turning it off

One variable for the deployment, `DC_SECRETS`, read by the server:

| Value              | Who has the feature                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unset, or `admins` | Only the people named in `DC_ADMIN_EMAILS`, and only in a workspace where everyone is one of them (their own, usually).                                              |
| `on`               | Everyone.                                                                                                                                                            |
| `off`              | Nobody: no store, no `sign_in`, no Passwords page, no form asking for a login, nothing about it in what the model is told. `request_secret` does what it does today. |

- **Admins only is what an unset variable means**, so that do.computer is closed to everyone
  else without anything having to be set there, and stays closed if a setting is ever lost. A
  self-hoster who wants it for everyone sets `on`.
- "Has the feature" covers every way in: seeing the page, saving a login, a Dood being given
  the tool, and a request to use one being answered. A team that a person who is not an admin
  belongs to does not have it, since that person's conversations would otherwise be able to
  use what an admin saved. The server decides this on each request, from the session and the
  database, as it does for who is in a team.
- What was saved before a workspace lost the feature stays, encrypted and unused, and is there
  again if it comes back. Deleting it is a separate, deliberate act.
- The app is told whether the person has it, so the page and the form are not drawn at all;
  the server refuses the routes as well, so a client that asks anyway gets nothing.
- Which kinds there are is a second variable when there is a second kind:
  `DC_SECRET_KINDS=passwords,cards`, after `DC_SANDBOX_KINDS`. Unset, it is passwords alone,
  so cards are something a deployment turns on.
- The name is `DC_SECRETS` and not `DC_PASSWORDS`, because `DC_PASSWORD_SIGNIN` already means
  signing in to Do Computer itself with a password.

### 4.10 What the person sees

To be mocked up in `prototypes/secrets` before any of it is built:

- **Settings → workspace → Passwords and keys:** the list, where each is kept (1Password on
  Sawyer's MacBook, 1Password service account, Do Computer), which sites or hosts, Ask first or
  Allow, last used and by which Dood.
- **Connecting 1Password:** on the desktop app, choose the account and a vault, with the one
  switch to turn on in 1Password shown as a picture.
- **The request card** above the message box, and the same as a notification.
- **In the chat:** one line, "Signed in to github.com as …", where a tool call would be.
- **The form `request_secret` shows,** with the sites or hosts a value may be used on.

## 5. How it fits the code

| Piece                                                                                   | Where                                                                      |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Sources (1Password on the computer, service account, store) behind one interface        | new, `packages/agent/src/secrets/`; the SDK lives in `apps/desktop`        |
| The store, one per workspace, beside `ModelAccessObject`                                | new Durable Object; key from a `DC_SECRETS_KEY` secret                     |
| `sign_in` tool, the prompt section, `secrets` on `bash`, "keep it" for `request_secret` | `packages/agent/src/uses.ts`, `jobs.ts`, `secrets.ts`                      |
| A `sign_in` operation on the browser frame; values in a field no log writes             | `packages/protocol/src/daemon.ts`, `packages/computers/src/daemon-core.ts` |
| The fill itself, over the daemon's own DevTools socket                                  | `packages/computers/src/browser/`, next to `relay.ts` and `preview.ts`     |
| Masking on the machine, and before storing                                              | `packages/computers/src/`, `packages/agent/src/project.ts`                 |
| The new ability and its request                                                         | `packages/agent/src/approvals.ts`                                          |
| The settings page, card and chat line                                                   | `apps/web/src/components/`, then `apps/mobile`                             |

## 6. Order of building

**The first pull request: our own store, and signing in with it.**

1. **Mock-up** of 4.10 for the owner to choose from, before any screen is built (drawn:
   `prototypes/secrets`).
2. **The store**: one per workspace, encrypted, write-only. Logins only: a name, a username, a
   password, the sites it is for.
3. **Saving a login**: `request_secret` can ask for one (the form shows the site, taken from
   the tab the agent is on), and a person can add or remove one in settings.
4. **`sign_in`**, as in 4.3, on the agents' own Chrome and on the owner's.
5. **Asking first**, as in 4.7: the new ability, the request card, the notification.
6. **The recording fixes of 4.8**: the script on stdin, no typed text in the activity line,
   names only in `audit.log`.
7. **`DC_SECRETS`**, as in 4.9: admins only unless a deployment says otherwise. In
   `docs/reference/configuration.md` with the rest.
8. `docs/reference/security.md` says what this does and does not protect.

All of it can be run here against a test site. Left out of it on purpose: one-time codes,
cards, keys for commands, 1Password, and everything under "later".

**Next: cards** (4.4), as the owner decided, once it is settled where a card may be kept.

**After that, each on its own, in an order to be chosen once those are in use:**

- One-time codes for a saved login.
- Keys for commands: `secrets` on `bash`, masking, `request_secret` keeping values (4.5).
- 1Password on the person's computer (4.2 A). Needs a Mac with 1Password and an account, and a
  first look at `DesktopAuth` inside our packaged app.
- Later still: the swap at the way out for the built-in shell; service accounts; `type_secret`
  (once it is known whether Cua can tell a secure text field); encrypting what is already
  stored.

## 7. Choices the owner has not made

Answered on 2026-10-13: the store first and as the first pull request; 1Password later, on the
person's computer, with the store as the fallback; no approach to 1Password about partner
access; a variable that turns it off; admins only on do.computer; cards next. Still open, with what the first pull request will do unless told otherwise:

1. **Ask first by default for every login**, with "always allow" per login. Proposed: yes.
2. **May a login be used from Slack or a scheduled run** when it is set to Allow? Proposed: a
   scheduled run yes, Slack no, since anyone in the Slack workspace can speak to the Dood.
3. **In a team, who may add a login and whose it is.** Proposed: a workspace's logins are the
   workspace's, like connectors; any member may add one, and nobody can read one back.
4. **The name.** "Passwords" for the first pull request, "Passwords and keys" once there are
   keys; "Secrets" stays the word in the code.
5. **What the model is told.** Proposed wording is permissive (4.1), after Hermes's trouble.
6. **Cards: may do.computer's server keep them?** Cards are next, and admins only like the
   rest. Proposed: kept on the person's computer and not on the server, always asking. The
   other answer is the store beside passwords, which is less to build and is the heavier thing
   described in 4.4.
7. **An unset `DC_SECRETS` means admins only.** The owner asked for that on do.computer; making
   it the default everywhere, the name, and the rule that a team with anyone else in it does
   not have the feature are proposals.

## 8. Checked, and not checked

**Run here (4.3):** what a dev-browser script can leave behind, that a reload or a new tab does
not get rid of it, that `dev-browser stop` does, that the agent's named page comes back
afterwards, and that typing over a separate DevTools socket signs in. dev-browser also takes its
script on stdin, which is what 4.8 needs.

**Not checked:**

- **`sign_in` on the owner's own Chrome.** There everything goes through the one shared socket
  (`relay.ts`), which detaches dev-browser's session when dev-browser goes away; that the
  planted scripts go with it was not run.
- **Real sign-in pages.** The field-finding was tried on one hand-made form. Pages that build
  their form late, split it over steps, or sit in an iframe are where it will need work.
- **`@1password/sdk` was not run.** `DesktopAuth` is in the main README and in v0.5.0
  (2026-07-31). 1Password's pages disagree on Windows. The prompt names a process by its
  executable; what it shows for our daemon inside the desktop app is unknown.
- **Whether the 1Password SDK runs inside a Worker**, which decides where a service account's
  token can be used from.
- **Typing a card** into a payment company's frames, and drawing a filled box as dots.
- **What the card industry's rules ask** of a service that keeps a person's own card for them.
- **Cua's view of secure text fields.**
- **OpenClaw and Hermes were read, not run.** OpenClaw's removal of masking is on its main
  branch and in no release yet.
- **1Password for Claude's requirements** (versions, plans) came partly from secondary sites.

## Sources

- 1Password: [Agentic Autofill announcement](https://1password.com/blog/closing-the-credential-risk-gap-for-browser-use-ai-agents),
  [security of 1Password for Claude](https://support.1password.com/1password-claude-security/),
  [1Password for Claude](https://1password.com/blog/1password-for-claude),
  [SDK tutorial for agents](https://www.1password.dev/sdks/ai-agent),
  [SDK desktop app integration](https://www.1password.dev/sdks/desktop-app-integrations),
  [SDK concepts](https://www.1password.dev/sdks/concepts),
  [JavaScript SDK](https://github.com/1Password/onepassword-sdk-js),
  [service account rate limits](https://www.1password.dev/service-accounts/rate-limits),
  [secret references and `op run`](https://www.1password.dev/cli/secret-references),
  [secure AI access](https://www.1password.dev/get-started/secure-ai-access),
  [NVIDIA OpenShell](https://www.1password.dev/environments/nvidia-openshell),
  [where MCP fits](https://1password.com/blog/where-mcp-fits-and-where-it-doesnt),
  [Unified Access](https://1password.com/press/2026/mar/1password-unified-access)
- OpenClaw: [secret store and egress](https://docs.openclaw.ai/gateway/secrets/secret-store-and-egress),
  [SecretRef contract](https://docs.openclaw.ai/gateway/secrets/secretref-contract),
  [`secrets` tool](https://docs.openclaw.ai/tools/secrets),
  [browser login](https://docs.openclaw.ai/tools/browser-login),
  [1Password plugin](https://docs.openclaw.ai/plugins/onepassword),
  [1Password for Claude through the gateway](https://docs.openclaw.ai/gateway/1password),
  [logging and redaction](https://docs.openclaw.ai/gateway/logging#redaction),
  [PR #169063](https://github.com/openclaw/openclaw/pull/169063),
  [bundled 1Password skill](https://github.com/openclaw/openclaw/blob/main/skills/1password/SKILL.md)
- Hermes Agent: [credential vault](https://hermes-agent.nousresearch.com/docs/user-guide/features/credential-vault),
  [PR #106480](https://github.com/NousResearch/hermes-agent/pull/106480),
  [security](https://hermes-agent.nousresearch.com/docs/user-guide/security),
  [secrets](https://hermes-agent.nousresearch.com/docs/user-guide/secrets),
  [SECURITY.md](https://github.com/NousResearch/hermes-agent/blob/main/SECURITY.md),
  [issue #54027](https://github.com/NousResearch/hermes-agent/issues/54027)
- Others: [Bitwarden Agent Access](https://github.com/bitwarden/agent-access),
  [browser-use sensitive data](https://docs.browser-use.com/customize/sensitive-data),
  [Claude Managed Agents vaults](https://platform.claude.com/docs/managed-agents/vaults),
  [dev-browser](https://github.com/SawyerHood/dev-browser)
