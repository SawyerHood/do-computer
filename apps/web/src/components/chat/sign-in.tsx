import type { ToolPart } from "@do-computer/protocol"
import { KeyIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { signInOf, signInWords } from "@/lib/passwords"
import { cn } from "@/lib/utils"

/**
 * A sign-in with a saved login, as the one line a chat keeps of it: the site, the username and
 * how it went. Nothing of the password is in what the call carries. A page that was not one
 * the login is for is told apart, since nothing was typed there.
 */
export function SignInLine({ part }: { part: ToolPart }) {
  const signIn = signInOf(part)
  if (signIn === undefined) return null
  const running = part.status === "pending" || part.status === "running"
  const { words, going, refused } = signInWords(signIn, running)
  return (
    <Marker
      data-sign-in={signIn.outcome}
      role={going ? "status" : undefined}
      className={cn("px-1", refused && "text-amber-600 dark:text-amber-400")}
    >
      <MarkerIcon>{refused ? <WarningCircleIcon /> : <KeyIcon />}</MarkerIcon>
      <MarkerContent className={cn("wrap-anywhere", going && "animate-shine")}>
        {words}
      </MarkerContent>
    </Marker>
  )
}
