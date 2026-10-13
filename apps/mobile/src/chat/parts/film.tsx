import { useEventListener } from "expo"
import { useIsFocused } from "expo-router"
import { useVideoPlayer, VideoView } from "expo-video"
import { useEffect } from "react"
import { View } from "react-native"
import { radius } from "@/lib/theme"
import { Unplayed, usePlayed, type Way } from "./played"

/**
 * A film, played where it is, with the controls the phone has for one. It is fitted inside a
 * box of the usual shape, so that nothing under it moves when its own shape is known. It does
 * not start by itself, and stops when the screen it is on is left. Like a sound it keeps the
 * address it was first given, and whoever draws it gives it a key that changes when the film
 * itself does. `width` is how wide the box is, where it is not as wide as a sound's.
 *
 * On an iPhone it is heard with the ringer off: the player asks for that itself, when it plays
 * and not before, so that a film that is only on the page takes nothing from the microphone.
 * That is also why nothing is said here of a picture over other apps, which would ask at once.
 */
export function Film({
  src,
  name,
  onStale,
  way,
  width = 320,
}: {
  src: string
  name: string
  onStale?: () => Promise<string | undefined>
  way?: Way
  width?: number
}) {
  const played = usePlayed(src, onStale)
  const player = useVideoPlayer(played.address)
  const focused = useIsFocused()
  useEffect(() => {
    if (!focused) player.pause()
  }, [focused, player])
  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "error") return played.stopped(player.currentTime)
    if (status !== "readyToPlay") return
    const at = played.place()
    if (at > 0) player.currentTime = at
  })
  useEventListener(player, "playingChange", ({ isPlaying }) => {
    if (isPlaying) played.playing()
  })
  if (played.failed) return <Unplayed name={name} way={way} />
  return (
    <View
      accessibilityLabel={name}
      style={{
        width,
        maxWidth: "100%",
        aspectRatio: 16 / 9,
        borderRadius: radius.md,
        overflow: "hidden",
        backgroundColor: "#000",
      }}
    >
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        playsInline
        style={{ width: "100%", height: "100%" }}
      />
    </View>
  )
}
