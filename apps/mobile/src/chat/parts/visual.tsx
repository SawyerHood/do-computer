import {
  type LibraryFile,
  type ToolPart,
  VISUAL_DEFAULT_HEIGHT,
  visualFrameHeight,
  type VisualTheme,
  visualThemeFragment,
} from "@durable-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { memo, useCallback, useMemo, useRef, useState } from "react"
import { View } from "react-native"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { GlassButton, Text } from "@/ui"
import { useChatScope } from "./shared"
import { VisualPage } from "./visual-frame"

/**
 * A visual the agent drew, in the chat: the page itself on the chat's own background, as tall
 * as the page says it is. The page is a file of the library and runs in a frame kept apart from
 * the app. It is in the app's colors, and follows them when they change.
 */
export const VisualFrame = memo(function VisualFrame({ part }: { part: ToolPart }) {
  const drawn = part.details as unknown as LibraryFile
  const { agentId, accent } = useChatScope()
  const { client } = useSession()
  const router = useRouter()
  const dark = useTheme().dark
  // Under the library's own name, so that whatever asks for the library again asks for this too.
  const { data: listing } = useQuery({
    queryKey: ["agents", agentId, "library", "listing"],
    queryFn: () => client.agent(agentId).libraryListing(),
  })
  // The file as it is now: it may have been changed, moved, or deleted since it was drawn.
  const file = listing?.files.find((entry) => entry.id === drawn.id)
  const theme = useMemo(
    (): VisualTheme => ({ appearance: dark ? "dark" : "light", color: accent.a, inline: true }),
    [dark, accent.a],
  )
  const [height, setHeight] = useState<number>()
  const onHeight = useCallback((tall: number) => setHeight(tall), [])

  // The page keeps the address it was first given for as long as it is the same page: a new
  // address would load it again. The colors it starts in ride on the address.
  const first = useRef(theme)
  const view = listing?.view
  const src = useMemo(
    () =>
      view === undefined || file === undefined
        ? undefined
        : `${client.agent(agentId).libraryViewUrl(view, file.path)}?v=${file.rev}${visualThemeFragment(first.current)}`,
    [client, agentId, view, file?.path, file?.rev],
  )

  if (listing !== undefined && file === undefined) {
    return (
      <Text variant="subhead" tone="ink2">
        “{drawn.name}” is no longer in the library, so it cannot be shown here.
      </Text>
    )
  }
  return (
    <View
      accessibilityLabel={`Visual: ${drawn.name}`}
      style={{ width: "100%", height: visualFrameHeight(height ?? VISUAL_DEFAULT_HEIGHT) }}
    >
      {src === undefined || file === undefined ? null : (
        <>
          <VisualPage
            key={`${file.id}:${file.rev}`}
            src={src}
            title={file.name}
            theme={theme}
            onHeight={onHeight}
          />
          <View style={{ position: "absolute", top: 0, right: 0, flexDirection: "row", gap: 6 }}>
            <GlassButton
              icon="arrowUpRight"
              label="Open in the library"
              size={32}
              onPress={() => router.push(`/a/${agentId}/library/${file.id}`)}
            />
            <GlassButton
              icon="share"
              label="Share"
              size={32}
              onPress={() => router.push(`/a/${agentId}/library/share?fileId=${file.id}`)}
            />
          </View>
        </>
      )}
    </View>
  )
})
