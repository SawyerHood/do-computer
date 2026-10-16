import "@/lib/polyfills"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useMemo } from "react"
import { LogBox } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { KeyboardProvider } from "react-native-keyboard-controller"
import { LineHost } from "@/call/line-host"
import { configureNotifications } from "@/lib/push"
import { useTheme } from "@/lib/theme"
// Importing this applies the look that was chosen under General, if one was.
import "@/settings/appearance"

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

configureNotifications()

// Warnings are read in the bundler's log. The bar they raise over the app covers what is under it.
LogBox.ignoreAllLogs(true)

export default function RootLayout() {
  const theme = useTheme()
  // What the system's own bars and sheets are drawn in.
  const navigation = useMemo(() => {
    const base = theme.dark ? DarkTheme : DefaultTheme
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.tint,
        background: theme.bg,
        card: theme.bg,
        text: theme.ink,
        border: theme.sep,
        notification: theme.red,
      },
    }
  }, [theme])
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={navigation}>
            <StatusBar style="auto" />
            <Stack
              screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}
            >
              <Stack.Screen name="index" options={{ animation: "none" }} />
              <Stack.Screen name="connect" options={{ animation: "fade" }} />
              <Stack.Screen name="welcome" options={{ animation: "fade", gestureEnabled: false }} />
              <Stack.Screen name="(app)" options={{ animation: "fade" }} />
            </Stack>
            {/* Where the sound of a call is carried, out of sight, whichever screen is in front. */}
            <LineHost />
          </ThemeProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}
