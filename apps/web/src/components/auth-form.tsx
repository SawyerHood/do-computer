import { GithubLogoIcon, GoogleLogoIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth-client"
import { meKey } from "@/lib/collections"
import { useUsualAppIcon } from "@/lib/app-icon"
import { desktop, signInThroughBrowser } from "@/lib/desktop"
import type { FrontDoor } from "@/lib/front-door"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"

type Provider = "google" | "github"

/**
 * Where to go once signed in: the page that sent the visitor here, when it named itself, such as
 * an invitation. Only ever a path of this app, never an address someone else could choose.
 */
function destination(): string {
  if (typeof location === "undefined") return "/"
  const next = new URLSearchParams(location.search).get("next") ?? ""
  return /^\/(?![/\\])/.test(next) ? next : "/"
}

/** Sign in or create an account, with email and password or a configured provider. */
export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const navigate = useNavigate()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  // The page arrives as HTML before its script runs. Until then a click on the button would be
  // the browser's own form submission, which signs nobody in, so the button waits for the script.
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  useUsualAppIcon()
  const { data: methods } = useQuery({
    queryKey: ["auth-methods"],
    queryFn: async (): Promise<FrontDoor> => (await fetch("/api/auth-methods")).json(),
  })
  const signingUp = mode === "sign-up"
  // In the desktop app: the provider whose sign-in is going on in the owner's browser.
  const [waiting, setWaiting] = useState<Provider>()
  const cancelled = useRef(false)

  const signedIn = async () => {
    // Whatever an earlier session left in this page is asked for again, starting with who
    // is signed in.
    queryClient.removeQueries({ queryKey: meKey })
    void queryClient.invalidateQueries()
    await navigate({ href: destination() })
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // Read from the fields themselves, so what was typed before the script ran is not lost.
    const fields = new FormData(event.currentTarget)
    const name = String(fields.get("name") ?? "")
    const email = String(fields.get("email") ?? "")
    const password = String(fields.get("password") ?? "")
    setError(undefined)
    setPending(true)
    const result = signingUp
      ? await authClient.signUp.email({
          name: name.trim() || email.split("@")[0]!,
          email,
          password,
        })
      : await authClient.signIn.email({ email, password })
    setPending(false)
    if (result.error) {
      setError(result.error.message ?? "That did not work. Check your details and try again.")
      return
    }
    await signedIn()
  }

  const social = async (provider: Provider) => {
    const bridge = desktop()
    if (bridge === undefined) {
      await authClient.signIn.social({ provider, callbackURL: destination() })
      return
    }
    // The app's window stays where it is. Its owner signs in in their own browser, where the
    // provider knows them already, and the app hands the sign-in back to this page.
    setError(undefined)
    cancelled.current = false
    setWaiting(provider)
    const problem = await signInThroughBrowser(bridge, provider).catch(
      () => "That sign-in could not be finished. Try again.",
    )
    setWaiting(undefined)
    if (problem === undefined) await signedIn()
    // Stopping it is not something that went wrong.
    else if (!cancelled.current) setError(problem)
  }
  const cancel = () => {
    cancelled.current = true
    void desktop()?.cancelSignIn()
  }
  // The way between signing in and signing up keeps where the visitor was headed.
  const carried = typeof location === "undefined" ? "" : location.search
  // Where the landing page says "coming soon", this page does not offer what that one withheld.
  // Someone a page sent here to come back to it, as an invitation does, may still be new.
  const shut =
    !signingUp &&
    methods?.landing === true &&
    !methods.open &&
    ready &&
    !new URLSearchParams(carried).has("next")
  // Someone new, headed nowhere in particular, is shown around first. Someone sent here by a
  // page that wants them back creates the account and goes on to it.
  const other = signingUp
    ? `/login${ready ? carried : ""}`
    : !ready
      ? "/signup"
      : new URLSearchParams(carried).has("next")
        ? `/signup${carried}`
        : "/welcome"

  return (
    <main className="flex h-dvh items-center justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            {signingUp ? "Create your account" : "Welcome back"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {signingUp
              ? "Then meet your agent: it gets its own name and memory, and a computer to work on."
              : "Sign in to pick up where you and your agent left off."}
          </p>
        </div>

        {methods?.google || methods?.github ? (
          <div className="flex flex-col gap-2">
            {methods.google ? (
              <Button
                variant="outline"
                disabled={waiting !== undefined}
                onClick={() => social("google")}
              >
                <GoogleLogoIcon weight="bold" />{" "}
                {waiting === "google" ? "Waiting for your browser…" : "Continue with Google"}
              </Button>
            ) : null}
            {methods.github ? (
              <Button
                variant="outline"
                disabled={waiting !== undefined}
                onClick={() => social("github")}
              >
                <GithubLogoIcon weight="bold" />{" "}
                {waiting === "github" ? "Waiting for your browser…" : "Continue with GitHub"}
              </Button>
            ) : null}
            {waiting ? (
              <Button variant="ghost" className="text-muted-foreground" onClick={cancel}>
                Cancel
              </Button>
            ) : null}
            <div className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
              or
            </div>
          </div>
        ) : null}

        <form className="flex flex-col gap-4" method="post" onSubmit={submit}>
          {signingUp ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" autoComplete="name" />
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              name="password"
              autoComplete={signingUp ? "new-password" : "current-password"}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={!ready || pending || waiting !== undefined}>
            {pending ? "One moment…" : signingUp ? "Create account" : "Sign in"}
          </Button>
        </form>

        <p className={cn("text-sm text-muted-foreground", shut && "hidden")}>
          {signingUp ? "Already have an account? " : "New here? "}
          <a href={other} className="text-foreground underline underline-offset-3">
            {signingUp ? "Sign in" : "Create an account"}
          </a>
          {signingUp && methods?.signup === "invite" ? (
            <span className="mt-2 block text-xs">
              This deployment is invite-only: after the first account, only people who have been
              invited can sign up.
            </span>
          ) : null}
        </p>
        {shut ? (
          <p className="rounded-lg bg-muted px-3.5 py-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              Do Computer is not open to everyone yet.
            </span>{" "}
            If a team invited you, use the link in your invitation.
          </p>
        ) : null}
      </div>
    </main>
  )
}
