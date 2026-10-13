import type { ToolPart } from "@do-computer/protocol"
import { CreditCardIcon, KeyIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { keptLine } from "@/lib/passwords"
import { cn } from "@/lib/utils"

/**
 * A sign-in with a saved login, or a payment with a saved card, as the one line a chat keeps
 * of it: the site, the username or the card's name, and how it went. Nothing of the password
 * or the card's number is in what the call carries. A page that was not one the login is for
 * is told apart, since nothing was typed there.
 */
export function KeptLine({ part }: { part: ToolPart }) {
  const line = keptLine(part)
  if (line === undefined) return null
  const { words, going, refused } = line
  return (
    <Marker
      {...{ [`data-${line.of}`]: line.outcome }}
      role={going ? "status" : undefined}
      className={cn("px-1", refused && "text-amber-600 dark:text-amber-400")}
    >
      <MarkerIcon>
        {refused ? <WarningCircleIcon /> : line.of === "pay" ? <CreditCardIcon /> : <KeyIcon />}
      </MarkerIcon>
      <MarkerContent className={cn("wrap-anywhere", going && "animate-shine")}>
        {words}
      </MarkerContent>
    </Marker>
  )
}
