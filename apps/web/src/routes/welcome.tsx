import { createFileRoute } from "@tanstack/react-router"
import { useSetAtom } from "jotai"
import { useEffect } from "react"
import { handingOver, welcomeOpenAtom } from "@/lib/welcome"

export const Route = createFileRoute("/welcome")({ ssr: false, component: WelcomePage })

/**
 * The first run: where someone new makes their account and meets their first agent, and where
 * the desktop app starts until its owner has been through it. The page itself is only the night
 * the scene opens on. The scene is shown over it, and stays as this page gives way to the chat.
 */
function WelcomePage() {
  const setOpen = useSetAtom(welcomeOpenAtom)
  useEffect(() => {
    setOpen(true)
    return () => {
      // Left by any other way than its own ending, the scene goes with its page.
      if (!handingOver.on()) setOpen(false)
    }
  }, [setOpen])
  return <main className="h-dvh bg-[#05071a]" />
}
