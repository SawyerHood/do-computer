import type { ExpoConfig } from "expo/config"

/**
 * The Expo project this app's builds belong to. A notification reaches a phone through it, so a
 * build with no project is never notified. A build of your own names its own, which `eas init`
 * makes, in EAS_PROJECT_ID.
 */
const projectId = process.env.EAS_PROJECT_ID || "d401399e-0f96-4117-9852-77e5969e3360"

const config: ExpoConfig = {
  name: "Do Computer",
  slug: "do-computer",
  // Must match MOBILE_SCHEME in apps/web/src/server/auth.ts, which trusts sign-ins from it.
  scheme: "docomputer",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "computer.do.app",
    infoPlist: {
      NSMicrophoneUsageDescription: "Used to dictate messages to your Dood.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "com.docomputer.app",
    permissions: ["android.permission.RECORD_AUDIO"],
  },
  web: { bundler: "metro", output: "single" },
  extra: { eas: { projectId } },
  experiments: {
    // The browser build is served under a path of the deployment in tests; see apps/web/e2e.
    baseUrl: process.env.DC_MOBILE_BASE_URL || undefined,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-audio", { microphonePermission: "Used to dictate messages to your Dood." }],
    "expo-notifications",
    "expo-sharing",
    // The scene lifecycle that the iOS 27 SDK asks every app for.
    ["expo-build-properties", { ios: { enableSceneSupport: true } }],
    [
      "expo-image-picker",
      {
        photosPermission: "Used to attach pictures to a message or add them to the library.",
        cameraPermission: "Used to take a picture to send to your Dood.",
        microphonePermission: false,
      },
    ],
    "expo-font",
    [
      "expo-splash-screen",
      {
        image: "./assets/icon.png",
        imageWidth: 120,
        backgroundColor: "#f2f4f5",
        dark: { image: "./assets/icon.png", backgroundColor: "#0b0d0d" },
      },
    ],
    "expo-web-browser",
  ],
}

export default config
