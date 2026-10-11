import { createIsomorphicFn } from "@tanstack/react-start"

/** What someone who is not signed in is shown first, as `/api/auth-methods` answers it. */
export type FrontDoor = {
  google: boolean
  github: boolean
  /** `waitlist`: anyone may make an account, and waits to be let in to the app itself. */
  signup: "open" | "invite" | "waitlist"
  /** Whether `/` is the landing page for someone who is not signed in. */
  landing: boolean
  /** Whether a stranger may make an account: sign-up is not by invitation, or nobody has one yet. */
  open: boolean
}

/** Asked of the deployment's own settings where a page is drawn by the server, and over the wire in a browser. */
export const frontDoor = createIsomorphicFn()
  .server(async (): Promise<FrontDoor> => (await import("@/server/auth")).frontDoor())
  .client(async (): Promise<FrontDoor> => (await fetch("/api/auth-methods")).json())
