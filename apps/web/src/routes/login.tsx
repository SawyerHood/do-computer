import { createFileRoute } from "@tanstack/react-router"
import { AuthForm } from "@/components/auth-form"
import { frontDoor } from "@/lib/front-door"

export const Route = createFileRoute("/login")({
  // The ways in are sent with the page, so it does not show one that is not offered.
  loader: () => frontDoor(),
  component: LoginPage,
})

function LoginPage() {
  return <AuthForm mode="sign-in" door={Route.useLoaderData()} />
}
