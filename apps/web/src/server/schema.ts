import type { AppDatabase } from "@do-computer/runtime"

/** Ordered schema history of the app database. Append; never edit a shipped entry. */
const MIGRATIONS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE dc_agents (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    "CREATE INDEX dc_agents_by_owner ON dc_agents (owner_id, created_at)",
  ],
  [
    // A computer someone paired. Its daemon authenticates with a token whose hash is stored; the
    // hash is null until the daemon has collected the token.
    `CREATE TABLE dc_computers (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      hostname TEXT NOT NULL,
      read_only INTEGER NOT NULL,
      token_hash TEXT UNIQUE,
      created_at INTEGER NOT NULL
    )`,
    "CREATE INDEX dc_computers_by_owner ON dc_computers (owner_id, created_at)",
    // A daemon asking to be paired, until a signed-in user confirms its code or it expires.
    `CREATE TABLE dc_pair_requests (
      code TEXT PRIMARY KEY,
      poll_hash TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      hostname TEXT NOT NULL,
      home TEXT NOT NULL,
      read_only INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      computer_id TEXT
    )`,
  ],
  [
    // Devices to notify when an agent has something for its user. The token is Expo's.
    `CREATE TABLE dc_push_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    "CREATE INDEX dc_push_tokens_by_user ON dc_push_tokens (user_id)",
  ],
  [
    // A connector sign-in in progress: which user, agent and connector the service's redirect,
    // identified only by its `state`, belongs to.
    `CREATE TABLE dc_oauth_states (
      state TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      connector_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  ],
  [
    // What a user has chosen for their account, as opposed to for one agent.
    `CREATE TABLE dc_user_settings (
      user_id TEXT PRIMARY KEY,
      default_model TEXT
    )`,
  ],
  // The kind of computer a user's new agents get.
  ["ALTER TABLE dc_user_settings ADD COLUMN default_computer TEXT"],
  [
    // A team: a workspace several people share. A personal workspace has no row; its id is made
    // from its owner's, and every agent from before teams is in its owner's.
    `CREATE TABLE dc_workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE dc_members (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    )`,
    "CREATE INDEX dc_members_by_user ON dc_members (user_id)",
    // Someone asked to join a team, by email or by GitHub account. The link they are sent holds
    // a token, of which only the hash is kept. A row is deleted once it is answered or withdrawn.
    `CREATE TABLE dc_invitations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      email TEXT,
      github_id TEXT,
      github_login TEXT,
      role TEXT NOT NULL,
      note TEXT,
      invited_by TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    "CREATE INDEX dc_invitations_by_workspace ON dc_invitations (workspace_id)",
    "CREATE INDEX dc_invitations_by_email ON dc_invitations (email)",
    "CREATE INDEX dc_invitations_by_github ON dc_invitations (github_id)",
    "ALTER TABLE dc_agents ADD COLUMN workspace_id TEXT",
    "UPDATE dc_agents SET workspace_id = 'personal:' || owner_id",
    "CREATE INDEX dc_agents_by_workspace ON dc_agents (workspace_id, created_at)",
  ],
  [
    // A computer belongs to a workspace: the own one of whoever paired it, or a team's. Which
    // agents can work on it is a row each, where it used to be one agent named on the computer.
    "ALTER TABLE dc_computers ADD COLUMN workspace_id TEXT",
    "UPDATE dc_computers SET workspace_id = 'personal:' || owner_id",
    "CREATE INDEX dc_computers_by_workspace ON dc_computers (workspace_id, created_at)",
    // The home directory there, which an agent has to be told when it is connected. Null for a
    // computer from before this was kept; its daemon says it when it connects.
    "ALTER TABLE dc_computers ADD COLUMN home TEXT",
    `CREATE TABLE dc_computer_grants (
      computer_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (computer_id, agent_id)
    )`,
    "CREATE INDEX dc_computer_grants_by_agent ON dc_computer_grants (agent_id)",
    `INSERT INTO dc_computer_grants (computer_id, agent_id, granted_by, created_at)
       SELECT id, agent_id, owner_id, created_at FROM dc_computers`,
    "ALTER TABLE dc_computers DROP COLUMN agent_id",
    // An agent asking to work on a computer it is not connected to, until someone the computer
    // belongs to answers. Asking again for the same computer is the same request.
    `CREATE TABLE dc_computer_requests (
      id TEXT PRIMARY KEY,
      computer_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      chat_id TEXT,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (computer_id, agent_id)
    )`,
    "CREATE INDEX dc_computer_requests_by_agent ON dc_computer_requests (agent_id)",
  ],
  [
    // A computer is one somebody paired, or a machine the app made for a workspace. `kind` says
    // which; every computer from before is a paired one.
    "ALTER TABLE dc_computers ADD COLUMN kind TEXT NOT NULL DEFAULT 'paired'",
    // What a machine is named after at its provider. A machine an agent had to itself, from
    // before computers belonged to a workspace, is named after that agent.
    "ALTER TABLE dc_computers ADD COLUMN machine_key TEXT",
    // Who can use it: `open` to every agent of its workspace, or `chosen`, to the agents with a
    // row in dc_computer_grants. A paired computer is always chosen.
    "ALTER TABLE dc_computers ADD COLUMN access TEXT NOT NULL DEFAULT 'chosen'",
    // The folder an agent has to itself on a machine, chosen when it first works there.
    `CREATE TABLE dc_computer_folders (
      computer_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (computer_id, agent_id)
    )`,
    "CREATE INDEX dc_computer_folders_by_agent ON dc_computer_folders (agent_id)",
  ],
  [
    // A browser is a device to notify too. Its token is the address its push service gave it,
    // and these are the keys a message to it is encrypted with. Both are null for a phone.
    "ALTER TABLE dc_push_tokens ADD COLUMN p256dh TEXT",
    "ALTER TABLE dc_push_tokens ADD COLUMN auth TEXT",
  ],
  [
    // The Slack app an agent is in Slack as, made by whoever put it there: which workspace it
    // was installed to, what the bot is called, the token it acts with and the secret Slack
    // signs with. The client id and secret are what the Slack connector signs in as.
    `CREATE TABLE dc_slack_apps (
      agent_id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      team_name TEXT NOT NULL,
      team_url TEXT,
      bot_user_id TEXT NOT NULL,
      bot_name TEXT NOT NULL,
      bot_token TEXT NOT NULL,
      signing_secret TEXT NOT NULL,
      client_id TEXT,
      client_secret TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  ],
  [
    // The agent that added a machine, where one did: it may remove it again. Whoever it was
    // working for when it did is the machine's owner, as if they had added it themselves.
    "ALTER TABLE dc_computers ADD COLUMN added_by_agent TEXT",
  ],
  [
    // A Slack app's client id and secret were what a connector signed in to Slack with as a
    // person. An agent now goes to Slack as its bot alone, so they are no longer kept.
    "ALTER TABLE dc_slack_apps DROP COLUMN client_id",
    "ALTER TABLE dc_slack_apps DROP COLUMN client_secret",
  ],
  [
    // What a workspace has chosen for all its agents. Kept by the workspace's id and not with
    // the team, since a personal workspace has no row there. One that has chosen nothing has no
    // row here either, and whether the browser its agents use is shown is then yes.
    `CREATE TABLE dc_workspace_settings (
      workspace_id TEXT PRIMARY KEY,
      show_browser INTEGER NOT NULL DEFAULT 1
    )`,
  ],
  [
    // A page of a workspace's library, or a folder of them, shared as a website. Its id is what
    // its address ends in. `public` says whether anyone with the address may open it, where
    // otherwise only the workspace's people may. `secret` signs the addresses its files are
    // served at. It was shared by an agent or by a person, and one place is shared once.
    `CREATE TABLE dc_sites (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      public INTEGER NOT NULL DEFAULT 0,
      secret TEXT NOT NULL,
      agent_id TEXT,
      user_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (workspace_id, path)
    )`,
    "CREATE INDEX dc_sites_by_workspace ON dc_sites (workspace_id, created_at)",
  ],
  [
    // A Dood: a creature hatched by someone with no account, on a page anyone can open. `key_hash`
    // is of the key its hatcher keeps, which is what lets them claim it. `owner_id` is who did,
    // and `agent_id` the agent it became. `joy` is how many treats it has toward its owner's next
    // present, and `banked` how many it was given while its owner had no agent to give them to.
    `CREATE TABLE dc_doods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      seed TEXT NOT NULL,
      outfit TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      owner_id TEXT,
      agent_id TEXT,
      pats INTEGER NOT NULL DEFAULT 0,
      treats INTEGER NOT NULL DEFAULT 0,
      joy INTEGER NOT NULL DEFAULT 0,
      banked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    "CREATE INDEX dc_doods_by_owner ON dc_doods (owner_id, created_at)",
    "CREATE INDEX dc_doods_by_agent ON dc_doods (agent_id)",
    // Who has given a Dood its treat for the day. `giver` is a hash of where they asked from.
    `CREATE TABLE dc_dood_treats (
      dood_id TEXT NOT NULL,
      giver TEXT NOT NULL,
      day INTEGER NOT NULL,
      PRIMARY KEY (dood_id, giver, day)
    )`,
    // Those let in off the waiting list (`DC_SIGNUP=waitlist`), and by whom where it was a person.
    `CREATE TABLE dc_admitted (
      user_id TEXT PRIMARY KEY,
      admitted_at INTEGER NOT NULL,
      admitted_by TEXT
    )`,
  ],
  [
    // When each person last looked at an agent, which is what says whether it has something new
    // for them. Each person has their own, so one looking does not count for the rest of a team.
    // No row is someone who has not looked since this was kept.
    `CREATE TABLE dc_agent_seen (
      user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      seen_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, agent_id)
    )`,
  ],
  // The port a desktop app waits at for a sign-in it sent to its owner's browser, if one does.
  ["ALTER TABLE dc_oauth_states ADD COLUMN desktop_port INTEGER"],
  [
    // How long each person has been on voice calls that the server's own sign-in paid for, by
    // month, which is what a monthly limit is counted against.
    `CREATE TABLE dc_call_usage (
      user_id TEXT NOT NULL,
      month TEXT NOT NULL,
      seconds INTEGER NOT NULL,
      PRIMARY KEY (user_id, month)
    )`,
  ],
  [
    // The order each person put a workspace's Doods in by hand: their ids from the top down, as
    // JSON. Each person has their own, so one moving a team's Doods leaves the rest as they were.
    // No row is a workspace that was never put in order, whose Doods are latest-first.
    `CREATE TABLE dc_agent_order (
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      agent_ids TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, workspace_id)
    )`,
  ],
]

const VERSION_KEY = "schema_version"

export async function readMeta(db: AppDatabase, key: string): Promise<string | undefined> {
  return (await db.get<{ value: string }>("SELECT value FROM dc_meta WHERE key = ?", key))?.value
}

export async function writeMeta(db: AppDatabase, key: string, value: string): Promise<void> {
  await db.run(
    "INSERT INTO dc_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    key,
    value,
  )
}

/**
 * Bring the app tables up to date. Each migration and its version bump land in one batch.
 * `upTo` stops at an earlier version, for testing what a migration does to rows from before it.
 *
 * Several requests may be doing this at once, each on its own: the first requests after a start,
 * or two isolates. A migration that fails because another ran it meanwhile is passed over.
 */
export async function migrateAppDatabase(db: AppDatabase, upTo = MIGRATIONS.length): Promise<void> {
  await db.run("CREATE TABLE IF NOT EXISTS dc_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  const version = async () => Number((await readMeta(db, VERSION_KEY)) ?? "0")
  const target = Math.min(upTo, MIGRATIONS.length)
  let current = await version()
  while (current < target) {
    try {
      await db.batch([
        ...MIGRATIONS[current]!.map((sql) => ({ sql })),
        {
          sql: "INSERT INTO dc_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
          params: [VERSION_KEY, String(current + 1)],
        },
      ])
      current++
    } catch (error) {
      const reached = await version()
      if (reached <= current) throw error
      current = reached
    }
  }
}
