import { CircleNotchIcon } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

/**
 * Something is going on. It says nothing to a screen reader by itself: wherever it is shown, the
 * words beside it or a live region nearby already do, and a second one would be read out twice.
 * Give it an `aria-label` where it stands alone.
 */
function Spinner({ className, ...props }: React.ComponentProps<typeof CircleNotchIcon>) {
  return (
    <CircleNotchIcon
      data-slot="spinner"
      aria-hidden={props["aria-label"] === undefined ? true : undefined}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
