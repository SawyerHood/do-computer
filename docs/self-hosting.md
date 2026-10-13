# Self-hosting

Run Do Computer on a machine of your own or on your own Cloudflare account. It is the same code either way, MIT licensed, and takes about ten minutes.

> **If you are an agent** setting this up for someone: ask which of the two ways they want before you start. A step marked **Needs you:** needs the person, so ask and wait. Never ask for a key in the chat, never print one, and never write one into a file that git tracks. Run the check under each step, and stop at the first one that fails.

## Pick where it runs

|                 | A machine of yours                        | Cloudflare                          |
| --------------- | ----------------------------------------- | ----------------------------------- |
| Runs on         | Node, on a laptop, a home server or a VPS | Workers and Durable Objects         |
| Your data       | A folder of SQLite files                  | D1, Durable Objects and R2          |
| Kept running by | You                                       | Cloudflare                          |
| Costs           | Nothing besides the models                | The Workers Paid plan               |
| Good for        | Trying it, one person, a home network     | An address anyone can reach, a team |

## Before you start

You need git and Node 22.19 or newer. `corepack enable` gives you pnpm in the version the repository asks for.

```sh
corepack enable
git clone https://github.com/SawyerHood/do-computer
cd do-computer
pnpm install
```

Check: `node --version` prints `v22.19.0` or newer.

An [OpenRouter](https://openrouter.ai) key pays for the models. Without one the app runs on a built-in echo model: it repeats what you say, which is enough to look around.

## On a machine of yours

1. **Build it.**

   ```sh
   pnpm build
   ```

2. **Start it.** It stays in the foreground and says `Do Computer listening on http://127.0.0.1:3000/`, so run the check from a second terminal.

   ```sh
   pnpm start
   ```

   Check: `curl -s http://127.0.0.1:3000/api/health` answers `{"ok":true,"target":"node"}`.

3. **Make the first account.** **Needs you:** open <http://127.0.0.1:3000> and sign up. The first account needs no invitation. After it, only people you invite can sign up.

4. **Give it a model key.** **Needs you:** run this yourself, with your key in place of `sk-or-...`. The file is where every setting of this deployment goes, one to a line.

   ```sh
   echo 'OPENROUTER_API_KEY=sk-or-...' > ~/.config/do-computer.env
   chmod 600 ~/.config/do-computer.env
   ```

   Stop the server with Ctrl-C and start it with that file. This is what `pnpm start` runs, plus the settings:

   ```sh
   cd apps/web
   node --env-file="$HOME/.config/do-computer.env" server.node.mjs
   ```

   Check: your Dood answers in its own words and no longer repeats yours.

5. **Reach it from other devices.** Optional. Add the address to listen on and the address you will open to the settings file, then start it again. Sign-in is only accepted from that one address.

   ```sh
   echo 'HOST=0.0.0.0' >> ~/.config/do-computer.env
   echo 'DC_BASE_URL=http://my-box.local:3000' >> ~/.config/do-computer.env
   ```

   Plain http is fine for everything except dictation: a browser only offers the microphone on https or localhost. On a tailnet this gives you https with a real certificate:

   ```sh
   tailscale serve --bg --https=3000 http://127.0.0.1:3000
   ```

6. **Keep it running.** On Linux, a user service starts it at boot and starts it again if it stops. Stop the one in your terminal first, then run this from the `do-computer` folder:

   ```sh
   mkdir -p ~/.config/systemd/user
   cat > ~/.config/systemd/user/do-computer.service <<EOF
   [Unit]
   Description=Do Computer

   [Service]
   WorkingDirectory=$PWD/apps/web
   ExecStart=$(command -v node) --env-file=$HOME/.config/do-computer.env server.node.mjs
   Restart=always

   [Install]
   WantedBy=default.target
   EOF
   systemctl --user daemon-reload
   systemctl --user enable --now do-computer
   loginctl enable-linger "$USER"
   ```

   Check: `systemctl --user is-active do-computer` prints `active`, and the check of step 2 still answers.

Everything it knows is in `apps/web/.data`: one SQLite file for accounts and one for each Dood. Copy that folder to back it up, or set `DC_DATA_DIR` to keep it somewhere else. To update, pull, build and start it again:

```sh
git pull && pnpm install && pnpm build
systemctl --user restart do-computer
```

## On Cloudflare

Each Dood is a Durable Object with its own SQLite storage, accounts and teams are in D1, and files are in R2. The built-in shell runs Doods' commands in Dynamic Workers, which is what needs the Workers Paid plan. A Dood looks over a page it has written in Cloudflare's headless browser before showing it (the `browser` binding in `wrangler.jsonc`), which that plan includes ten hours of a month; take the binding out and Doods draw without looking.

1. **Sign in to Cloudflare.** **Needs you:** a browser window opens.

   ```sh
   cd apps/web
   pnpm exec wrangler login
   ```

   Check: `pnpm exec wrangler whoami` names the account.

2. **Make the database and the bucket.** The first command prints a `database_id`. Keep it for the next step.

   ```sh
   pnpm exec wrangler d1 create durable-computer
   pnpm exec wrangler r2 bucket create durable-computer
   ```

3. **Deploy.** It prints the address when it is done, `https://durable-computer.<your-subdomain>.workers.dev`.

   ```sh
   DC_D1_DATABASE_ID=<the id from step 2> pnpm run deploy
   ```

   Check: `curl -s https://<the address>/api/health` answers `{"ok":true,"target":"cloudflare"}`.

4. **Set the secrets.** The first signs sessions, and nobody can sign in before it is set.

   ```sh
   openssl rand -base64 32 | pnpm exec wrangler secret put DC_AUTH_SECRET
   ```

   **Needs you:** run the second yourself and paste your OpenRouter key where it asks.

   ```sh
   pnpm exec wrangler secret put OPENROUTER_API_KEY
   ```

   Check: `pnpm exec wrangler secret list` names both.

5. **Make the first account.** **Needs you:** open the address and sign up, soon. A fresh deployment belongs to whoever signs up first.

6. **Use an address of your own.** Optional. The domain has to be on the same Cloudflare account. Sign-in is then accepted from that address only.

   ```sh
   DC_CUSTOM_DOMAIN=agent.example.com DC_BASE_URL=https://agent.example.com \
     DC_D1_DATABASE_ID=<the id from step 2> pnpm run deploy
   ```

   Where that address already has a DNS record, serve it as a route instead: `DC_ROUTE=agent.example.com/*` in place of `DC_CUSTOM_DOMAIN`.

To update, pull and run the deploy command again with the same settings. A deploy leaves the secrets alone.

To deploy from GitHub on every push to `main` instead, give your fork the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and the variable `DC_D1_DATABASE_ID`, plus a variable for each setting you passed to the deploy command. The token needs to edit Workers scripts and routes, and D1. Without that variable a fork runs the tests and deploys nothing.

## Settings

These are the ones most deployments set. On a machine of yours they are lines in the settings file. On Cloudflare the keys are secrets, and the rest go in front of the deploy command, beside `DC_D1_DATABASE_ID`. The [configuration reference](https://github.com/SawyerHood/do-computer/blob/main/docs/reference/configuration.md) has the full list.

| Setting              | What it does                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY` | Pays for the models the deployment offers.                                                          |
| `DC_BASE_URL`        | The address people open. Needed behind a proxy and for sign-in with Google or GitHub.               |
| `DC_SIGNUP`          | `invite` (the default) or `open`.                                                                   |
| `DC_ALLOWED_EMAILS`  | Emails that may sign up without an invitation, separated by commas.                                 |
| `DC_DEFAULT_MODEL`   | The model a new Dood starts on.                                                                     |
| `DC_SANDBOX`         | The kind of computer a workspace is given: `just-bash`, `daytona`, `modal`, `cloudflare` or `none`. |

## When something goes wrong

- **Sign-in is refused from another device.** `DC_BASE_URL` is not the address you opened.
- **The microphone is not offered.** A browser only offers it on https or localhost.
- **The Dood only repeats what you say.** There is no `OPENROUTER_API_KEY`, so it is on the echo model.
- **`pnpm` is missing, or complains about its version.** Run `corepack enable`, or put `corepack` in front: `corepack pnpm install`.
- **The bucket cannot be made.** R2 has to be switched on once for the account, in the Cloudflare dashboard.
- **Commands fail on Cloudflare.** The built-in shell needs the Workers Paid plan.
