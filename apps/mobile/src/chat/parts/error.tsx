import { describeChatError } from "@do-computer/protocol"
import { useRouter } from "expo-router"
import { memo, useState } from "react"
import { Pressable, View } from "react-native"
import { mono, useTheme } from "@/lib/theme"
import { Button, haptic, Icon, Text } from "@/ui"
import { Pre, useChatScope } from "./shared"

/**
 * A reply that failed, as one plain sentence. What the provider answered is kept behind
 * "Details", for whoever wants it.
 */
export const ReplyError = memo(function ReplyError({
  error,
  failures,
  onRetry,
}: {
  error: string | undefined
  /** How many times in a row it failed. */
  failures: number
  onRetry?: (() => void) | undefined
}) {
  const view = describeChatError(error)
  const { agentId, workspaceId } = useChatScope()
  const router = useRouter()
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const hint = [failures > 1 ? `Tried ${failures} times.` : undefined, view.hint]
    .filter((text) => text !== undefined)
    .join(" ")
  const hasDetails = view.detail !== undefined || view.facts.length > 0
  const canRetry = onRetry !== undefined && view.retryable
  return (
    <View accessibilityRole="alert" style={{ flexDirection: "row", gap: 8 }}>
      <View style={{ paddingTop: 2 }}>
        <Icon name="warning" size={17} color={theme.red} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="subhead" weight="600" selectable>
          {view.title}
        </Text>
        {hint === "" ? null : (
          <Text variant="subhead" tone="ink2" selectable>
            {hint}
          </Text>
        )}
        {canRetry || hasDetails || view.kind === "signIn" ? (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              marginTop: 8,
            }}
          >
            {/* The two ways out of a sign-in that is gone, each a tap away. */}
            {view.kind === "signIn" ? (
              <>
                <Button
                  title="Sign in again"
                  kind="line"
                  size="small"
                  onPress={() =>
                    router.push(
                      workspaceId === undefined
                        ? "/settings/models"
                        : `/settings/w/${workspaceId}/models`,
                    )
                  }
                />
                <Button
                  title="Pick another model"
                  kind="line"
                  size="small"
                  onPress={() => router.push(`/a/${agentId}/model`)}
                />
              </>
            ) : null}
            {canRetry ? (
              <Button
                title="Try again"
                icon="refresh"
                kind="line"
                size="small"
                onPress={() => {
                  haptic.tap()
                  onRetry()
                }}
              />
            ) : null}
            {hasDetails ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Details"
                accessibilityState={{ expanded: open }}
                hitSlop={8}
                onPress={() => setOpen(!open)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingHorizontal: 4,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
                  <Icon name="chevronRight" size={11} color={theme.ink2} weight="semibold" />
                </View>
                <Text variant="footnote" tone="ink2" weight="500">
                  Details
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {open ? (
          <View style={{ marginTop: 8, gap: 8 }}>
            {view.facts.length > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {view.facts.map((fact) => (
                  <View
                    key={fact}
                    style={{ borderRadius: 5, backgroundColor: theme.fill, paddingHorizontal: 6 }}
                  >
                    <Text
                      selectable
                      style={{ fontFamily: mono, fontSize: 11, lineHeight: 18, color: theme.ink2 }}
                    >
                      {fact}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {view.detail === undefined ? null : <Pre text={view.detail} />}
          </View>
        ) : null}
      </View>
    </View>
  )
})
