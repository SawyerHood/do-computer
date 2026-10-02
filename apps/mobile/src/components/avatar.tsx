import { type Avatar as AvatarSpec, avatarSvg } from "@durable-computer/protocol"
import { useMemo } from "react"
import { View } from "react-native"
import { SvgXml } from "react-native-svg"

/** An agent's avatar. The drawing is the same one the web app shows. */
export function Avatar({
  avatar,
  seed,
  size = 36,
}: {
  avatar: AvatarSpec | null | undefined
  seed: string
  size?: number
}) {
  const xml = useMemo(() => avatarSvg(avatar, seed), [avatar, seed])
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Agent avatar"
      style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }}
    >
      <SvgXml xml={xml} width={size} height={size} />
    </View>
  )
}
