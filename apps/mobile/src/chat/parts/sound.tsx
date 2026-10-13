import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio"
import { useState } from "react"
import { View } from "react-native"
import { useTheme } from "@/lib/theme"
import { Text } from "@/ui"
import { lengthOf } from "./logic"
import { Card, RoundButton } from "./shared"

/**
 * A sound, played where it is: a button that plays and stops it, how far into it it is and how
 * long it is, and between them a bar that fills as it plays and is pressed to move to another
 * place in it. It keeps the address it was first given, since a new one would start it again;
 * whoever draws it gives it a key that changes when the sound itself does.
 */
export function Sound({ src, name }: { src: string; name: string }) {
  const theme = useTheme()
  const [address] = useState(src)
  const player = useAudioPlayer(address, { updateInterval: 250 })
  const status = useAudioPlayerStatus(player)
  // How wide the bar is drawn, which is what a press on it is measured against.
  const [wide, setWide] = useState(0)
  // Until the sound has said how long it is, it is not known, and nothing can be moved to.
  const total = Number.isFinite(status.duration) && status.duration > 0 ? status.duration : 0
  const at = Math.min(Math.max(0, status.currentTime), total)
  const toggle = () => {
    if (status.playing) return player.pause()
    // One that was played to its end starts again from its beginning.
    if (total > 0 && total - at < 0.1) void player.seekTo(0).then(() => player.play())
    else player.play()
  }
  return (
    <Card
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        width: 320,
        maxWidth: "100%",
      }}
    >
      <RoundButton
        icon={status.playing ? "pause" : "play"}
        label={status.playing ? `Pause ${name}` : `Play ${name}`}
        onPress={toggle}
      />
      <Text variant="footnote" tone="ink2" style={{ fontVariant: ["tabular-nums"] }}>
        {lengthOf(at)}
      </Text>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={`Where ${name} is played from`}
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(at)}
        hitSlop={8}
        onLayout={(event) => setWide(event.nativeEvent.layout.width)}
        // A press, and not a button's: where along the bar it was is what matters, which a
        // button's press does not say in a browser.
        onStartShouldSetResponder={() => total > 0}
        onResponderRelease={(event) => {
          const part = event.nativeEvent.locationX / wide
          if (Number.isFinite(part)) void player.seekTo(Math.min(1, Math.max(0, part)) * total)
        }}
        style={{ flex: 1, height: 28, justifyContent: "center" }}
      >
        {/* Nothing in the bar takes the press itself, so that it is measured from the bar's start. */}
        <View
          pointerEvents="none"
          style={{ height: 4, borderRadius: 2, backgroundColor: theme.fill }}
        >
          <View
            style={{
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.tint,
              width: `${total === 0 ? 0 : (at / total) * 100}%`,
            }}
          />
        </View>
      </View>
      <Text variant="footnote" tone="ink2" style={{ fontVariant: ["tabular-nums"] }}>
        {lengthOf(total)}
      </Text>
    </Card>
  )
}
