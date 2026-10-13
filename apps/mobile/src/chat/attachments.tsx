import {
  MAX_MESSAGE_IMAGE_CHARS,
  MAX_MESSAGE_IMAGES,
  MESSAGE_IMAGE_TYPES,
  type MessageImage,
} from "@do-computer/protocol"
import { Image } from "expo-image"
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from "react-native"
import { radius, useTheme } from "@/lib/theme"
import { Icon, Text } from "@/ui"

/** Something that goes with the message being written. */
export type AttachedFile = {
  id: string
  name: string
  /** Whether it is in the library, and so can be named to the agent as a file. */
  stored: boolean
  /** A copy for the agent to look at, where it is a picture small enough to send. */
  image?: MessageImage
  /** Where a small picture of it can be shown from. */
  preview?: string
}

/** A file as a picker hands it over: where it is, and in a browser the file itself. */
export type Chosen = {
  uri: string
  name: string
  type: string
  base64?: string | null
  file?: Blob
}

const nameOf = (uri: string, fallback: string) =>
  uri.split(/[\\/]/).pop()?.split("?")[0] || fallback

/** Why a permission was not given, as the system's settings would have it put right. */
export class Refused extends Error {}

/**
 * Choose pictures from the phone's photos, or take one. Permission is asked for at the tap. The
 * picker hands back a smaller JPEG, which is both what is saved and what the agent looks at.
 */
export async function choosePictures(from: "library" | "camera"): Promise<Chosen[]> {
  const ImagePicker = await import("expo-image-picker")
  if (from === "camera") {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync()
    if (!granted) throw new Refused("Allow the camera for Do Computer in Settings to take a photo.")
  } else if (Platform.OS !== "web") {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!granted) throw new Refused("Allow photos for Do Computer in Settings to attach one.")
  }
  const options = { mediaTypes: ["images" as const], quality: 0.6, base64: Platform.OS !== "web" }
  const result =
    from === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync({
          ...options,
          allowsMultipleSelection: true,
          selectionLimit: 10,
        })
  if (result.canceled) return []
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-").replace("T", "_")
  return result.assets.map((asset, at) => ({
    uri: asset.uri,
    name: asset.fileName ?? nameOf(asset.uri, `photo-${stamp}${at === 0 ? "" : `-${at + 1}`}.jpg`),
    type: asset.mimeType ?? "image/jpeg",
    base64: asset.base64,
    file: (asset as { file?: Blob }).file,
  }))
}

/** Choose files with the system's own picker, several at once. */
export async function chooseFiles(): Promise<Chosen[]> {
  const DocumentPicker = await import("expo-document-picker")
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
  })
  if (result.canceled) return []
  return result.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    type: asset.mimeType ?? "application/octet-stream",
    file: (asset as { file?: Blob }).file,
  }))
}

/** What a chosen file holds, to send to the library. */
export async function bodyOf(chosen: Chosen): Promise<Blob> {
  // A file on a device and a blob in a browser can both be fetched.
  return chosen.file ?? (await (await fetch(chosen.uri)).blob())
}

/** What one picture may take of a message's allowance, so that a full set still fits. */
const BUDGET = Math.floor(MAX_MESSAGE_IMAGE_CHARS / MAX_MESSAGE_IMAGES) - 1_000

/** Longest side and JPEG quality to try, as the web app does. */
const ATTEMPTS: readonly (readonly [number, number])[] = [
  [1568, 0.85],
  [1568, 0.7],
  [1280, 0.7],
  [1024, 0.7],
  [1024, 0.5],
  [768, 0.5],
  [512, 0.5],
]

type Canvas = {
  width: number
  height: number
  getContext(kind: "2d"): {
    fillStyle: string
    fillRect(x: number, y: number, w: number, h: number): void
    drawImage(image: unknown, x: number, y: number, w: number, h: number): void
  } | null
  toDataURL(type: string, quality: number): string
}
type Page = {
  createImageBitmap?: (blob: Blob) => Promise<{ width: number; height: number; close(): void }>
  document?: { createElement(tag: "canvas"): Canvas }
}

/** In a browser a picture is drawn smaller on a canvas until it fits, exactly as the web app does. */
async function scaledInBrowser(blob: Blob): Promise<MessageImage | undefined> {
  const page = globalThis as unknown as Page
  if (page.createImageBitmap === undefined || page.document === undefined) return undefined
  const bitmap = await page.createImageBitmap(blob)
  try {
    const canvas = page.document.createElement("canvas")
    const context = canvas.getContext("2d")
    if (context === null) return undefined
    for (const [side, quality] of ATTEMPTS) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      // JPEG has no transparency, and what shows through would otherwise be black.
      context.fillStyle = "#fff"
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const url = canvas.toDataURL("image/jpeg", quality)
      const data = url.slice(url.indexOf(",") + 1)
      if (data.length <= BUDGET) return { mimeType: "image/jpeg", data }
    }
    return undefined
  } finally {
    bitmap.close()
  }
}

/** On a device the phone draws a picture smaller until it fits, to the same sizes. */
async function scaledOnDevice(uri: string): Promise<MessageImage | undefined> {
  const { ImageManipulator, SaveFormat } = await import("expo-image-manipulator")
  const whole = await ImageManipulator.manipulate(uri).renderAsync()
  try {
    const wide = whole.width >= whole.height
    for (const [side, quality] of ATTEMPTS) {
      const drawing = ImageManipulator.manipulate(whole)
      if (Math.max(whole.width, whole.height) > side) {
        drawing.resize(wide ? { width: side } : { height: side })
      }
      const drawn = await drawing.renderAsync()
      const { base64 } = await drawn
        .saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true })
        .finally(() => drawn.release())
      if (base64 !== undefined && base64.length <= BUDGET) {
        return { mimeType: "image/jpeg", data: base64 }
      }
    }
    return undefined
  } finally {
    // A photograph drawn in full is a great deal of memory to leave for later.
    whole.release()
  }
}

/** A picture on a device just as it is, where it is of a kind and a size a message can hold. */
async function asItIs(chosen: Chosen): Promise<MessageImage | undefined> {
  if (!(MESSAGE_IMAGE_TYPES as readonly string[]).includes(chosen.type)) return undefined
  let data = chosen.base64 ?? undefined
  if (data === undefined) {
    const FileSystem = await import("expo-file-system/legacy")
    const info = await FileSystem.getInfoAsync(chosen.uri)
    // Base64 is a third longer than the file.
    if (!info.exists || info.size * 1.34 > MAX_MESSAGE_IMAGE_CHARS) return undefined
    data = await FileSystem.readAsStringAsync(chosen.uri, { encoding: "base64" })
  }
  return data.length <= MAX_MESSAGE_IMAGE_CHARS ? { mimeType: chosen.type, data } : undefined
}

/**
 * A copy of a picture to send with a message for the agent to look at. Undefined for a file
 * that is not a picture, or one that cannot be made small enough to send. One that already
 * leaves room for the others a message may hold goes as it is, and any other is drawn smaller.
 */
export async function pictureFor(chosen: Chosen): Promise<MessageImage | undefined> {
  if (!chosen.type.startsWith("image/")) return undefined
  try {
    if (Platform.OS === "web") return await scaledInBrowser(await bodyOf(chosen))
    const whole = await asItIs(chosen).catch(() => undefined)
    if (whole !== undefined && whole.data.length <= BUDGET) return whole
    // A picture the phone cannot draw is still sent whole, if a message can hold it.
    return (await scaledOnDevice(chosen.uri).catch(() => undefined)) ?? whole
  } catch {
    return undefined
  }
}

const PASTED_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  tiff: "image/tiff",
}

/**
 * A picture on the clipboard has no name, or is called "image.png" every time. Each is given
 * the moment it was pasted, so that several can be told apart in the library and by the agent.
 */
const pastedName = (at: number, extension: string) => {
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-").replace("T", "_")
  return `pasted-${stamp}${at === 0 ? "" : `-${at + 1}`}.${extension}`
}

/** Pictures pasted into the message box on a phone, which hands them over as files it wrote. */
export function pastedPictures(uris: readonly string[]): Chosen[] {
  return uris.map((uri, at) => {
    const extension = /\.([a-z0-9]+)$/i.exec(uri)?.[1]?.toLowerCase() ?? "png"
    return {
      uri,
      name: pastedName(at, extension),
      type: PASTED_TYPES[extension] ?? "image/png",
    }
  })
}

/** Files pasted into the message box in a browser: pictures, and anything else that was copied. */
export function pastedFiles(files: readonly File[]): Chosen[] {
  return files.map((file, at) => ({
    uri: URL.createObjectURL(file),
    name: /^image\.[a-z0-9]+$/i.test(file.name)
      ? pastedName(at, file.name.slice(file.name.lastIndexOf(".") + 1))
      : file.name,
    type: file.type || "application/octet-stream",
    file,
  }))
}

/** The pictures of what is attached that go with the message: as many as a message may hold. */
export function imagesToSend(attached: readonly AttachedFile[]): MessageImage[] {
  const images: MessageImage[] = []
  let chars = 0
  for (const file of attached) {
    if (file.image === undefined || images.length >= MAX_MESSAGE_IMAGES) continue
    if (chars + file.image.data.length > MAX_MESSAGE_IMAGE_CHARS) continue
    chars += file.image.data.length
    images.push(file.image)
  }
  return images
}

/** What is attached to the message being written, inside the box above the words. */
export function AttachedFiles({
  files,
  uploading,
  note,
  onRemove,
}: {
  files: readonly AttachedFile[]
  /** How many are still on their way to the library. */
  uploading: number
  note?: string | undefined
  onRemove: (id: string) => void
}) {
  const theme = useTheme()
  if (files.length === 0 && uploading === 0) return null
  const remove = (file: AttachedFile, corner: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Remove ${file.name}`}
      onPress={() => onRemove(file.id)}
      hitSlop={8}
      style={[
        {
          width: 20,
          height: 20,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.ink2,
        },
        corner ? { position: "absolute", top: -6, right: -6 } : null,
      ]}
    >
      <Icon name="close" size={10} color={theme.card} weight="bold" />
    </Pressable>
  )
  return (
    <View style={{ gap: 6, paddingTop: 10 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        accessibilityLabel="Attached files"
        contentContainerStyle={{
          gap: 10,
          paddingHorizontal: 14,
          paddingTop: 6,
          alignItems: "center",
        }}
      >
        {files.map((file) =>
          file.preview !== undefined ? (
            <View key={file.id}>
              <Image
                source={{ uri: file.preview }}
                accessibilityLabel={file.name}
                contentFit="cover"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: radius.sm,
                  backgroundColor: theme.fill,
                }}
              />
              {remove(file, true)}
            </View>
          ) : (
            <View
              key={file.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                maxWidth: 200,
                height: 40,
                paddingLeft: 10,
                paddingRight: 8,
                borderRadius: radius.sm,
                backgroundColor: theme.fill,
              }}
            >
              <Icon name="doc" size={16} color={theme.ink2} />
              <Text variant="footnote" numberOfLines={1} style={{ flexShrink: 1 }}>
                {file.name}
              </Text>
              {remove(file, false)}
            </View>
          ),
        )}
        {uploading > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 40 }}>
            <ActivityIndicator size="small" color={theme.ink2} />
            <Text variant="footnote" tone="ink2">
              Attaching…
            </Text>
          </View>
        ) : null}
      </ScrollView>
      {note === undefined ? null : (
        <Text variant="caption" tone="ink2" style={{ paddingHorizontal: 14 }}>
          {note}
        </Text>
      )}
    </View>
  )
}
