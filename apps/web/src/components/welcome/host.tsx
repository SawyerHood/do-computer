import { useAtomValue } from "jotai"
import { lazy, Suspense } from "react"
import { welcomeOpenAtom } from "@/lib/welcome"

// Fetched when it is first shown: nobody who is not new here needs it.
const WelcomeScene = lazy(() => import("./scene.tsx"))

/**
 * Where the first run's scene is shown: over whatever page is under it, and not as a page
 * itself, so that it can stay while the page under it changes to the chat.
 */
export function WelcomeHost() {
  const open = useAtomValue(welcomeOpenAtom)
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <WelcomeScene />
    </Suspense>
  )
}
