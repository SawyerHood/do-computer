import { ArrowClockwiseIcon } from "@phosphor-icons/react"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"

/**
 * A page that could not be had: the server did not answer, or part of the app's code is no
 * longer where the page was told it would be. It says so, where a placeholder would otherwise
 * stand for good. Asking again loads the page afresh, which also brings the app's code up to
 * what the server has now.
 */
export function PageError({ error }: ErrorComponentProps) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-start gap-3 p-8">
      <h1 className="text-lg font-medium">This could not be loaded</h1>
      <p className="text-sm text-muted-foreground">
        {error instanceof TypeError
          ? "The server could not be reached."
          : error instanceof Error
            ? error.message
            : ""}
      </p>
      <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
        <ArrowClockwiseIcon data-icon="inline-start" />
        Try again
      </Button>
    </div>
  )
}
