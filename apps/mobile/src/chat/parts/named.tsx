import type { LibraryFile, LibraryListing } from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { type ReactNode, useState } from "react"
import { Pressable, View } from "react-native"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { haptic, Icon, Text } from "@/ui"
import type { MarkdownProps, PictureBlock } from "@/ui/markdown"
import { Film } from "./film"
import { fileIcon, namedBy, shownAs } from "./logic"
import { Rows } from "./rows"
import { Card, ChipIcon, useChatScope } from "./shared"
import { alwaysShow, useShownHost } from "./shown-hosts"
import { Sound } from "./sound"

type Draw = (src: string) => ReactNode

/** How the library of the agent whose chat this is, is asked for. */
function useListingQuery() {
  const { agentId } = useChatScope()
  const { client } = useSession()
  return {
    // Under the library's own name, so that whatever asks for the library again asks for this too.
    queryKey: ["agents", agentId, "library", "listing"],
    queryFn: () => client.agent(agentId).libraryListing(),
  }
}

/** The library of the agent whose chat this is, asked for only where something needs it. */
export function useListing(wanted = true): LibraryListing | undefined {
  return useQuery({ ...useListingQuery(), enabled: wanted }).data
}

/**
 * A file of the library shown in a chat as what it is: a film or a sound to play, a table to
 * read. Nothing, for a file of any other kind: a picture has a way of its own, and the rest are
 * only named.
 */
export function LibraryEmbed({ file, view }: { file: LibraryFile; view: string }) {
  const { agentId } = useChatScope()
  const { client } = useSession()
  const router = useRouter()
  const queryClient = useQueryClient()
  const listing = useListingQuery()
  const as = shownAs(file)
  if (as === "table") return <Rows file={file} view={view} />
  if (as !== "film" && as !== "sound") return null
  const address = (view: string) =>
    `${client.agent(agentId).libraryViewUrl(view, file.path)}?v=${file.rev}`
  const Player = as === "film" ? Film : Sound
  return (
    <Player
      // Another file, or the same one changed, is another thing to play.
      key={`${file.id}:${file.rev}`}
      src={address(view)}
      name={file.name}
      // The address a file is viewed at stops working after some hours. The library is asked
      // again, and gives the one that works now.
      onStale={async () =>
        address((await queryClient.fetchQuery({ ...listing, staleTime: 0 })).view)
      }
      way={{
        label: "Open in the library",
        onPress: () => router.push(`/a/${agentId}/library/${file.id}`),
      }}
    />
  )
}

/** What stands where something named in a reply cannot be shown: its words, quietly. */
function Missing({ words }: { words: string }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name="photo" size={15} color={theme.ink3} />
      <Text variant="subhead" tone="ink2" style={{ flexShrink: 1 }}>
        {words}
      </Text>
    </View>
  )
}

/**
 * Something named by where it is in the library, which is where the agent's files are: a
 * picture drawn, a film or a sound played, a table's first rows. Anything else there is a chip
 * that opens it in the library, and anything that is not there is its words.
 */
function LibraryThing({ path, alt, draw }: { path: string; alt: string; draw: Draw }) {
  const { agentId } = useChatScope()
  const { client } = useSession()
  const router = useRouter()
  const listing = useListing()
  // Until the library has answered there is nothing to say of the file, either way.
  if (listing === undefined) return null
  const file = listing.files.find((entry) => entry.path === path)
  const words = alt === "" ? path : alt
  if (file === undefined) return <Missing words={words} />
  const as = shownAs(file)
  if (as === "picture") {
    return draw(`${client.agent(agentId).libraryViewUrl(listing.view, file.path)}?v=${file.rev}`)
  }
  if (as !== undefined) return <LibraryEmbed file={file} view={listing.view} />
  return (
    <Card style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={words}
        accessibilityHint="Opens it in the library"
        onPress={() => {
          haptic.tap()
          router.push(`/a/${agentId}/library/${file.id}`)
        }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: 10,
          paddingRight: 14,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <ChipIcon icon={fileIcon(file)} />
        <Text variant="subhead" weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
          {words}
        </Text>
      </Pressable>
    </Card>
  )
}

/** One of the two things a reader can say of a picture at another site. */
function Say({ label, hint, onPress }: { label: string; hint?: string; onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: theme.fill,
        maxWidth: "100%",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text variant="footnote" weight="600" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

/**
 * A picture at another site's address. It is not loaded until the reader says so, for that
 * site: asking for it tells the site who is reading, and the address can be written to carry
 * anything the agent has read.
 */
function Remote({ host, alt, children }: { host: string; alt: string; children: ReactNode }) {
  const allowed = useShownHost(host)
  const [once, setOnce] = useState(false)
  if (allowed || once) return children
  return (
    <Card style={{ alignSelf: "flex-start", maxWidth: "100%", padding: 12, gap: 10 }}>
      <Text variant="subhead" tone="ink2">
        {alt === "" ? "A picture" : alt} from{" "}
        <Text variant="subhead" weight="600">
          {host}
        </Text>
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Say label="Show" onPress={() => setOnce(true)} />
        <Say
          label={`Always from ${host}`}
          hint={`Shows what is at ${host} without asking, from now on`}
          onPress={() => alwaysShow(host)}
        />
      </View>
    </Card>
  )
}

/**
 * What a reply writes as a picture. One written into the reply itself is drawn at once, one in
 * the library is shown as the file it is, and one at another site waits to be asked for. An
 * address that is none of these is its words.
 */
function Named({ picture, draw }: { picture: PictureBlock; draw: Draw }) {
  const named = namedBy(picture.src)
  if (named === undefined) return <Missing words={picture.alt === "" ? "A picture" : picture.alt} />
  if (named.at === "reply") return draw(named.src)
  if (named.at === "library")
    return <LibraryThing path={named.path} alt={picture.alt} draw={draw} />
  return (
    <Remote host={named.host} alt={picture.alt}>
      {draw(named.src)}
    </Remote>
  )
}

/** How the Markdown of a chat draws a picture: what an agent wrote there is drawn this way. */
export const drawNamed: NonNullable<MarkdownProps["image"]> = (picture, draw) => (
  <Named picture={picture} draw={draw} />
)
