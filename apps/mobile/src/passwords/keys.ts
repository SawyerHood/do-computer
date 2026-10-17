import { keys } from "@/lib/queries"

/**
 * Under what names a workspace's saved logins and cards are kept once fetched. What is kept is
 * what the server lists, which has no password and no number in it: what a person types is
 * sent from the screen it was typed on and never put in the query cache.
 */
export const loginsKey = (workspaceId: string) => keys.workspace(workspaceId, "passwords")
export const cardsKey = (workspaceId: string) => keys.workspace(workspaceId, "cards")
