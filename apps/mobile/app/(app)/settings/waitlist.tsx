import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ActivityIndicator, View } from "react-native"
import { useSession } from "@/lib/use-session"
import { Button, errorText, haptic, Row, Screen, Section, tell, Text } from "@/ui"
import { Avatar } from "@/ui/avatar"

const waitlistKey = ["waitlist"] as const

const joined = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })

/**
 * Who has made an account and is waiting to be let in, for whoever looks after a deployment
 * that has a waiting list. Letting someone in is all there is to do here.
 */
export default function Waitlist() {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const list = useQuery({ queryKey: waitlistKey, queryFn: () => client.waitlist.list() })
  const admit = useMutation({
    mutationFn: (userId: string) => client.waitlist.admit(userId),
    onSuccess: () => haptic.done(),
    onError: (error) => tell("That did not work", errorText(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: waitlistKey }),
  })
  const data = list.data
  const people = data?.people ?? []
  return (
    <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      <Text variant="subhead" tone="ink2" style={{ marginHorizontal: 32, marginBottom: 18 }}>
        Anyone can make an account and hatch a Dood. The app itself is for you, the people you
        invite to a team, and whoever you let in here.
      </Text>
      {data === undefined && !list.isError ? <ActivityIndicator style={{ marginBottom: 18 }} /> : null}
      <Text
        variant="footnote"
        tone={list.isError && data === undefined ? "red" : "ink2"}
        accessibilityRole={list.isError && data === undefined ? "alert" : undefined}
        style={{ marginHorizontal: 32, marginBottom: 7 }}
      >
        {data === undefined
          ? list.isError
            ? "The list could not be read."
            : "Reading the list…"
          : data.total === 0
            ? "Nobody is waiting."
            : data.total === 1
              ? "1 person is waiting."
              : `${data.total} people are waiting.`}
      </Text>
      <Section
        footer={
          data !== undefined && data.total > people.length
            ? `Showing the ${people.length} who have waited longest.`
            : undefined
        }
      >
        {people.map((person) => (
          <Row
            key={person.id}
            lead={
              <View style={{ width: 34, height: 34 }}>
                {person.dood === null ? null : (
                  <Avatar
                    avatar={{ color: person.dood.color, seed: person.dood.seed }}
                    seed={person.dood.seed}
                    size={34}
                    still
                  />
                )}
              </View>
            }
            title={person.dood === null ? person.name : `${person.name} with ${person.dood.name}`}
            subtitle={`${person.email} · since ${joined(person.joinedAt)}`}
            tail={
              <Button
                kind="grey"
                size="small"
                title="Let in"
                busy={admit.isPending && admit.variables === person.id}
                onPress={() => admit.mutate(person.id)}
              />
            }
          />
        ))}
      </Section>
    </Screen>
  )
}
