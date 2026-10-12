import { createFileRoute, redirect } from "@tanstack/react-router"
import { AuthForm } from "@/components/auth-form"
import { frontDoor } from "@/lib/front-door"
import { forDesktopApp, sentFrom } from "@/lib/welcome"

/**
 * Someone new makes their account in the first run, where they meet their agent: this address
 * leads there, and carries where they were headed. The plain form is only for someone the
 * desktop app sent to their browser to sign in, since the app is showing the first run itself.
 */
export const Route = createFileRoute("/signup")({
  beforeLoad: ({ location }) => {
    const next = sentFrom(location.searchStr)
    if (forDesktopApp(next)) return
    throw redirect({ to: "/welcome", search: next === undefined ? {} : { next }, replace: true })
  },
  loader: () => frontDoor(),
  component: SignupPage,
})

function SignupPage() {
  return <AuthForm mode="sign-up" door={Route.useLoaderData()} />
}
