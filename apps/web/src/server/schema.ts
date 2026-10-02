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
    // A computer of the user's, paired with one agent. Its daemon authenticates with a token
    // whose hash is stored; the hash is null until the daemon has collected the token.
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

/** Bring the app tables up to date. Each migration and its version bump land in one batch. */
export async function migrateAppDatabase(db: AppDatabase): Promise<void> {
  await db.run("CREATE TABLE IF NOT EXISTS dc_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  const current = Number((await readMeta(db, VERSION_KEY)) ?? "0")
  for (let version = current; version < MIGRATIONS.length; version++) {
    await db.batch([
      ...MIGRATIONS[version]!.map((sql) => ({ sql })),
      {
        sql: "INSERT INTO dc_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params: [VERSION_KEY, String(version + 1)],
      },
    ])
  }
}
