import { sharedSite, type SiteSummary, type ToolPart } from "@durable-computer/protocol"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { useRouter } from "expo-router"
import { memo, useEffect, useRef, useState } from "react"
import { Linking, View } from "react-native"
import { keys, useWorkspaces } from "@/lib/queries"
import { mono, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Button, errorText, haptic, Icon, tell, Text } from "@/ui"
import { useSites } from "./file"
import { shownAddress } from "./logic"
import { Card, ChipIcon, RoundButton, useChatScope } from "./shared"

/** Who a site that is not public is open to, in a few words, as the web says it. */
function useAudience(): string {
  const { workspaceId } = useChatScope()
  const workspace = useWorkspaces().data?.workspaces.find((entry) => entry.id === workspaceId)
  return workspace === undefined || workspace.kind === "personal"
    ? "Only you"
    : `${workspace.name} only`
}

/**
 * A site the agent shared, where it shared it: its address, who can open it now, and the way
 * to change that. It says how the site stands today, not how it stood when it was shared.
 */
export const SiteCard = memo(function SiteCard({ part }: { part: ToolPart }) {
  const then = sharedSite(part)
  const { agentId, accent } = useChatScope()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const router = useRouter()
  const theme = useTheme()
  const audience = useAudience()
  const sites = useSites(agentId)
  const [copied, setCopied] = useState(false)
  // The same place shared again after it was stopped is a site with another address.
  const known =
    sites?.find((site) => site.id === then.id) ?? sites?.find((site) => site.path === then.path)
  // What is known may be from before the agent did this: ask again, once for each thing it did.
  const asked = useRef("")
  useEffect(() => {
    if (sites === undefined || asked.current === part.toolCallId) return
    if (known !== undefined && known.updatedAt >= then.updatedAt) return
    asked.current = part.toolCallId
    void queryClient.invalidateQueries({ queryKey: keys.sites(agentId) })
  }, [sites, known, then.updatedAt, part.toolCallId, agentId, queryClient])
  const share = useMutation({
    mutationFn: () => client.agent(agentId).shareSite(then.path, then.title),
    onSuccess: (site) => {
      haptic.done()
      queryClient.setQueryData<SiteSummary[]>(keys.sites(agentId), (current) =>
        current === undefined
          ? current
          : current.some((entry) => entry.id === site.id)
            ? current.map((entry) => (entry.id === site.id ? site : entry))
            : [site, ...current],
      )
    },
    onError: (error) => tell("It could not be shared", errorText(error)),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: keys.sites(agentId) }),
  })
  // Until the list is here, it is shown as the agent left it.
  const site = sites === undefined ? then : known
  const url = client.agent(agentId).siteUrl((site ?? then).id)

  const copy = () => {
    void Clipboard.setStringAsync(url).then(() => {
      haptic.done()
      setCopied(true)
      setTimeout(() => setCopied(false), 1_500)
    })
  }

  return (
    <Card style={{ padding: 10, gap: 10 }}>
      <View
        accessible={false}
        accessibilityLabel={`Site: ${then.title}`}
        style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
      >
        <ChipIcon icon="globe" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text variant="subhead" weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
              {(site ?? then).title}
            </Text>
            {site === undefined ? (
              <Text variant="caption" tone="ink2">
                Not shared any more
              </Text>
            ) : (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingHorizontal: 8,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: site.public ? accent.soft : theme.fill,
                }}
              >
                <Icon
                  name={site.public ? "globe" : "lock"}
                  size={10}
                  color={site.public ? accent.ink : theme.ink2}
                />
                <Text variant="caption" weight="500" color={site.public ? accent.ink : theme.ink2}>
                  {site.public ? "Public" : audience}
                </Text>
              </View>
            )}
          </View>
          <Text
            selectable
            numberOfLines={1}
            style={{ fontFamily: mono, fontSize: 12, lineHeight: 17, color: theme.ink2 }}
          >
            {site === undefined ? then.path : shownAddress(url)}
          </Text>
        </View>
      </View>
      {site === undefined ? (
        <Button
          title="Share again"
          kind="line"
          size="small"
          busy={share.isPending}
          disabled={share.isPending}
          onPress={() => share.mutate()}
          style={{ alignSelf: "flex-start" }}
        />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button
            title={copied ? "Copied" : "Copy link"}
            icon={copied ? "check" : "copy"}
            kind="line"
            size="small"
            onPress={copy}
          />
          <Button
            title="Open"
            icon="arrowUpRight"
            kind="line"
            size="small"
            onPress={() => void Linking.openURL(url)}
          />
          <View style={{ flex: 1 }} />
          <RoundButton
            icon="people"
            label="Who can open it"
            onPress={() =>
              router.push(`/a/${agentId}/library/share?path=${encodeURIComponent(site.path)}`)
            }
          />
        </View>
      )}
    </Card>
  )
})
