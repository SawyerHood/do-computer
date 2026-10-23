import type { SkillDetail, SkillSource, SkillSummary } from "@do-computer/protocol"
import type { Context } from "@earendil-works/chord"
import type { ExecutionEnv } from "@earendil-works/pi-durable/env"
import { Type } from "@earendil-works/pi-ai"
import {
  defineDoc,
  defineDocFamily,
  defineExtension,
  defineTool,
  type Extension,
  type Harness,
  section,
  type ToolRegistration,
} from "@earendil-works/pi-durable"
import { BUNDLED_SKILLS } from "./bundled-skills.ts"
import { fetchSkill } from "./skill-fetch.ts"
import {
  parseFrontmatter,
  renderSkill,
  SKILL_FILE,
  SkillError,
  validateSkill,
  validateSkillFile,
  validateSkillName,
} from "./skill-format.ts"
import { own } from "./own.ts"

export { SkillError } from "./skill-format.ts"

/** The skill list in the prompt stops growing here; skills past it are still loadable by name. */
const PROMPT_BUDGET_CHARS = 8_000
export const MAX_SKILLS = 200

type SkillEntry = {
  description: string
  source: SkillSource
  origin: string | null
  enabled: boolean
  createdAt: number
  updatedAt: number
  files: string[]
}

type SkillsState = {
  skills: Record<string, SkillEntry>
  /** Bundled skills the user removed, so they are not added back. */
  removedBundled: string[]
}

/** What skills exist: small, in the prompt on every request, watched by clients. */
export const SkillsDoc = defineDoc<SkillsState>({
  kind: "dc.skills",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ skills: {}, removedBundled: [] }),
})

/** One skill's files, keyed by skill name. Kept apart from the index so the index stays small. */
export const SkillFilesDoc = defineDocFamily<{ files: Record<string, string> }, null>({
  kind: "dc.skill",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  family: true,
  initial: () => ({ files: {} }),
})

function summarize(name: string, entry: SkillEntry): SkillSummary {
  return {
    name,
    description: entry.description,
    source: entry.source,
    origin: entry.origin,
    enabled: entry.enabled,
    updatedAt: entry.updatedAt,
    files: [...entry.files],
  }
}

const INTRO = `You have skills: saved instructions for particular kinds of task. Before starting a task that one of them covers, load it with the skill tool (action "view") and follow it. When you work out how to do something you are likely to need again, save it as a skill (action "create") so the next conversation starts from what you learned.`

export type SkillsOptions = {
  readonly now: () => number
  /**
   * The agent's computer at the moment, where a loaded skill's files are copied so its scripts
   * can be run. Asked each time: an agent can be moved to another one.
   */
  readonly realPrograms?: () => boolean
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>
}

/**
 * The agent's skills. They are stored with the agent, not on its computer, so the list is in the
 * prompt without starting a machine and survives the machine being replaced. Loading a skill
 * copies its files into the workspace for any scripts it ships.
 */
export class Skills {
  readonly extension: Extension
  /** The agent's tool for its skills, for whatever gives its calls a computer to copy files to. */
  readonly tool: ToolRegistration
  readonly #options: SkillsOptions
  #harness: Harness | undefined

  constructor(options: SkillsOptions) {
    this.#options = options
    this.tool = this.#tool()
    this.extension = defineExtension({
      name: "dc.skills",
      sections: [
        section("skills", async (input, context) => {
          const index = await input.read.snapshot(SkillsDoc, context)
          const lines: string[] = []
          let used = 0
          let omitted = 0
          for (const [name, entry] of Object.entries(index?.skills ?? {}).sort()) {
            if (!entry.enabled) continue
            const line = `- ${name}: ${entry.description}`
            if (used + line.length > PROMPT_BUDGET_CHARS) omitted++
            else {
              lines.push(line)
              used += line.length
            }
          }
          if (omitted > 0) lines.push(`(${omitted} more; list them with the skill tool.)`)
          return `${INTRO}\n\n${lines.length === 0 ? "(No skills yet.)" : lines.join("\n")}`
        }),
      ],
      tools: [this.tool],
    })
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  #require(): Harness {
    if (this.#harness === undefined) throw new Error("Skills are not attached to a harness")
    return this.#harness
  }

  /**
   * Add bundled skills the agent does not have yet. Removed ones stay removed, and one that needs
   * real programs is held back from an agent whose computer has none.
   */
  async seed(context: Context): Promise<void> {
    const harness = this.#require()
    const index = await harness.snapshot(SkillsDoc, context)
    const realComputer = this.#options.realPrograms?.() === true
    const missing = BUNDLED_SKILLS.filter(
      (skill) =>
        (skill.needsRealComputer !== true || realComputer) &&
        index?.skills[skill.name] === undefined &&
        !index?.removedBundled.includes(skill.name),
    )
    if (index !== undefined && missing.length === 0) return
    const now = this.#options.now()
    await harness.commit(async (tx) => {
      const doc = await tx.doc(SkillsDoc)
      for (const skill of missing) {
        const content = renderSkill(skill.name, skill.description, skill.body)
        doc.skills[skill.name] = {
          description: skill.description,
          source: "bundled",
          origin: null,
          enabled: true,
          createdAt: now,
          updatedAt: now,
          files: [SKILL_FILE, ...Object.keys(skill.files ?? {})],
        }
        ;(await tx.doc(SkillFilesDoc, skill.name, null)).files = {
          [SKILL_FILE]: content,
          ...skill.files,
        }
      }
    }, context)
  }

  async list(context: Context): Promise<SkillSummary[]> {
    const index = await this.#require().snapshot(SkillsDoc, context)
    return Object.entries(index?.skills ?? {})
      .map(([name, entry]) => summarize(name, entry))
      .sort((a, b) => (a.name < b.name ? -1 : 1))
  }

  async get(name: string, context: Context): Promise<SkillDetail> {
    const harness = this.#require()
    const entry = own((await harness.snapshot(SkillsDoc, context))?.skills, name)
    const files = await harness.snapshot(SkillFilesDoc, name, context)
    if (entry === undefined || files === undefined)
      throw new SkillError(`There is no skill "${name}".`)
    return { ...summarize(name, entry), contents: { ...files.files } }
  }

  /** Create or replace a skill from a complete set of files. */
  async save(
    name: string,
    files: Readonly<Record<string, string>>,
    source: SkillSource,
    origin: string | null,
    context: Context,
  ): Promise<SkillSummary> {
    const description = validateSkill(name, files)
    const now = this.#options.now()
    return this.#require().commit(async (tx) => {
      const doc = await tx.doc(SkillsDoc)
      const existing = own(doc.skills, name)
      if (existing === undefined && Object.keys(doc.skills).length >= MAX_SKILLS) {
        throw new SkillError(`There are already ${MAX_SKILLS} skills. Remove one first.`)
      }
      const entry: SkillEntry = {
        description,
        // Editing a bundled or installed skill makes it the agent's own.
        source: existing === undefined ? source : existing.source === source ? source : "agent",
        origin: existing?.origin ?? origin,
        enabled: existing?.enabled ?? true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        files: Object.keys(files).sort(),
      }
      doc.skills[name] = entry
      ;(await tx.doc(SkillFilesDoc, name, null)).files = { ...files }
      return summarize(name, entry)
    }, context)
  }

  async setEnabled(name: string, enabled: boolean, context: Context): Promise<SkillSummary> {
    return this.#require().commit(async (tx) => {
      const entry = own((await tx.doc(SkillsDoc)).skills, name)
      if (entry === undefined) throw new SkillError(`There is no skill "${name}".`)
      entry.enabled = enabled
      return summarize(name, { ...entry, files: [...entry.files] })
    }, context)
  }

  async remove(name: string, context: Context): Promise<void> {
    await this.#require().commit(async (tx) => {
      const doc = await tx.doc(SkillsDoc)
      const entry = own(doc.skills, name)
      if (entry === undefined) throw new SkillError(`There is no skill "${name}".`)
      if (entry.source === "bundled" && !doc.removedBundled.includes(name))
        doc.removedBundled.push(name)
      delete doc.skills[name]
      await tx.retireDoc(SkillFilesDoc, name)
    }, context)
  }

  /** Fetch a skill from a URL the user named and store it. Replaces a skill of the same name. */
  async install(url: string, context: Context): Promise<SkillSummary> {
    const fetched = await fetchSkill(url, this.#options.fetch)
    validateSkillName(fetched.name)
    return this.save(fetched.name, fetched.files, "installed", url.trim(), context)
  }

  /**
   * Copy a skill's files to where the agent is working, so scripts it refers to can be run:
   * into its own folder on the computer the call is for. Does nothing where there is none.
   */
  async #materialize(
    skill: SkillDetail,
    env: ExecutionEnv | undefined,
    context: Context,
  ): Promise<string | undefined> {
    if (env === undefined) return undefined
    const directory = await env.absolutePath(`.agents/skills/${skill.name}`, context)
    if (!directory.ok) return undefined
    for (const [path, content] of Object.entries(skill.contents)) {
      const written = await env.writeFile(`${directory.value}/${path}`, content, context)
      // A computer that cannot be written to still lets the skill be read.
      if (!written.ok) return undefined
    }
    return directory.value
  }

  #tool() {
    return defineTool({
      name: "skill",
      // Described to the model only once it loads it (`deferred.ts`).
      deferred: true,
      description:
        'Load and manage your skills. "view" loads a skill (or one of its files, with `path`) so you can follow it. "create" saves a new skill from `name`, `description` and `content` (the instructions, in Markdown). "write_file" adds or replaces a file in a skill; "patch" replaces `old_text` with `new_text` in one; "remove_file" and "delete" remove things. "list" shows every skill. "install" fetches a skill from a `url` the user gave you.',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("view"),
          Type.Literal("list"),
          Type.Literal("create"),
          Type.Literal("write_file"),
          Type.Literal("patch"),
          Type.Literal("remove_file"),
          Type.Literal("delete"),
          Type.Literal("install"),
        ]),
        name: Type.Optional(
          Type.String({ description: "Skill name: lowercase letters, digits, hyphens" }),
        ),
        description: Type.Optional(
          Type.String({ description: "When to use the skill, in one or two sentences" }),
        ),
        content: Type.Optional(Type.String()),
        path: Type.Optional(
          Type.String({ description: `A file inside the skill. Default ${SKILL_FILE}` }),
        ),
        old_text: Type.Optional(Type.String()),
        new_text: Type.Optional(Type.String()),
        url: Type.Optional(Type.String()),
      }),
      execute: async (args, api, context) => {
        const reply = (text: string, isError = false) => ({
          isError,
          output: [{ type: "text" as const, text }],
        })
        const need = <K extends keyof typeof args>(key: K): NonNullable<(typeof args)[K]> => {
          const value = args[key]
          if (value === undefined || value === "") {
            throw new SkillError(`"${args.action}" needs ${String(key)}.`)
          }
          return value as NonNullable<(typeof args)[K]>
        }
        try {
          switch (args.action) {
            case "list": {
              const skills = await this.list(context)
              return reply(
                skills.length === 0
                  ? "No skills."
                  : skills
                      .map(
                        (skill) =>
                          `${skill.name}${skill.enabled ? "" : " (disabled)"}: ${skill.description}`,
                      )
                      .join("\n"),
              )
            }
            case "view": {
              const skill = await this.get(need("name"), context)
              const path = args.path ?? SKILL_FILE
              const content = own(skill.contents, path)
              if (content === undefined) {
                return reply(
                  `"${skill.name}" has no file ${path}. Its files: ${skill.files.join(", ")}`,
                  true,
                )
              }
              const directory = await this.#materialize(skill, api.env, context)
              const others = skill.files.filter((file) => file !== path)
              const notes = [
                others.length > 0 ? `Other files in this skill: ${others.join(", ")}.` : "",
                directory !== undefined && skill.files.length > 1
                  ? `Its files are in ${directory} on the computer you are working on.`
                  : "",
              ].filter(Boolean)
              return reply(notes.length > 0 ? `${content}\n\n[${notes.join(" ")}]` : content)
            }
            case "create": {
              const name = need("name")
              validateSkillName(name)
              const existing = own(
                (await this.#require().snapshot(SkillsDoc, context))?.skills,
                name,
              )
              if (existing !== undefined) {
                return reply(
                  `A skill named "${name}" already exists. Use write_file or patch to change it.`,
                  true,
                )
              }
              const body = parseFrontmatter(need("content")).body
              const files = { [SKILL_FILE]: renderSkill(name, need("description").trim(), body) }
              const saved = await this.save(name, files, "agent", null, context)
              return reply(`Saved skill "${saved.name}".`)
            }
            case "write_file":
            case "patch":
            case "remove_file": {
              const skill = await this.get(need("name"), context)
              const path = args.path ?? SKILL_FILE
              const files = { ...skill.contents }
              if (args.action === "remove_file") {
                if (path === SKILL_FILE)
                  return reply(
                    `A skill cannot lose its ${SKILL_FILE}; delete the skill instead.`,
                    true,
                  )
                if (own(files, path) === undefined)
                  return reply(`"${skill.name}" has no file ${path}.`, true)
                delete files[path]
              } else if (args.action === "write_file") {
                const content = need("content")
                validateSkillFile(path, content)
                files[path] = content
              } else {
                const current = own(files, path)
                if (current === undefined)
                  return reply(`"${skill.name}" has no file ${path}.`, true)
                const oldText = need("old_text")
                const count = current.split(oldText).length - 1
                if (count !== 1) {
                  return reply(
                    count === 0
                      ? "old_text was not found in the file."
                      : `old_text appears ${count} times; include more of the surrounding text.`,
                    true,
                  )
                }
                files[path] = current.replace(oldText, () => args.new_text ?? "")
              }
              const saved = await this.save(skill.name, files, "agent", null, context)
              return reply(`Updated skill "${saved.name}".`)
            }
            case "delete":
              await this.remove(need("name"), context)
              return reply(`Deleted skill "${args.name}".`)
            case "install": {
              const installed = await this.install(need("url"), context)
              return reply(`Installed skill "${installed.name}": ${installed.description}`)
            }
          }
        } catch (error) {
          if (error instanceof SkillError) return reply(error.message, true)
          throw error
        }
      },
    })
  }
}
