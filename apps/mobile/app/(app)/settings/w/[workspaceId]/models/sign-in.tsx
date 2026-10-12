import { useLocalSearchParams } from "expo-router"
import { SignInPage } from "@/models/sign-in"

/** Signing in to a provider one way (`?providerId=&type=`), step by step as the provider leads. */
export default function SignIn() {
  const { workspaceId, providerId, type } = useLocalSearchParams<{
    workspaceId: string
    providerId?: string
    type?: string
  }>()
  return <SignInPage workspaceId={workspaceId} providerId={providerId ?? ""} type={type ?? ""} />
}
