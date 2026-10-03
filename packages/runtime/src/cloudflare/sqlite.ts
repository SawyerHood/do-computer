import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "../index.ts"
import { SerialQueue } from "../serial-queue.ts"

type Binding = ArrayBuffer | string | number | null

function bind(value: SqliteValue): Binding {
  // Durable Object SQL has no bigint binding. pi-durable keeps its 64-bit counter as TEXT, so a
  // bigint here is always within the safe integer range.
  if (typeof value === "bigint") return Number(value)
  if (value instanceof Uint8Array) return value.slice().buffer
  return value
}

function unbind<T extends object>(row: Record<string, unknown>): T {
  for (const key in row) {
    const value = row[key]
    if (value instanceof ArrayBuffer) row[key] = new Uint8Array(value)
  }
  return row as T
}

abstract class DurableObjectExecutor implements SqliteExecutor {
  constructor(protected readonly sql: SqlStorage) {}

  protected abstract operation<T>(run: () => T): Promise<T>

  exec(sql: string): Promise<void> {
    return this.operation(() => {
      this.sql.exec(sql)
    })
  }

  run(sql: string, ...params: SqliteValue[]): Promise<void> {
    return this.operation(() => {
      this.sql.exec(sql, ...params.map(bind))
    })
  }

  get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
    return this.operation(() => {
      const row = this.sql.exec(sql, ...params.map(bind)).toArray()[0]
      return row === undefined ? undefined : unbind<T>(row)
    })
  }

  all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
    return this.operation(() =>
      this.sql
        .exec(sql, ...params.map(bind))
        .toArray()
        .map((row) => unbind<T>(row)),
    )
  }
}

class DurableObjectTransaction extends DurableObjectExecutor {
  constructor(
    sql: SqlStorage,
    private readonly scope: { active: boolean },
  ) {
    super(sql)
  }

  protected async operation<T>(run: () => T): Promise<T> {
    if (!this.scope.active) throw new Error("SQLite transaction handle is no longer active")
    return run()
  }
}

/**
 * `SqliteDatabase` over a Durable Object's SQLite storage.
 *
 * Durable Object SQL rejects `BEGIN`/`COMMIT` statements, so a transaction runs inside
 * `storage.transaction()`, which rolls back when its callback rejects. The queue keeps unrelated
 * statements out of an open transaction, as the facade's contract requires.
 */
export class DurableObjectSqliteDatabase extends DurableObjectExecutor implements SqliteDatabase {
  private readonly queue = new SerialQueue()

  constructor(private readonly storage: DurableObjectStorage) {
    super(storage.sql)
  }

  protected operation<T>(run: () => T): Promise<T> {
    return this.queue.run(run)
  }

  transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
    return this.queue.runAsync(() =>
      this.storage.transaction(async () => {
        const scope = { active: true }
        try {
          return await callback(new DurableObjectTransaction(this.sql, scope))
        } finally {
          scope.active = false
        }
      }),
    )
  }

  /** The Durable Object owns the storage; there is nothing to release. */
  async close(): Promise<void> {}
}
