import {
  type CallAllowance,
  type CallDirectory,
  type CallPass,
  DEPLOYMENT_MODEL_ACCESS,
} from "@do-computer/agent"
import { type CallScriptStep, personalWorkspaceId } from "@do-computer/protocol"
import type { ActorNamespace, ActorStub, AppDatabase } from "@do-computer/runtime"
import { isAdminAccount } from "./passwords-directory.ts"
import type { Config } from "./platform.ts"

/**
 * Who may call a Dood out loud, and which sign-in places the call. Apart from the gateway, since
 * it runs where an agent does, which is not always where requests are served: it is handed the
 * database, the actors that keep sign-ins, and the settings.
 */

type Settings = Pick<
  Config,
  "calls" | "callMinutes" | "callMonthlyMinutes" | "callScript" | "adminEmails" | "signup"
>

/** How long nothing may be said on a call before the device hangs up. */
const QUIET_SECONDS = 120

/** The month a moment is in, as minutes are counted: by the calendar, in UTC. */
export const monthOf = (at: number) => new Date(at).toISOString().slice(0, 7)

/** What a `scripted` call plays where a deployment asks for one, which only a test does. */
const SCRIPT: CallScriptStep[] = [
  { hear: "What did I say before the call?" },
  { handOn: true },
  { hear: "Thanks, that is all." },
  { say: "Any time." },
]

type Kept = { type?: string; key?: unknown; access?: unknown; accountId?: unknown }

/** What an actor that keeps sign-ins has for a provider. Undefined where it has nothing, or cannot say. */
async function kept(actor: ActorStub, provider: string): Promise<Kept | undefined> {
  try {
    const response = await actor.fetch(new Request(`http://models/credentials/${provider}`))
    if (!response.ok) return undefined
    return ((await response.json()) as { credential?: Kept | null }).credential ?? undefined
  } catch {
    return undefined
  }
}

/**
 * What one keeper of sign-ins can place a call with: a ChatGPT subscription signed in as OpenAI
 * Codex, which costs nothing beyond the plan, before an OpenAI API key. Signing in with ChatGPT
 * the newer way keeps a token under `openai` too, and that one cannot place a call.
 */
async function passOf(actor: ActorStub, paidBy: CallPass["paidBy"]): Promise<CallPass | undefined> {
  const codex = await kept(actor, "openai-codex")
  if (
    codex?.type === "oauth" &&
    typeof codex.access === "string" &&
    typeof codex.accountId === "string"
  ) {
    return { dialect: "codex", accessToken: codex.access, accountId: codex.accountId, paidBy }
  }
  const key = await kept(actor, "openai")
  if (key?.type === "api_key" && typeof key.key === "string" && key.key !== "") {
    return { dialect: "openai", apiKey: key.key, paidBy }
  }
  return undefined
}

export function callDirectory(
  db: AppDatabase,
  modelAccess: ActorNamespace,
  settings: Settings,
  now: () => number = Date.now,
): CallDirectory {
  const usedThisMonth = async (userId: string): Promise<number> =>
    (
      await db.get<{ seconds: number }>(
        "SELECT seconds FROM dc_call_usage WHERE user_id = ? AND month = ?",
        userId,
        monthOf(now()),
      )
    )?.seconds ?? 0

  return {
    async allow(agentId, caller): Promise<CallAllowance> {
      if (settings.calls === "off") return { refused: "off" }
      if (settings.calls === "admins") {
        const account =
          caller === undefined
            ? undefined
            : await db.get<{ email: string | null; emailVerified: unknown }>(
                "SELECT email, emailVerified FROM user WHERE id = ?",
                caller.id,
              )
        if (account === undefined || !isAdminAccount(settings, account)) {
          return { refused: "admins" }
        }
      }
      const limits = { maxSeconds: settings.callMinutes * 60, quietSeconds: QUIET_SECONDS }
      if (settings.callScript) {
        return { pass: { dialect: "scripted", script: SCRIPT, paidBy: "server" }, ...limits }
      }
      const row = await db.get<{ owner_id: string; workspace_id: string | null }>(
        "SELECT owner_id, workspace_id FROM dc_agents WHERE id = ?",
        agentId,
      )
      // The nearest sign-in pays: the workspace's own before the server's.
      const pass =
        (row === undefined
          ? undefined
          : await passOf(
              modelAccess.get(row.workspace_id ?? personalWorkspaceId(row.owner_id)),
              "workspace",
            )) ?? (await passOf(modelAccess.get(DEPLOYMENT_MODEL_ACCESS), "server"))
      if (pass === undefined) return { refused: "sign-in" }
      if (pass.paidBy === "server" && settings.callMonthlyMinutes > 0 && caller !== undefined) {
        const left = settings.callMonthlyMinutes * 60 - (await usedThisMonth(caller.id))
        if (left <= 0) return { refused: "minutes" }
        return { pass, ...limits, maxSeconds: Math.min(limits.maxSeconds, left) }
      }
      return { pass, ...limits }
    },

    async spent(callerId, seconds) {
      if (callerId === null || seconds <= 0) return
      await db.run(
        `INSERT INTO dc_call_usage (user_id, month, seconds) VALUES (?, ?, ?)
           ON CONFLICT (user_id, month) DO UPDATE SET seconds = seconds + excluded.seconds`,
        callerId,
        monthOf(now()),
        Math.round(seconds),
      )
    },
  }
}
