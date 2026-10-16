import {
  cardTrouble,
  cardWords,
  keepsSecrets,
  type SavedCard,
  type SavedLogin,
  usedWords,
} from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { useRefresh } from "@/computers/shared"
import { useWorkspaces } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { cardsKey, loginsKey } from "@/passwords/keys"
import {
  confirm,
  Empty,
  errorText,
  haptic,
  HeaderItems,
  Icon,
  type MenuItem,
  Row,
  Screen,
  Section,
  SwipeRow,
  tell,
  Text,
} from "@/ui"

/** A login's mark, where a face would be: the first letter of its name. */
function Letter({ name }: { name: string }) {
  const theme = useTheme()
  return (
    <View
      // A mark, not a word: the row is named by the name beside it.
      aria-hidden
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        borderCurve: "continuous",
        backgroundColor: theme.fill,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text weight="600" tone="ink2" style={{ textTransform: "uppercase" }}>
        {name.trim()[0] ?? "?"}
      </Text>
    </View>
  )
}

/** A card's mark: the shape of one. */
function CardMark() {
  const theme = useTheme()
  return (
    <View
      // A mark, not a word: the row is named by the name beside it.
      aria-hidden
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        borderCurve: "continuous",
        backgroundColor: theme.fill,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name="card" size={18} color={theme.ink2} />
    </View>
  )
}

/** Two lines under a saved thing's name: what it is, and when it was used or what is wrong. */
function Lines({ first, second, wrong }: { first: string; second: string; wrong: boolean }) {
  return (
    <>
      <Text variant="subhead" tone="ink2" numberOfLines={2}>
        {first}
      </Text>
      <Text variant="footnote" tone={wrong ? "red" : "ink2"} numberOfLines={2}>
        {second}
      </Text>
    </>
  )
}

/**
 * Remove something saved after asking, and list what is left. Resolves true where it was
 * removed. Nothing secret goes out or comes back: only which one.
 */
function useRemove() {
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState<string>()
  const remove = async (
    what: { id: string; title: string; message: string },
    work: () => Promise<unknown>,
    key: readonly unknown[],
  ) => {
    const sure = await confirm({ title: what.title, message: what.message, action: "Remove" })
    if (!sure) return false
    setRemoving(what.id)
    try {
      await work()
      haptic.done()
      return true
    } catch (error) {
      haptic.fail()
      tell("That did not work", errorText(error, "That did not work. Try again."))
      return false
    } finally {
      setRemoving(undefined)
      await queryClient.invalidateQueries({ queryKey: key })
    }
  }
  return { removing, remove }
}

/**
 * A workspace's Passwords: the logins its Doods sign in to websites with and the cards they pay
 * with, whichever of the two it keeps and this person may see, as the web app has them. Nobody
 * is shown a password or a number here. A login can be given a new password, changed or
 * removed; a card can only be removed, and added again.
 */
export default function Passwords() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>()
  const router = useRouter()
  const { client } = useSession()
  const workspaces = useWorkspaces()
  const workspace = workspaces.data?.workspaces.find((each) => each.id === workspaceId)
  const api = client.workspace(workspaceId)
  const logins = useQuery<SavedLogin[]>({
    queryKey: loginsKey(workspaceId),
    queryFn: () => api.savedLogins(),
    enabled: workspace?.savedLogins === true,
  })
  const cards = useQuery<SavedCard[]>({
    queryKey: cardsKey(workspaceId),
    queryFn: () => api.savedCards(),
    enabled: workspace?.savedCards === true,
  })
  const { removing, remove } = useRemove()
  const refresh = useRefresh(() =>
    Promise.all([
      workspaces.refetch(),
      workspace?.savedLogins ? logins.refetch() : undefined,
      workspace?.savedCards ? cards.refetch() : undefined,
    ]),
  )

  const base = `/settings/w/${encodeURIComponent(workspaceId)}/passwords`
  const addLogin = () => router.push(`${base}/login` as never)
  const addCard = () => router.push(`${base}/card` as never)
  const openLogin = (login: SavedLogin, what: "change" | "password") =>
    router.push(`${base}/login?loginId=${encodeURIComponent(login.id)}&what=${what}` as never)

  if (workspace === undefined || !keepsSecrets(workspace)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Passwords" }} />
        {workspaces.data === undefined ? (
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : (
          // Someone joined the team who is not an admin, or the deployment stopped keeping them.
          <Empty title="No passwords here">
            This workspace keeps no logins or cards that you can see.
          </Empty>
        )}
      </Screen>
    )
  }

  const add: MenuItem[] = [
    ...(workspace.savedLogins
      ? [{ title: "Add a login", icon: "key" as const, onPress: addLogin }]
      : []),
    ...(workspace.savedCards
      ? [{ title: "Add a card", icon: "card" as const, onPress: addCard }]
      : []),
  ]
  const removeLogin = (login: SavedLogin) =>
    void remove(
      {
        id: login.id,
        title: `Remove ${login.name}?`,
        message:
          "Its password is deleted, and no Dood of this workspace can sign in with it any more.",
      },
      () => api.removeSavedLogin(login.id),
      loginsKey(workspaceId),
    )
  const removeCard = (card: SavedCard) =>
    void remove(
      {
        id: card.id,
        title: `Remove ${card.name}?`,
        message: "Its number is deleted, and no Dood of this workspace can pay with it any more.",
      },
      () => api.removeSavedCard(card.id),
      cardsKey(workspaceId),
    )

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: "Passwords" }} />
      {add.length === 1 ? (
        <HeaderItems items={[{ icon: "plus", label: add[0]!.title, onPress: add[0]!.onPress }]} />
      ) : (
        <HeaderItems items={[{ icon: "plus", label: "Add a login or a card", menu: add }]} />
      )}

      {workspace.savedLogins ? (
        <>
          <Text variant="subhead" tone="ink2" style={{ marginHorizontal: 32, marginBottom: 14 }}>
            Logins the Doods of this workspace can sign in with. A Dood uses one without seeing it,
            and only on the sites it is for.
          </Text>
          {logins.data === undefined ? (
            logins.isError ? (
              <Text
                variant="footnote"
                tone="red"
                style={{ marginHorizontal: 32, marginBottom: 22 }}
              >
                {errorText(logins.error)}
              </Text>
            ) : (
              <ActivityIndicator style={{ marginVertical: 24 }} />
            )
          ) : (
            <View accessibilityRole="list" accessibilityLabel="Saved logins">
              <Section
                title="Logins"
                footer={
                  logins.data.length === 0
                    ? "Add one here, or wait for a Dood to ask: when a site wants it to sign in and it has no login for it, it asks you for one in the chat."
                    : "Kept encrypted by Do Computer. A password can be replaced or removed here, and never shown again, to you or to a Dood. Whether a Dood asks before using one is set under its Permissions."
                }
              >
                {logins.data.length === 0 ? <Row title="No logins yet" /> : null}
                {logins.data.map((login) => (
                  <SwipeRow
                    key={login.id}
                    actions={[
                      {
                        title: "Password",
                        icon: "key",
                        color: "grey",
                        onPress: () => openLogin(login, "password"),
                      },
                      {
                        title: "Remove",
                        icon: "trash",
                        color: "red",
                        onPress: () => removeLogin(login),
                      },
                    ]}
                  >
                    <Row
                      lead={<Letter name={login.name} />}
                      title={login.name}
                      subtitle={
                        <Lines
                          first={`${login.username} · ${login.sites.join(", ")}`}
                          second={
                            login.unreadable
                              ? "Its password can no longer be read: give it again"
                              : usedWords(login)
                          }
                          wrong={login.unreadable === true}
                        />
                      }
                      busy={removing === login.id}
                      go
                      // One whose password cannot be read goes straight to giving it again.
                      onPress={() => openLogin(login, login.unreadable ? "password" : "change")}
                    />
                  </SwipeRow>
                ))}
                <Row title="Add a login" tone="tint" onPress={addLogin} />
              </Section>
            </View>
          )}
        </>
      ) : null}

      {workspace.savedCards ? (
        <>
          <Text variant="subhead" tone="ink2" style={{ marginHorizontal: 32, marginBottom: 14 }}>
            Cards the Doods of this workspace can pay with on websites. A Dood uses one without
            seeing its number, and someone is asked every time.
          </Text>
          {cards.data === undefined ? (
            cards.isError ? (
              <Text
                variant="footnote"
                tone="red"
                style={{ marginHorizontal: 32, marginBottom: 22 }}
              >
                {errorText(cards.error)}
              </Text>
            ) : (
              <ActivityIndicator style={{ marginVertical: 24 }} />
            )
          ) : (
            <View accessibilityRole="list" accessibilityLabel="Saved cards">
              <Section
                title="Cards"
                footer={
                  cards.data.length === 0
                    ? "Add one for the Doods of this workspace to pay with when a website asks for a card."
                    : "A card’s security code is never kept. Whoever says a card may be used types it then. To change a card, remove it and add it again."
                }
              >
                {cards.data.length === 0 ? <Row title="No cards yet" /> : null}
                {cards.data.map((card) => {
                  const wrong = cardTrouble(card)
                  return (
                    <SwipeRow
                      key={card.id}
                      actions={[
                        {
                          title: "Remove",
                          icon: "trash",
                          color: "red",
                          onPress: () => removeCard(card),
                        },
                      ]}
                    >
                      <Row
                        lead={<CardMark />}
                        title={card.name}
                        subtitle={
                          <Lines
                            first={cardWords(card)}
                            second={wrong ?? usedWords(card)}
                            wrong={wrong !== undefined}
                          />
                        }
                        busy={removing === card.id}
                        // A card has nothing to change: a row's one control is the way to remove
                        // it, for someone who does not swipe.
                        tail={
                          removing === card.id ? null : (
                            <Text
                              tone="red"
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${card.name}`}
                              onPress={() => removeCard(card)}
                              suppressHighlighting
                            >
                              Remove
                            </Text>
                          )
                        }
                      />
                    </SwipeRow>
                  )
                })}
                <Row title="Add a card" tone="tint" onPress={addCard} />
              </Section>
            </View>
          )}
        </>
      ) : null}
    </Screen>
  )
}
