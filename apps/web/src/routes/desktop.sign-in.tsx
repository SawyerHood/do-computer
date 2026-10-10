import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"

/**
 * Where the Do Computer desktop app sends its owner's browser to sign the app in. Whoever is
 * signed in here, or signs in now, agrees, and the browser goes back to the app on this
 * computer with a token the app's window turns into a session of its own.
 */
export const Route = createFileRoute("/desktop/sign-in")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in to the app · Do Computer" }] }),
  component: DesktopSignInPage,
})

type Provider = "github" | "google"
type Link = { port: number; state: string; provider?: Provider }
type Me = { name: string; email: string }
type Methods = { google: boolean; github: boolean }

/**
 * What the app asked for, read from the address as it was written: a port of its own on this
 * computer and the word it expects back. Anything else is not a link the app made.
 */
function linkOf(search: string): Link | undefined {
  const asked = new URLSearchParams(search)
  const port = asked.get("port") ?? ""
  const state = asked.get("state") ?? ""
  const provider = asked.get("provider")
  if (!/^[1-9]\d{3,4}$/.test(port) || Number(port) < 1024 || Number(port) > 65535) return undefined
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) return undefined
  if (provider !== null && provider !== "github" && provider !== "google") return undefined
  return { port: Number(port), state, ...(provider === null ? {} : { provider }) }
}

/** Who is signed in in this browser, or null. This page is outside the signed-in pages. */
async function whoIsSignedIn(): Promise<Me | null> {
  const response = await fetch("/api/me")
  if (response.status === 401) return null
  if (!response.ok) throw new Error("Who is signed in could not be checked. Try again.")
  return ((await response.json()) as { user: Me }).user
}

/**
 * What this tab has done about a sign-in the app asked for, kept for the tab: `started` once
 * it has gone to the provider, `done` once it has come back. A sign-in that failed there is
 * then not started again, round and round.
 */
const marker = (state: string) => ({
  read: () => sessionStorage.getItem(`dc-desktop-sign-in:${state}`),
  write: (value: "started" | "done") =>
    sessionStorage.setItem(`dc-desktop-sign-in:${state}`, value),
})

function Column({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex h-dvh items-center justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">{children}</div>
    </main>
  )
}

function Heading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children ? <p className="text-sm text-muted-foreground">{children}</p> : null}
    </div>
  )
}

function DesktopSignInPage() {
  const link = linkOf(location.search)
  if (link === undefined) {
    return (
      <Column>
        <Heading title="Sign in to the app">
          This link is not complete. Start again from the Do Computer app.
        </Heading>
      </Column>
    )
  }
  return <HandOff link={link} />
}

function HandOff({ link }: { link: Link }) {
  const { port, state, provider } = link
  // This page, to come back to after signing in.
  const here = `${location.pathname}${location.search}`
  const login = `/login?next=${encodeURIComponent(here)}`
  const [error, setError] = useState<string>()
  // Going somewhere: to the provider, or back to the app.
  const [leaving, setLeaving] = useState<"provider" | "app">()
  const acted = useRef(false)

  const {
    data: me,
    error: unasked,
    refetch,
  } = useQuery({ queryKey: ["desktop-sign-in-me"], queryFn: whoIsSignedIn, retry: false })
  // Asked only when the app named a provider. Not being told is taken as its not being offered.
  const { data: methods, isFetched: methodsKnown } = useQuery({
    queryKey: ["auth-methods"],
    queryFn: async (): Promise<Methods> => (await fetch("/api/auth-methods")).json(),
    enabled: provider !== undefined,
    retry: false,
  })

  const proceed = useCallback(async () => {
    setError(undefined)
    setLeaving("app")
    try {
      const response = await fetch("/api/auth/desktop/token", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      const said = (await response.json().catch(() => null)) as {
        token?: string
        message?: string
      } | null
      if (!response.ok || typeof said?.token !== "string") {
        throw new Error(
          response.status === 401
            ? "You are no longer signed in here. Sign in and try again."
            : (said?.message ?? "That did not work. Try again."),
        )
      }
      // Only ever to this computer, at the port the app named: never to an address from the link.
      location.assign(
        `http://127.0.0.1:${port}/done?token=${encodeURIComponent(said.token)}&state=${encodeURIComponent(state)}`,
      )
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That did not work. Try again.")
      setLeaving(undefined)
    }
  }, [port, state])

  // What happens without a click, once: going to the provider the app asked for, and going on to
  // the app after coming back from it signed in.
  useEffect(() => {
    if (acted.current || me === undefined) return
    const tab = marker(state)
    if (me !== null) {
      if (tab.read() !== "started") return
      acted.current = true
      tab.write("done")
      void proceed()
      return
    }
    if (provider === undefined || !methodsKnown) return
    if (!methods?.[provider] || tab.read() !== null) return
    acted.current = true
    tab.write("started")
    setLeaving("provider")
    void authClient.signIn.social({ provider, callbackURL: here }).then((result) => {
      if (!result.error) return
      setError(result.error.message ?? "That did not work. Try again.")
      setLeaving(undefined)
    })
  }, [me, methods, methodsKnown, provider, state, here, proceed])

  const another = async () => {
    await authClient.signOut()
    location.assign(login)
  }

  const alert = error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null

  if (unasked) {
    return (
      <Column>
        <Heading title="Sign in to the app" />
        <p role="alert" className="text-sm text-destructive">
          {unasked.message}
        </p>
        <Button variant="outline" onClick={() => void refetch()}>
          Try again
        </Button>
      </Column>
    )
  }
  // Until it is known who is here, and which providers there are when the app named one, there
  // is nothing to ask.
  if (me === undefined || (me === null && provider !== undefined && !methodsKnown)) {
    return null
  }

  if (leaving === "provider") {
    return (
      <Column>
        <Heading title="Sign in to the app">
          Taking you to {provider === "github" ? "GitHub" : "Google"}…
        </Heading>
      </Column>
    )
  }

  if (me === null) {
    return (
      <Column>
        <Heading title="Sign in to the app">Sign in to continue to the Do Computer app.</Heading>
        {alert}
        <a href={login} className={buttonVariants()}>
          Sign in
        </a>
      </Column>
    )
  }

  return (
    <Column>
      <Heading title="Sign in to the app">
        Sign in to the Do Computer app as {me.name} ({me.email})?
      </Heading>
      {alert}
      <div className="flex flex-col gap-2">
        <Button disabled={leaving !== undefined} onClick={() => void proceed()}>
          {leaving === "app" ? "One moment…" : "Continue"}
        </Button>
        <Button
          variant="ghost"
          className="text-muted-foreground"
          disabled={leaving !== undefined}
          onClick={() => void another()}
        >
          Use another account
        </Button>
      </div>
    </Column>
  )
}
