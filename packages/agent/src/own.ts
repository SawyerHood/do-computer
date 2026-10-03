/**
 * `record[key]`, but only when the record itself has that entry.
 *
 * Ids and names arrive from URLs and from the model, and are used to look things up in plain
 * objects. Every object also answers to `__proto__`, `constructor` and the rest of what it
 * inherits, so a plain lookup of such a name finds something that is not an entry, and a write
 * through it would change every object in the process. On Node that process is shared by all
 * users.
 */
export function own<T>(
  record: Readonly<Record<string, T>> | undefined,
  key: string,
): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined
}

/** Whether `name` is something every object inherits, and so can never be an id or a name. */
export function isInherited(name: string): boolean {
  return name in Object.prototype
}
