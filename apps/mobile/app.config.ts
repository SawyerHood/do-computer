import type { ExpoConfig } from "expo/config"

const config: ExpoConfig = {
  name: "durable computer",
  slug: "durable-computer",
  // Must match MOBILE_SCHEME in apps/web/src/server/auth.ts, which trusts sign-ins from it.
  scheme: "durablecomputer",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.durablecomputer.app",
    infoPlist: { NSMicrophoneUsageDescription: "Used to dictate messages to your agent." },
  },
  android: {
    package: "com.durablecomputer.app",
    permissions: ["android.permission.RECORD_AUDIO"],
  },
  web: { bundler: "metro", output: "single" },
  experiments: {
    // The browser build is served under a path of the deployment in tests; see apps/web/e2e.
    baseUrl: process.env.DC_MOBILE_BASE_URL || undefined,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-audio", { microphonePermission: "Used to dictate messages to your agent." }],
    "expo-notifications",
    "expo-sharing",
  ],
}

export default config
