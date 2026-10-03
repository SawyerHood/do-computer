import { createFileRoute } from "@tanstack/react-router"
import { AuthForm } from "@/components/auth-form"

export const Route = createFileRoute("/signup")({ component: () => <AuthForm mode="sign-up" /> })
