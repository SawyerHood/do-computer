import type { Config } from "./platform.ts"
import type { GithubUser } from "./teams.ts"

/**
 * Look a GitHub username up. Undefined when there is no such account; throws when GitHub could
 * not be asked. The deployment's GitHub app, where it has one, raises how often it may ask.
 */
export async function findGithubUser(
  config: Config,
  login: string,
  fetcher: typeof fetch = fetch,
): Promise<GithubUser | undefined> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "do-computer",
  }
  if (config.githubClientId && config.githubClientSecret) {
    headers.authorization = `Basic ${btoa(`${config.githubClientId}:${config.githubClientSecret}`)}`
  }
  const response = await fetcher(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers,
  })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  const user = (await response.json()) as {
    id?: number
    login?: string
    name?: string | null
    type?: string
  }
  // An organization has a page under the same address and cannot sign in.
  if (typeof user.id !== "number" || typeof user.login !== "string" || user.type !== "User") {
    return undefined
  }
  return { id: String(user.id), login: user.login, name: user.name ?? null }
}
