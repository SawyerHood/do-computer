import { AVATAR_COLORS, type Person, workspaceColor } from "@durable-computer/protocol"
import { cn } from "@/lib/utils"

/** A color for someone with no picture, the same every time for the same person. */
function colorOf(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!.hex
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters =
    words.length > 1 ? words[0]![0]! + words.at(-1)![0]! : (words[0]?.slice(0, 2) ?? "?")
  return letters.toUpperCase()
}

/**
 * Someone's face: their picture where they have one, their initials on a color of their own
 * where they do not. Flat and round, so it is never taken for an agent's creature.
 */
export function PersonFace({
  person,
  className,
  here,
  title,
}: {
  person: Person
  className?: string
  /** Mark them as here right now. */
  here?: boolean
  title?: string
}) {
  return (
    <span
      role="img"
      aria-label={person.name}
      title={title ?? person.name}
      className={cn(
        "relative inline-grid size-6 shrink-0 place-items-center rounded-full text-[0.625rem] leading-none font-semibold text-white select-none [container-type:inline-size]",
        className,
      )}
      style={person.image ? undefined : { backgroundColor: colorOf(person.id) }}
    >
      {person.image ? (
        <img
          src={person.image}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full rounded-full object-cover"
        />
      ) : (
        <span className="text-[40cqw]">{initials(person.name)}</span>
      )}
      {here ? (
        <span
          aria-hidden
          className="absolute -right-px -bottom-px size-[32%] min-h-1.5 min-w-1.5 rounded-full bg-[oklch(0.7_0.16_150)] ring-2 ring-(--face-ring,var(--background))"
        />
      ) : null}
    </span>
  )
}

/** A few faces overlapping, for who is in a place. More than fit are counted. */
export function FaceStack({
  people,
  className,
  max = 3,
}: {
  people: readonly Person[]
  /** The size of each face. */
  className?: string
  max?: number
}) {
  if (people.length === 0) return null
  const shown = people.slice(0, max)
  const more = people.length - shown.length
  return (
    <span
      className="inline-flex shrink-0 items-center"
      title={people.map((person) => person.name).join(", ")}
    >
      {shown.map((person, index) => (
        <PersonFace
          key={person.id}
          person={person}
          title=""
          className={cn(
            "ring-2 ring-(--face-ring,var(--background))",
            index > 0 && "-ml-1",
            className,
          )}
        />
      ))}
      {more > 0 ? <span className="ml-1 text-xs text-muted-foreground">+{more}</span> : null}
    </span>
  )
}

/** A team's tile: its first letter on its color. A personal workspace is its owner's face. */
export function WorkspaceTile({
  workspace,
  className,
}: {
  workspace: { name: string; color: string }
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid size-9 shrink-0 place-items-center rounded-[30%] text-base leading-none font-bold text-white select-none [container-type:inline-size]",
        className,
      )}
      style={{ backgroundColor: workspaceColor(workspace.color) }}
    >
      <span className="text-[46cqw]">{(workspace.name.trim()[0] ?? "?").toUpperCase()}</span>
    </span>
  )
}

/** "Maya", "Maya and Jon", "Maya, Jon and Priya". */
export function names(people: readonly { name: string }[], you?: string): string {
  const list = people.map((person) => (person.name === you ? "you" : person.name.split(" ")[0]!))
  // At the start of what is said, as this always is.
  if (list[0] === "you") list[0] = "You"
  if (list.length <= 1) return list.join("")
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`
}
