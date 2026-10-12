import type { SiteSummary } from "@durable-computer/protocol"
import { useQueryClient } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { Stack, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, Platform, Pressable, Share as SystemShare, View } from "react-native"
import { keys } from "@/lib/queries"
import { mono, useTheme } from "@/lib/theme"
import { nameOf, sharedPathOf, shownAddress, tidyPath } from "@/library/model"
import { useLibrary } from "@/library/use-library"
import {
  Button,
  confirm,
  Empty,
  errorText,
  haptic,
  Icon,
  Row,
  Screen,
  Section,
  tell,
  Text,
} from "@/ui"

/** One of the two answers to who can open a link, with a round mark that is filled when chosen. */
function Radio({
  title,
  line,
  checked,
  disabled,
  onPress,
}: {
  title: string
  line: string
  checked: boolean
  disabled: boolean
  onPress: () => void
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ checked, disabled }}
      // Said both ways: the browser build reads only this one.
      aria-checked={checked}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 56,
        paddingHorizontal: 16,
        paddingVertical: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        backgroundColor: pressed ? theme.fill : undefined,
      })}
    >
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1}>{title}</Text>
        <Text variant="subhead" tone="ink2" numberOfLines={1}>
          {line}
        </Text>
      </View>
      <Icon
        name={checked ? "checkCircle" : "circle"}
        size={24}
        color={checked ? theme.tint : theme.ink3}
        weight="medium"
      />
    </Pressable>
  )
}

/**
 * Whether something in the library is shared with a link, and who can open it: the web app's
 * share popover as a sheet. It is opened for a file (`?fileId=`) or for a place in the library
 * (`?path=`), which may be a folder. A folder's front page shares its folder.
 */
export default function Share() {
  const theme = useTheme()
  const params = useLocalSearchParams<{ agentId: string; fileId?: string; path?: string }>()
  const agentId = params.agentId
  const queryClient = useQueryClient()
  const library = useLibrary(agentId)
  const { api, audience } = library
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const file =
    params.fileId === undefined
      ? undefined
      : library.files.find((each) => each.id === params.fileId)
  const path = file !== undefined ? sharedPathOf(file.path) : tidyPath(params.path ?? "")
  const site = library.sites.data?.find((each) => each.path === path)
  const name = nameOf(path)

  /** Put a site as it now is among the ones already known, or take it out. */
  const keep = (change: SiteSummary | { removed: string }) => {
    queryClient.setQueryData<SiteSummary[]>(keys.sites(agentId), (sites = []) =>
      "removed" in change
        ? sites.filter((each) => each.id !== change.removed)
        : sites.some((each) => each.id === change.id)
          ? sites.map((each) => (each.id === change.id ? change : each))
          : [change, ...sites],
    )
  }
  const run = async (what: () => Promise<SiteSummary | { removed: string }>) => {
    if (busy) return
    setBusy(true)
    try {
      keep(await what())
      haptic.done()
    } catch (error) {
      haptic.fail()
      tell("Sharing could not be changed", errorText(error))
    } finally {
      setBusy(false)
      void queryClient.invalidateQueries({ queryKey: keys.sites(agentId) })
    }
  }
  const start = () => run(() => api.shareSite(path))
  const stop = async (shared: SiteSummary) => {
    const sure = await confirm({
      title: "Stop sharing?",
      message: "The link stops working. What it shared stays in the library.",
      action: "Stop sharing",
    })
    if (!sure) return
    await run(async () => {
      await api.removeSite(shared.id)
      return { removed: shared.id }
    })
  }
  const open = (shared: SiteSummary, everyone: boolean) => {
    if (shared.public === everyone) return
    haptic.tap()
    void run(() => api.updateSite(shared.id, { public: everyone }))
  }

  const title = <Stack.Screen options={{ title: name === "" ? "Share" : `Share ${name}` }} />
  if (library.sites.data === undefined || library.listing.data === undefined) {
    return (
      <Screen>
        {title}
        {library.sites.error || library.listing.error ? (
          <Empty title="Sharing could not be loaded">
            {errorText(library.sites.error ?? library.listing.error)}
          </Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 48 }} />
        )}
      </Screen>
    )
  }
  if (path === "") {
    return (
      <Screen>
        {title}
        <Empty title="This file is no longer in the library." />
      </Screen>
    )
  }

  const url = site === undefined ? "" : api.siteUrl(site.id)
  const copy = async () => {
    await Clipboard.setStringAsync(url).catch(() => {})
    haptic.done()
    setCopied(true)
    setTimeout(() => setCopied(false), 1_500)
  }
  const send = () => {
    SystemShare.share(Platform.OS === "ios" ? { url } : { message: url, title: site?.title }).catch(
      // A browser that cannot share: the link is copied, which is the next best thing.
      () => void copy(),
    )
  }

  return (
    <Screen>
      {title}
      <Section
        footer={
          site !== undefined
            ? undefined
            : `This gives it a link of its own, which shows it as it is in the library. ${
                audience.long === "Only you"
                  ? "Only you can open it until you make it public."
                  : `${audience.long} can open it, and nobody else until you make it public.`
              }`
        }
      >
        <Row
          title="Share with a link"
          busy={busy && site === undefined}
          toggle={{
            value: site !== undefined,
            disabled: busy,
            onChange: (on) =>
              on ? void start() : site === undefined ? undefined : void stop(site),
          }}
        />
        {site === undefined ? null : (
          <Row
            lead={<Icon name="link" size={20} color={theme.tint} weight="medium" />}
            title={
              <Text
                selectable
                numberOfLines={1}
                style={{ fontFamily: mono, fontSize: 14 }}
                tone="ink2"
              >
                {shownAddress(url)}
              </Text>
            }
            tail={
              <Button
                kind="grey"
                size="small"
                title={copied ? "Copied" : "Copy"}
                accessibilityLabel={`Copy the link to ${site.title}`}
                onPress={() => void copy()}
              />
            }
          />
        )}
      </Section>

      {site === undefined ? null : (
        <>
          <Section title="Who can open it">
            <Radio
              title={audience.long}
              line={audience.who}
              checked={!site.public}
              disabled={busy}
              onPress={() => open(site, false)}
            />
            <Radio
              title="Anyone with the link"
              line="No sign-in needed"
              checked={site.public}
              disabled={busy}
              onPress={() => open(site, true)}
            />
          </Section>
          <View style={{ marginHorizontal: 16, gap: 10 }}>
            <Button icon="share" title="Send the link…" onPress={send} />
            <Button
              kind="grey"
              destructive
              title="Stop sharing"
              disabled={busy}
              onPress={() => void stop(site)}
            />
          </View>
        </>
      )}
    </Screen>
  )
}
