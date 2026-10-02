import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useColorScheme } from "react-native"
import { configureNotifications } from "@/lib/push"
import { useTheme } from "@/lib/theme"

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

configureNotifications()

export default function RootLayout() {
  const theme = useTheme()
  const scheme = useColorScheme()
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.canvas },
        }}
      />
    </QueryClientProvider>
  )
}
