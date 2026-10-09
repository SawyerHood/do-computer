const LAST_AGENT_KEY = "dc-last-agent"

/**
 * The agent that was open here last. Kept by the browser, so each place the app is used, the
 * desktop app among them, opens on the agent it was left on.
 */
export function lastAgent(): string | undefined {
  try {
    return localStorage.getItem(LAST_AGENT_KEY) ?? undefined
  } catch {
    // Storage can be unavailable; nothing is then remembered.
    return undefined
  }
}

/** Keep which agent is open, so that the app opens on it the next time it is started. */
export function rememberLastAgent(agentId: string): void {
  try {
    if (localStorage.getItem(LAST_AGENT_KEY) !== agentId) {
      localStorage.setItem(LAST_AGENT_KEY, agentId)
    }
  } catch {
    // The app then opens on the first agent, as it does where nothing has been open.
  }
}

/** Forget an agent that can no longer be opened, if it is the one that was kept. */
export function forgetLastAgent(agentId: string): void {
  try {
    if (localStorage.getItem(LAST_AGENT_KEY) === agentId) localStorage.removeItem(LAST_AGENT_KEY)
  } catch {
    // There was nothing kept to forget.
  }
}
