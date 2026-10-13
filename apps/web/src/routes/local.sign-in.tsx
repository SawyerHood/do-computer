import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"

/**
 * Where another device of the owner's is signed in to a server the desktop app runs. The app
 * shows a link to here to scan, with a token after the `#`, which is never sent as part of an
 * address: this page gives it back for a session of the device's own, and goes on to the app.
 */
export const Route = createFileRoute("/local/sign-in")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in · Do Computer" }] }),
  component: LocalSignInPage,
})

const AGAIN = "Show a new code in the Do Computer app on your computer, under Other Devices."

/** The token the link carries, if it is one the app could have made. */
function tokenOf(hash: string): string | undefined {
  const token = hash.replace(/^#/, "")
  return /^[A-Za-z0-9_-]{16,256}$/.test(token) ? token : undefined
}

function LocalSignInPage() {
  const [problem, setProblem] = useState<string>()
  const asked = useRef(false)

  useEffect(() => {
    // Once: a token is good for one sign-in, and a second try with it would say it was used.
    if (asked.current) return
    asked.current = true
    const token = tokenOf(location.hash)
    // It is not left in the address for whoever looks at this device's history.
    history.replaceState(null, "", location.pathname)
    if (token === undefined) return setProblem(`This link is not complete. ${AGAIN}`)
    void fetch("/api/auth/desktop/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).then(
      (response) => {
        if (response.ok) return location.replace("/")
        setProblem(`That code has run out or was used already. ${AGAIN}`)
      },
      () => setProblem("This device could not be signed in. Check its connection and try again."),
    )
  }, [])

  return (
    <main className="flex h-dvh items-center justify-center overflow-y-auto bg-frame p-4 sm:p-6">
      <div className="flex w-full max-w-[26rem] flex-col gap-1.5 rounded-2xl bg-background p-6 shadow-card sm:p-8">
        <img src="/icon-192.png" alt="" className="mb-3 size-11 rounded-xl shadow-raised" />
        <h1 className="text-2xl font-semibold tracking-tight">
          {problem === undefined ? "Signing you in…" : "That did not work"}
        </h1>
        {problem === undefined ? null : (
          <p role="alert" className="text-sm text-muted-foreground">
            {problem}
          </p>
        )}
      </div>
    </main>
  )
}
