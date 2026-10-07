import { QueryClientProvider } from "@tanstack/react-query"
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router"
import { FRAME_INIT_SCRIPT } from "@/components/shell/app-skeleton"
import { TooltipProvider } from "@/components/ui/tooltip"
import { queryClient } from "@/lib/query"
import { THEME_INIT_SCRIPT } from "@/lib/theme"
import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "durable computer" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  notFoundComponent: () => (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-lg font-medium">Not found</h1>
      <p className="text-muted-foreground">That page does not exist.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the scripts in the head may change the class, and say how the
    // frame was left, before React hydrates.
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT + FRAME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="h-dvh overflow-hidden">
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>{children}</TooltipProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
