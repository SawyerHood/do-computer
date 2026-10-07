import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // Ink over whatever it is on, so it reads the same on the page, the rail and a window.
      className={cn(
        "animate-pulse rounded-lg bg-foreground/10 motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
