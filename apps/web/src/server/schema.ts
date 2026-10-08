import type { AppDatabase } from "@durable-computer/runtime"

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
 */
export async function migrateAppDatabase(db: AppDatabase, upTo = MIGRATIONS.length): Promise<void> {
  await db.run("CREATE TABLE IF NOT EXISTS dc_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  const current = Number((await readMeta(db, VERSION_KEY)) ?? "0")
  for (let version = current; version < Math.min(upTo, MIGRATIONS.length); version++) {
    await db.batch([
      ...MIGRATIONS[version]!.map((sql) => ({ sql })),
      {
        sql: "INSERT INTO dc_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params: [VERSION_KEY, String(version + 1)],
      },
    ])
  }
}
