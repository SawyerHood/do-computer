import { ArrowClockwiseIcon } from "@phosphor-icons/react"
import { QueryErrorResetBoundary } from "@tanstack/react-query"
import { CatchBoundary } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * A part of a page that waits for what it shows. Until that is here its placeholder stands in
 * for it, and if it could not be had, a line says so with a way to ask again. Only this part
 * waits: what is around it is drawn at once, and stays if this part fails.
 */
export function Loads({
  fallback,
  className,
  children,
}: {
  fallback: ReactNode
  /** For the line that says it could not be loaded, where the part has room of its own around it. */
  className?: string
  children: ReactNode
}) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <CatchBoundary
          getResetKey={() => "loads"}
          errorComponent={({ error, reset: again }) => (
            <div role="alert" className={cn("flex flex-col items-start gap-2 text-sm", className)}>
              <p>
                This could not be loaded.{" "}
                <span className="text-muted-foreground">
                  {error instanceof Error ? error.message : ""}
                </span>
              </p>
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  // The failed answer is let go of first, or it would only be thrown again.
                  reset()
                  again()
                }}
              >
                <ArrowClockwiseIcon data-icon="inline-start" />
                Try again
              </Button>
            </div>
          )}
        >
          <Suspense fallback={fallback}>{children}</Suspense>
        </CatchBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}
