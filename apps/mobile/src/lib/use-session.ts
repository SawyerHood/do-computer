import { useAtomValue } from "jotai"
import { serverAtom, type Session, sessionFor } from "./session.ts"

/** The session for the connected server. Screens behind sign-in may assume it exists. */
export function useSession(): Session {
  const server = useAtomValue(serverAtom)
  if (server === null) throw new Error("No server is connected")
  return sessionFor(server)
}
