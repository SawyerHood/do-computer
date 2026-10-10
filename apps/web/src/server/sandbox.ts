import type { ComputerChoices } from "@durable-computer/agent"
import type { ComputerKind } from "@durable-computer/protocol"
import { type ActorHost, guardedFetch } from "@durable-computer/runtime"
import { justBashSandbox, type Sandbox } from "@durable-computer/sandbox"
import { daytonaSandbox } from "@durable-computer/sandbox/daytona"
import { type Config, ConfigError, type SandboxKind } from "./platform.ts"

/**
 * Builds the machine behind a key. `host` is the agent asking, for a kind that keeps its files
 * with one agent: such a kind has nothing to build where no agent is asking.
 */
export type SandboxFactory = (key: string, host?: ActorHost) => Sandbox | undefined

/** Providers only one runtime has: Modal's SDK needs Node, and a container needs Cloudflare. */
export type RuntimeProviders = {
  /** Looks a host name up, where the runtime can, so a name pointing inside is refused too. */
  readonly resolveHost?: (hostname: string) => Promise<readonly string[]>
  /** The built-in shell, where the runtime has somewhere better for it than inside the server. */
  readonly shell?: (config: Config) => SandboxFactory
  readonly modal?: (config: Config) => SandboxFactory
  readonly cloudflare?: (config: Config) => SandboxFactory
}

export type Target = "node" | "cloudflare"

/** How each kind is put to whoever is choosing one, in the order they are offered. */
const KINDS: Record<SandboxKind, Omit<ComputerKind, "id">> = {
  "just-bash": {
    label: "Built-in shell",
    description:
      "A lightweight shell with no machine behind it. It has the usual text tools and curl, but no real programs such as git, a package manager or a browser.",
  },
  daytona: {
    label: "Daytona",
    description:
      "A full Linux machine from Daytona, where it can install and run real programs. It stops when idle and starts again when needed.",
  },
  modal: {
    label: "Modal",
    description:
      "A full Linux machine from Modal, where it can install and run real programs. It stops when idle and starts again when needed.",
  },
  cloudflare: {
    label: "Cloudflare container",
    description:
      "A full Linux container on Cloudflare, where it can install and run real programs. It stops when idle and starts again when needed.",
  },
  none: {
    label: "No computer",
    description:
      "No files or shell of its own. It can still work on computers of yours that you pair with it.",
  },
}

/** What a kind lacks on this deployment, as the end of a sentence, or undefined if it can work. */
function lacks(kind: SandboxKind, config: Config, target: Target): string | undefined {
  switch (kind) {
    case "just-bash":
    case "none":
      return undefined
    case "daytona":
      return config.daytona.apiKey === undefined ? "needs DAYTONA_API_KEY" : undefined
    case "modal":
      if (target !== "node") {
        return "only works when the app runs on Node. This is Cloudflare"
      }
      return config.modal.tokenId === undefined || config.modal.tokenSecret === undefined
        ? "needs MODAL_TOKEN_ID and MODAL_TOKEN_SECRET"
        : undefined
    case "cloudflare":
      return target !== "cloudflare"
        ? "only works when the app runs on Cloudflare. This is Node"
        : undefined
  }
}

/**
 * The kinds of computer this deployment offers its agents, and the one a new agent gets.
 *
 * `DC_SANDBOX_KINDS` names them outright. Without it, every kind that has what it needs is
 * offered: the built-in shell and no computer always, Daytona and Modal when their keys are set.
 * A container is only offered when asked for, since nothing here can tell whether one is
 * configured. `DC_SANDBOX`, the default, is always among them.
 */
export function offeredKinds(
  config: Config,
  target: Target,
): { readonly kinds: readonly ComputerKind[]; readonly default: SandboxKind } {
  // A setting that cannot work must stop the server, not quietly give agents something else.
  const missing = lacks(config.sandbox, config, target)
  if (missing !== undefined) {
    throw new ConfigError(`DC_SANDBOX is ${config.sandbox}, which ${missing}.`)
  }
  for (const kind of config.sandboxKinds ?? []) {
    const missing = lacks(kind, config, target)
    if (missing !== undefined) {
      throw new ConfigError(`DC_SANDBOX_KINDS includes ${kind}, which ${missing}.`)
    }
  }
  const offered = new Set<SandboxKind>(
    config.sandboxKinds ??
      (Object.keys(KINDS) as SandboxKind[]).filter(
        (kind) => kind !== "cloudflare" && lacks(kind, config, target) === undefined,
      ),
  )
  offered.add(config.sandbox)
  return {
    kinds: (Object.keys(KINDS) as SandboxKind[])
      .filter((kind) => offered.has(kind))
      .map((id) => ({
        id,
        ...KINDS[id],
        ...(unsharedKinds(target).includes(id) ? { perAgent: true } : {}),
      })),
    default: config.sandbox,
  }
}

/** Builds the computer of one kind. Cheap, and starts nothing; undefined for no computer. */
function factoryFor(
  kind: SandboxKind,
  config: Config,
  providers: RuntimeProviders,
): SandboxFactory | undefined {
  switch (kind) {
    case "none":
      return undefined
    case "just-bash": {
      if (providers.shell !== undefined) return providers.shell(config)
      // This shell runs inside the server, so what it fetches leaves from the server's own
      // network. It may reach the public internet, over http or https, and nothing private.
      const fetcher = config.sandboxNetwork
        ? guardedFetch((input, init) => fetch(input, init), config.allowPrivateHosts, {
            allowHttp: true,
            resolve: providers.resolveHost,
          })
        : undefined
      // Files live in the agent's own database, so this needs no other service, and it is one
      // agent's: nobody else can be given it.
      return (_key, host) =>
        host === undefined
          ? undefined
          : justBashSandbox({ id: host.name, database: host.sql, fetch: fetcher })
    }
    case "daytona": {
      const { apiKey, apiUrl, target, snapshot, image } = config.daytona
      if (apiKey === undefined) throw new ConfigError("Daytona needs DAYTONA_API_KEY.")
      return (key) =>
        daytonaSandbox({
          id: key,
          apiKey,
          apiUrl,
          target,
          snapshot,
          image,
          network: config.sandboxNetwork,
        })
    }
    case "modal":
    case "cloudflare": {
      const provider = providers[kind]
      if (provider === undefined) throw new ConfigError(`This runtime cannot provide ${kind}.`)
      return provider(config)
    }
  }
}

/**
 * The kinds whose machine is one agent's and does not serve another. On Node the built-in shell
 * keeps its files in its agent's own database, so it is one. On Cloudflare its files are in an
 * object of their own, and it is a machine like the others.
 */
export const unsharedKinds = (target: Target): readonly string[] =>
  target === "node" ? ["just-bash"] : []

/**
 * The machines this deployment can make. A remote machine is created the first time something
 * runs on it, and named after its key, so the same key always finds the same machine.
 */
export function computerChoices(
  config: Config,
  target: Target,
  providers: RuntimeProviders,
): ComputerChoices {
  const { kinds, default: fallback } = offeredKinds(config, target)
  // Checked once, here, so a wrong setting stops the server instead of failing each agent.
  const factories = new Map(
    kinds.map((kind) => [kind.id, factoryFor(kind.id as SandboxKind, config, providers)]),
  )
  return {
    kinds,
    default: fallback,
    create: (kind, key, host) => factories.get(kind)?.(key, host),
  }
}
