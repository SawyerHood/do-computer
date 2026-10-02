import { DurableObject } from "cloudflare:workers"
import {
  type ContainerLike,
  ContainerMachine,
  DEFAULT_HOME,
  DEFAULT_IMAGE,
  DEFAULT_INSTANCE,
  type MachineConfig,
} from "./machine.ts"

export type ContainerSandboxOptions<Env> = {
  /** Read the machine's settings from the Worker's environment. */
  readonly config?: (env: Env) => Partial<MachineConfig>
}

/**
 * Durable Object class for one agent's computer on Cloudflare Containers. Address it by the
 * agent's id and talk to it with `containerSandbox()`.
 *
 * The class needs a `containers` entry with `"scheduling_policy": "durable_object"` in the Wrangler
 * configuration. Without one the object still exists, and says so when it is used.
 */
export function createContainerSandboxClass<Env>(options: ContainerSandboxOptions<Env> = {}) {
  return class ContainerSandbox extends DurableObject<Env> {
    readonly #machine: ContainerMachine

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env)
      const storage = ctx.storage
      const config: MachineConfig = {
        image: DEFAULT_IMAGE,
        instance: DEFAULT_INSTANCE,
        internet: true,
        home: DEFAULT_HOME,
        ...options.config?.(env),
      }
      this.#machine = new ContainerMachine(
        () => ctx.container as ContainerLike | undefined,
        {
          get: (key) => storage.get(key),
          put: (entries) => storage.put(entries),
          delete: async (keys) => void (await storage.delete(keys)),
          getAlarm: () => storage.getAlarm(),
          setAlarm: (at) => storage.setAlarm(at),
        },
        config,
      )
      if (ctx.container?.running) void ctx.blockConcurrencyWhile(() => this.#machine.resumed())
    }

    override fetch(request: Request): Promise<Response> {
      return this.#machine.fetch(request)
    }

    override alarm(): Promise<void> {
      return this.#machine.alarm()
    }
  }
}
