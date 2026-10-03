// Expo's default Metro config already understands this pnpm monorepo: it watches the workspace
// and resolves the shared packages from their TypeScript sources.
const { getDefaultConfig } = require("expo/metro-config")

module.exports = getDefaultConfig(__dirname)
