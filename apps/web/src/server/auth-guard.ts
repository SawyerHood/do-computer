import { AsyncLocalStorage } from "node:async_hooks"

/** Where Better Auth keeps what every copy of it in a process shares. */
const SHARED = Symbol.for("better-auth:global")

/** The stores Better Auth keeps there. It makes each the first time something asks for it. */
export const AUTH_STORES = [
  "requestStateAsyncStorage",
  "endpointContextAsyncStorage",
  "adapterAsyncStorage",
] as const

type Shared = { version?: string; epoch: number; context: Record<string, unknown> }

/**
 * Make Better Auth's stores before it asks for them.
 *
 * Left to itself it makes each on the first call that needs one, and to make one it waits for
 * `import("node:async_hooks")`: a promise it keeps for as long as the process lives, and waits
 * on in every call until the store is there. On Workers a promise is settled by the request
 * that was running when it was started. If that request goes away first, as when a browser
 * gives up on it, the promise is never settled, the store is never made, and every later check
 * of who is signed in waits in that isolate for good. Nothing else is wrong there, so the pages
 * arrive and then nothing in them does. On do.computer on 2026-10-10 a quarter of connections
 * were to an isolate like that, a quarter of an hour after a deploy.
 *
 * Made here, from an import that nothing waits for, the stores are found already there and
 * that promise is never asked.
 */
export function seedAuthStores(): void {
  const holder = globalThis as unknown as Record<symbol, Shared | undefined>
  const shared = (holder[SHARED] ??= { epoch: 1, context: {} })
  for (const store of AUTH_STORES) shared.context[store] ??= new AsyncLocalStorage()
}

/**
 * Better Auth is not to compare the tables with what it expects.
 *
 * It otherwise does when an instance is first used, once, and every call on that instance waits
 * for that one comparison: a promise kept on the instance. On Workers it is never finished if
 * the request it was started in goes away first, which a page does to one of its requests each
 * time it loads, and every later call then waits for good. This is the promise that was found
 * to be the one, after `seedAuthStores` had not been enough. The tables are brought up to date
 * before an instance is made, so there is nothing for the comparison to find.
 */
export const NO_SHARED_SCHEMA_CHECK = { database: { validateSchema: false } } as const

/** The stores as they are now, by name: for the test that says none is left to be waited for. */
export function authStores(): Record<string, unknown> {
  const holder = globalThis as unknown as Record<symbol, Shared | undefined>
  return holder[SHARED]?.context ?? {}
}

const STUCK = Symbol("stuck")

/**
 * Ask, and if no answer comes in `ms`, ask once more after `renew` has let go of whatever the
 * first was waiting on. If that is not answered either, throw: a request that fails can be
 * made again, and one that waits for good cannot.
 */
export async function askTwice<T>(
  ask: () => Promise<T>,
  options: { ms: number; renew: () => void; report?: (message: string) => void },
): Promise<T> {
  for (let tries = 1; ; tries++) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const stuck = new Promise<typeof STUCK>((resolve) => {
      timer = setTimeout(() => resolve(STUCK), options.ms)
    })
    const asked = ask()
    // Whichever loses is still listened to, so that its failing later is not left unheard.
    asked.catch(() => {})
    try {
      const answer = await Promise.race([asked, stuck])
      if (answer !== STUCK) return answer
    } finally {
      clearTimeout(timer)
    }
    options.renew()
    if (tries >= 2) {
      options.report?.(`no answer in ${options.ms} ms, twice: giving up`)
      throw new Error("Who is signed in could not be checked. Try again in a moment.")
    }
    options.report?.(`no answer in ${options.ms} ms: asking again of a new instance`)
  }
}
