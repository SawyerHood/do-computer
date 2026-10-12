import * as FileSystem from "expo-file-system/legacy"
import * as Sharing from "expo-sharing"
import { Linking, Platform } from "react-native"
import { cookieOf, type Session } from "./session.ts"

/**
 * Open a library file. On a device it is downloaded with the session and handed to the share
 * sheet, where it can be opened or saved; a browser just follows the link.
 */
export async function openLibraryFile(
  session: Session,
  agentId: string,
  file: { id: string; name: string; contentType: string },
): Promise<void> {
  const url = session.client.agent(agentId).libraryFileUrl(file.id)
  if (Platform.OS === "web") return void Linking.openURL(url)
  const cookie = cookieOf(session.auth)
  const target = `${FileSystem.cacheDirectory}${file.id}-${file.name.replace(/[^\w.-]+/g, "_")}`
  const { uri } = await FileSystem.downloadAsync(url, target, { headers: { cookie } })
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: file.contentType, dialogTitle: file.name })
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
