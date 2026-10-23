import { Type } from "@earendil-works/pi-ai"
import {
  type Agent,
  defineDoc,
  defineExtension,
  defineTool,
  type Extension,
  section,
  type ToolRegistration,
} from "@earendil-works/pi-durable"

/**
 * Tools a chat is not told the whole of until it needs them.
 *
 * A tool marked `deferred` (pi-durable's own flag) is left out of a request's list of tools, so
 * its schema costs nothing in a chat that never uses it. Each of the agent's own is named in the
 * prompt with one short line, and `load_tools` loads it: pi-durable writes the name into the
 * conversation's `modelTools`, and the next request offers it. Anthropic is sent a loaded tool as
 * an addition after what it has cached, so loading one costs no cache. A loaded tool stays for
 * the rest of the chat, through a compaction too.
 *
 * A connector's tools are deferred as well, and are not named: there may be hundreds, and
 * `tool_search` finds them. `load_tools` loads one by its exact name too.
 */
export const LOAD_TOOLS = "load_tools"

/**
 * The deferred tools the main chat's transcript was looked through for, by the main chat, so
 * that each is looked for once (`#keepUsed` in `actor.ts`): those it had called are loaded for it.
 */
export const DeferredSeenDoc = defineDoc<{ chatId: string | null; seen: string[] }>({
  kind: "dc.deferred-seen",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ chatId: null, seen: [] }),
})

/** The section that lists the deferred tools. */
export const DEFERRED_SECTION = "deferred-tools"

/** The longest line a deferred tool is named with. */
const SUMMARY_CHARS = 110

/** A tool's description, to its first sentence, short enough for one line of the prompt. */
export function summaryOf(description: string): string {
  const flat = description.replace(/\s+/g, " ").trim()
  const end = flat.search(/[.:;](\s|$)/)
  const first = end === -1 ? flat : flat.slice(0, end)
  return first.length <= SUMMARY_CHARS
    ? first
    : `${first.slice(0, SUMMARY_CHARS - 1).replace(/\s+\S*$/, "")}…`
}

type Listed = Pick<ToolRegistration, "name" | "description" | "deferred" | "callers">

/** A connector's tool, named `<connector>__<tool>` (`connectorToolName`). */
const isConnectorTool = (name: string) => name.includes("__")

/**
 * The deferred tools a chat may load, loaded or not, by name: so the list stays the same as tools
 * are loaded, and the prompt with it. `named` leaves out a connector's, which are not named.
 */
export function deferredOf(agent: Pick<Agent, "tools" | "deferred">, named = false): Listed[] {
  const byName = new Map<string, Listed>()
  for (const tool of [...agent.tools, ...agent.deferred]) {
    if (tool.deferred !== true || (named && isConnectorTool(tool.name))) continue
    if (tool.callers !== undefined && !tool.callers.includes("model")) continue
    byName.set(tool.name, tool)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The prompt's lines about them, or nothing where there are none. */
export function deferredSection(tools: readonly Listed[]): string | undefined {
  if (tools.length === 0) return undefined
  return [
    `Some tools are only described to you once loaded. To use one, first call \`${LOAD_TOOLS}\` with its name; it is offered from your next call and stays for the rest of this conversation. Calling one before that fails as not available.`,
    ...tools.map((tool) => `- ${tool.name}: ${summaryOf(tool.description)}`),
  ].join("\n")
}

/** The `load_tools` tool and the section that names what it loads. */
export function deferredTools(): Extension {
  return defineExtension({
    name: "dc.deferred",
    sections: [section(DEFERRED_SECTION, ({ agent }) => deferredSection(deferredOf(agent, true)))],
    tools: [
      defineTool({
        name: LOAD_TOOLS,
        description:
          "Load tools the prompt lists as loaded on demand, by name, so you can call them from your next call. A loaded tool stays for the rest of this conversation.",
        parameters: Type.Object({
          names: Type.Array(Type.String(), { description: "The tools to load", minItems: 1 }),
        }),
        callers: ["model"],
        replay: "safe",
        execute: async ({ names }, api, context) => {
          const agent = await api.agent(context)
          // Any deferred tool, by its exact name: a connector's too, once its name is known.
          const known = new Set(deferredOf(agent).map((tool) => tool.name))
          const offered = new Set(agent.tools.map((tool) => tool.name))
          const loaded: string[] = []
          const already: string[] = []
          const unknown: string[] = []
          for (const name of new Set(names.map((one) => one.trim()))) {
            if (offered.has(name)) already.push(name)
            else if (known.has(name)) loaded.push(name)
            else unknown.push(name)
          }
          const lines = [
            loaded.length === 0
              ? ""
              : `Loaded ${loaded.join(", ")}: you can call ${loaded.length === 1 ? "it" : "them"} from your next call.`,
            already.length === 0 ? "" : `Already available: ${already.join(", ")}.`,
            unknown.length === 0
              ? ""
              : `Not tools that can be loaded here: ${unknown.join(", ")}. The prompt lists the ones there are.`,
          ].filter(Boolean)
          return {
            output: [{ type: "text", text: lines.join("\n") }],
            ...(loaded.length === 0 && already.length === 0 ? { isError: true } : {}),
            ...(loaded.length === 0 ? {} : { control: { addTools: loaded } }),
          }
        },
      }),
    ],
  })
}

type Said = { role: string; content?: unknown }

/** The tools among `names` that a conversation's messages call. */
export function calledIn(messages: readonly Said[], names: ReadonlySet<string>): string[] {
  const called = new Set<string>()
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue
    for (const block of message.content as { type?: string; name?: string }[]) {
      if (block.type === "toolCall" && block.name !== undefined && names.has(block.name)) {
        called.add(block.name)
      }
    }
  }
  return [...called].sort()
}

/** The stored filter with `names` loaded as well, keeping what it already loaded or took away. */
export function withLoaded(
  stored: { add?: readonly string[]; remove?: readonly string[] } | readonly string[] | undefined,
  names: readonly string[],
): { add: string[]; remove?: string[] } {
  const was =
    stored === undefined || Array.isArray(stored)
      ? {}
      : (stored as { add?: readonly string[]; remove?: readonly string[] })
  const add = [...(was.add ?? [])]
  for (const name of names) if (!add.includes(name)) add.push(name)
  return was.remove === undefined ? { add } : { add, remove: [...was.remove] }
}
