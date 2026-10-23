import {
  type AgentUsage,
  filterModels,
  type ModelOption,
  THINKING_LEVELS,
  type ThinkingLevel,
} from "@do-computer/protocol"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"

const TOOL = "settings"
/** How many models are named when the agent looks at what it could run on. */
const MAX_MODELS_SHOWN = 12

/** A change that cannot be made, with the reason, as opposed to a bug. */
export class SettingsError extends Error {}

export type SettingsState = {
  model: string
  thinking: ThinkingLevel
  timezone: string | null
}

export type SettingsChange = {
  model?: string
  thinking?: string
  timezone?: string
}

export type SettingsOptions = {
  /** The models the agent can be set to, read each time: its workspace can sign in to more. */
  readonly models: () => Promise<readonly ModelOption[]>
  readonly state: (context: Context) => Promise<SettingsState>
  /** Make a change, checked as the app's own settings are. Rejects with `SettingsError`. */
  readonly update: (change: SettingsChange, context: Context) => Promise<void>
  readonly usage: (context: Context) => Promise<AgentUsage>
}

const dollars = (cost: number) => (cost > 0 && cost < 0.01 ? "under $0.01" : `$${cost.toFixed(2)}`)

const describeModel = (model: ModelOption) =>
  `${model.id} (${model.name}; $${model.inputCost} in and $${model.outputCost} out per million tokens${
    model.thinking !== undefined && model.thinking.length > 0
      ? `; thinking: ${model.thinking.join(", ")}`
      : ""
  })`

/**
 * The agent's way to its own settings: the model it runs on, how hard it thinks, its timezone,
 * and what it has cost so far.
 */
export function settingsExtension(options: SettingsOptions): Extension {
  const reply = (text: string) => ({ output: [{ type: "text" as const, text }] })
  const fail = (text: string) => ({ isError: true, ...reply(text) })
  const tool = defineTool({
    name: TOOL,
    // Described to the model only once it loads it (`deferred.ts`).
    deferred: true,
    description:
      "See and change your own settings. " +
      'action "get" shows the model you run on, how hard you think before answering, your timezone, what you have cost so far, and the models you could be set to; pass `find` to search the models by name. ' +
      '"set" changes `model` (an id from "get"), `thinking` or `timezone` (IANA, such as Europe/Paris). Pass only what is changing. A new model or thinking level applies from your next reply. Change these when the person asks, not on your own.',
    parameters: Type.Object({
      action: Type.Union([Type.Literal("get"), Type.Literal("set")]),
      find: Type.Optional(Type.String({ description: "For get: words to search the models by" })),
      model: Type.Optional(Type.String({ description: "For set: a model id, as get shows it" })),
      thinking: Type.Optional(
        Type.String({ description: `For set: one of ${THINKING_LEVELS.join(", ")}` }),
      ),
      timezone: Type.Optional(Type.String({ description: "For set: an IANA timezone" })),
    }),
    execute: async (args, _api, context) => {
      if (args.action === "get") {
        const state = await options.state(context)
        const usage = await options.usage(context)
        const models = await options.models()
        const current = models.find((model) => model.id === state.model)
        const query = (args.find ?? "").trim()
        const found =
          query === ""
            ? models.filter((model) => model.recommended === true)
            : filterModels(models, query)
        // With nothing suggested and nothing asked for, the first few are better than none.
        const offered = (found.length === 0 && query === "" ? models : found).filter(
          (model) => model.id !== state.model,
        )
        const lines = [
          `Model: ${current === undefined ? state.model : describeModel(current)}`,
          `Thinking: ${state.thinking}`,
          `Timezone: ${state.timezone ?? "not known yet"}`,
          `Cost so far: ${dollars(usage.total.cost)} over ${usage.chats} chat${usage.chats === 1 ? "" : "s"} and runs${
            usage.scheduled.cost > 0
              ? `, of which ${dollars(usage.scheduled.cost)} in scheduled runs`
              : ""
          }.${
            usage.models.length === 0
              ? ""
              : ` By model: ${usage.models
                  .slice(0, 6)
                  .map((model) => `${model.model} ${dollars(model.cost)}`)
                  .join(", ")}.`
          }`,
          offered.length === 0
            ? query === ""
              ? "There is no other model to change to."
              : `No model matches "${query}".`
            : `${query === "" ? "Other models you could be set to" : `Models matching "${query}"`}:\n${offered
                .slice(0, MAX_MODELS_SHOWN)
                .map((model) => `- ${describeModel(model)}`)
                .join("\n")}${
                offered.length > MAX_MODELS_SHOWN || query === ""
                  ? `\n(${models.length} models in all; pass \`find\` to search them.)`
                  : ""
              }`,
        ]
        return reply(lines.join("\n"))
      }
      const text = (value: string | undefined) => {
        const trimmed = value?.trim()
        return trimmed === undefined || trimmed === "" ? undefined : trimmed
      }
      const change: SettingsChange = {
        model: text(args.model),
        thinking: text(args.thinking)?.toLowerCase(),
        timezone: text(args.timezone),
      }
      const changing = Object.entries(change).filter(([, value]) => value !== undefined)
      if (changing.length === 0) {
        return fail('"set" needs at least one of model, thinking, timezone.')
      }
      try {
        await options.update(change, context)
      } catch (error) {
        if (error instanceof SettingsError) return fail(error.message)
        throw error
      }
      const state = await options.state(context)
      return reply(
        `Saved. Model: ${state.model}. Thinking: ${state.thinking}. Timezone: ${state.timezone ?? "not known yet"}.${
          change.model !== undefined || change.thinking !== undefined
            ? " The model and thinking level apply from your next reply."
            : ""
        }`,
      )
    },
  })
  return defineExtension({ name: "dc.settings", tools: [tool] })
}
