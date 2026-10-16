import { pinned, pinStanding, pinTitle, type ToolPart } from "@do-computer/protocol"
import { useRouter } from "expo-router"
import { memo } from "react"
import { View } from "react-native"
import { mono, useTheme } from "@/lib/theme"
import { usePinning } from "@/pins/pins"
import { Button, haptic, Text } from "@/ui"
import { Card, ChipIcon, useChatScope } from "./shared"

/**
 * Something the Dood pinned, where it pinned it: what it is, the way to open it, and the way to
 * take the pin off. It says how the pin stands today, not how it stood when it was made: taken
 * off since, it offers to put it back under the title the Dood gave it.
 */
export const PinCard = memo(function PinCard({ part }: { part: ToolPart }) {
  const then = pinned(part)
  const { agentId } = useChatScope()
  const router = useRouter()
  const theme = useTheme()
  const { name, pins, pending, pin, unpin } = usePinning(agentId)
  const now = pinStanding(then, pins)
  const title = pinTitle(now ?? then.pin, then.file)
  const headline = now === undefined ? `${title} is no longer pinned` : `${name} pinned ${title}`
  return (
    <Card style={{ padding: 10, gap: 10, alignSelf: "flex-start", maxWidth: "100%" }}>
      <View
        accessible
        accessibilityLabel={`${headline}, ${then.file.path}`}
        style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
      >
        <ChipIcon icon="pin" color={now === undefined ? theme.ink2 : theme.amber} />
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <Text variant="subhead" weight="600" numberOfLines={2}>
            {headline}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontFamily: mono, fontSize: 12, lineHeight: 17, color: theme.ink2 }}
          >
            {then.file.path}
          </Text>
        </View>
      </View>
      {now === undefined ? (
        <Button
          title="Pin it again"
          icon="pin"
          kind="line"
          size="small"
          busy={pending}
          // Back as the Dood pinned it, under the title it gave.
          onPress={() => pin({ fileId: then.file.id, title: then.pin.title })}
          style={{ alignSelf: "flex-start" }}
        />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button
            title="Open"
            icon="doc"
            kind="line"
            size="small"
            accessibilityLabel={`Open ${title}`}
            onPress={() => {
              haptic.tap()
              router.push(`/a/${agentId}/library/${now.fileId}`)
            }}
          />
          <Button
            title="Unpin"
            icon="pinSlash"
            kind="line"
            size="small"
            disabled={pending}
            accessibilityLabel={`Unpin ${title}`}
            onPress={() => unpin(now.fileId)}
          />
        </View>
      )}
    </Card>
  )
})
