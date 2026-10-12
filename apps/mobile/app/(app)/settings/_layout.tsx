import { Stack } from "expo-router"
import { Platform } from "react-native"
import { useTheme } from "@/lib/theme"
// Importing this applies the look that was chosen under General, if one was.
import "@/settings/appearance"

/** Whatever page of the sheet is opened by its address, Settings itself is under it. */
export const unstable_settings = { anchor: "index" }

/**
 * The settings sheet: a stack of its own inside the modal, so that going into General or a
 * workspace moves within the sheet. Its bars are set as the app's own are.
 */
export default function SettingsLayout() {
  const theme = useTheme()
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerTransparent: Platform.OS === "ios",
        headerTintColor: theme.ink,
        headerTitleStyle: { color: theme.ink },
        headerStyle: Platform.OS === "ios" ? undefined : { backgroundColor: theme.bg },
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="general" options={{ title: "General" }} />
      <Stack.Screen name="default-model" options={{ title: "Model" }} />
      <Stack.Screen name="default-computer" options={{ title: "Computer" }} />
      <Stack.Screen name="waitlist" options={{ title: "Waiting list" }} />
    </Stack>
  )
}
