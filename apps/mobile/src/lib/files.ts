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

/** The little of a browser's page that a download needs, so that this file needs no DOM types. */
type Page = {
  createElement(tag: "a"): { href: string; download: string; click(): void }
}

/**
 * Hand the person a file that is only text, such as the CSV behind a chart a page drew. On a
 * device it is written where passing things are kept and handed to the share sheet, where it
 * can be saved or sent on; a browser downloads it.
 */
export async function saveText(file: { name: string; type: string; text: string }): Promise<void> {
  // A name is only ever a name here, never a place.
  const name = file.name.replace(/[^\w.-]+/g, "_").replace(/^\.+/, "") || "file.txt"
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([file.text], { type: file.type }))
    const link = (globalThis as unknown as { document: Page }).document.createElement("a")
    link.href = url
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return
  }
  const uri = `${FileSystem.cacheDirectory}${name}`
  await FileSystem.writeAsStringAsync(uri, file.text)
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: file.type, dialogTitle: file.name })
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
