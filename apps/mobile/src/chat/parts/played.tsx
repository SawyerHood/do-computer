import { useRef, useState } from "react"
import { Pressable, View } from "react-native"
import { useTheme } from "@/lib/theme"
import { haptic, Icon, Text } from "@/ui"

/** What is offered for a film or a sound that cannot be played: somewhere else to have it. */
export type Way = { label: string; onPress: () => void }

/**
 * The address a film or a sound is played from. It is the one first given for as long as that
 * works, since a new one would start it again. The address of a library file stops working
 * after some hours: `onStale` is then asked for a fresh one, once, and what is played goes back
 * to where it was. Only when that fails too has it `failed`.
 */
export function usePlayed(src: string, onStale?: () => Promise<string | undefined>) {
  const [address, setAddress] = useState(src)
  const [failed, setFailed] = useState(false)
  // Where it was when its address stopped working, to go back to with the new one.
  const resume = useRef(0)
  // Whether a fresh address has been asked for since it last played.
  const asked = useRef(false)
  // The address that stopped working. A player may say so more than once of the same one.
  const broken = useRef<string>(undefined)
  return {
    address,
    failed,
    /** The player could not go on, `at` seconds in. */
    stopped(at: number) {
      if (broken.current === address) return
      broken.current = address
      if (onStale === undefined || asked.current) return setFailed(true)
      asked.current = true
      resume.current = Number.isFinite(at) ? at : 0
      onStale().then(
        // The same address again would fail as it just did.
        (fresh) => (fresh === undefined || fresh === address ? setFailed(true) : setAddress(fresh)),
        () => setFailed(true),
      )
    },
    /** Where to go back to once it can be played again, said once: 0 where there is nowhere. */
    place() {
      const at = resume.current
      resume.current = 0
      return at
    },
    /** It is playing, so its address works, and may be asked for afresh another time. */
    playing() {
      asked.current = false
    },
  }
}

/** What stands where a film or a sound cannot be played: a quiet line, and a way to have it. */
export function Unplayed({ name, way }: { name: string; way?: Way }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      <Text variant="subhead" tone="ink2" style={{ flexShrink: 1 }}>
        {name} could not be played here.
      </Text>
      {way === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={way.label}
          hitSlop={8}
          onPress={() => {
            haptic.tap()
            way.onPress()
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text variant="subhead" weight="600" tone="tint">
            {way.label}
          </Text>
          <Icon name="chevronRight" size={13} color={theme.tint} />
        </Pressable>
      )}
    </View>
  )
}
