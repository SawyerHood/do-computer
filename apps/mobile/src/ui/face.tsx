import { Image } from "expo-image"
import { View } from "react-native"
import { Text } from "./text"

const COLORS = ["#127a78", "#c0607a", "#c9952c", "#7d5a9a", "#3f7f9c", "#5f8a4e", "#b8674a"]

/** The color a person's face is drawn in when they have no picture: always the same for them. */
function colorOf(id: string): string {
  let sum = 0
  for (const letter of id) sum = (sum * 31 + letter.charCodeAt(0)) >>> 0
  return COLORS[sum % COLORS.length]!
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("")

/** A person: their picture, or their initials on a color of their own. */
export function Face({
  person,
  size = 28,
  ring,
}: {
  person: { id: string; name: string; image?: string | null }
  size?: number
  /** A ring around it in this color, for faces that overlap. */
  ring?: string
}) {
  const border = ring === undefined ? null : { borderWidth: 2, borderColor: ring }
  if (person.image) {
    return (
      <Image
        source={{ uri: person.image }}
        accessibilityLabel={person.name}
        style={[{ width: size, height: size, borderRadius: size / 2 }, border]}
      />
    )
  }
  return (
    <View
      accessibilityLabel={person.name}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colorOf(person.id),
          alignItems: "center",
          justifyContent: "center",
        },
        border,
      ]}
    >
      <Text
        allowFontScaling={false}
        style={{
          fontSize: Math.round(size * 0.4),
          lineHeight: size,
          fontWeight: "600",
          color: "#fff",
        }}
      >
        {initials(person.name)}
      </Text>
    </View>
  )
}

/** A few faces, each over the edge of the one before. */
export function Faces({
  people,
  size = 22,
  ring,
}: {
  people: readonly { id: string; name: string; image?: string | null }[]
  size?: number
  ring: string
}) {
  return (
    <View style={{ flexDirection: "row" }}>
      {people.slice(0, 3).map((person, at) => (
        <View key={person.id} style={{ marginLeft: at === 0 ? 0 : -6 }}>
          <Face person={person} size={size} ring={ring} />
        </View>
      ))}
    </View>
  )
}

/** A workspace's tile: its first letter on its color. */
export function Tile({ name, color, size = 30 }: { name: string; color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.27),
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        allowFontScaling={false}
        style={{
          fontSize: Math.round(size * 0.5),
          lineHeight: size,
          fontWeight: "700",
          color: "#fff",
        }}
      >
        {(name.trim()[0] ?? "?").toUpperCase()}
      </Text>
    </View>
  )
}
