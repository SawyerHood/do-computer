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

/**
 * The agent the app's own address has just led to, if it has not been heard from yet. It was
 * gone to without asking whether it is still there.
 */
let unasked: string | undefined

/** Note that the app is going to the agent it kept by itself, as it does when it starts. */
export function comingBackTo(agentId: string): void {
  unasked = agentId
}

/**
 * Whether the app came to this agent by itself and has not heard from it. Nobody chose it, so
 * if it is gone there is nobody to tell: the app opens elsewhere. Asked once.
 */
export function cameBackUnasked(agentId: string): boolean {
  const was = unasked === agentId
  if (was) unasked = undefined
  return was
}

/** Keep which agent is open, so that the app opens on it the next time it is started. */
export function rememberLastAgent(agentId: string): void {
  // It is here, however it was come to. If it goes later, whoever is looking at it is told.
  if (unasked === agentId) unasked = undefined
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
