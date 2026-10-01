import { type Avatar, AVATAR_COLORS, defaultAvatar } from "@durable-computer/protocol"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

const INK = "#241d19"

/** Each character is a body drawn in the avatar's color on a 64x64 canvas; the face is shared. */
const BODIES: Record<string, (color: string) => ReactNode> = {
  sprout: (color) => (
    <>
      <path d="M32 20c-1-7-6-11-13-11 0 7 5 11 13 11Z" fill={color} />
      <path d="M32 20c1-8 6-12 14-12 0 8-6 12-14 12Z" fill={color} opacity="0.8" />
      <rect x="15" y="20" width="34" height="34" rx="17" fill={color} />
    </>
  ),
  ember: (color) => (
    <path
      d="M32 6c3 8 16 15 16 29a16 16 0 0 1-32 0c0-7 4-11 7-15 1 4 3 6 5 6-1-7 1-14 4-20Z"
      fill={color}
    />
  ),
  pebble: (color) => <ellipse cx="32" cy="37" rx="20" ry="16" fill={color} />,
  comet: (color) => (
    <>
      <path d="M8 12l20 10-8 8L8 12Z" fill={color} opacity="0.55" />
      <path d="M4 26l18 4-6 8L4 26Z" fill={color} opacity="0.35" />
      <circle cx="36" cy="36" r="17" fill={color} />
    </>
  ),
  moth: (color) => (
    <>
      <ellipse cx="15" cy="34" rx="11" ry="15" fill={color} opacity="0.6" />
      <ellipse cx="49" cy="34" rx="11" ry="15" fill={color} opacity="0.6" />
      <path
        d="M27 16c-2-5-5-7-8-7M37 16c2-5 5-7 8-7"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <rect x="19" y="15" width="26" height="40" rx="13" fill={color} />
    </>
  ),
  kelp: (color) => (
    <path
      d="M22 56c-6-8 2-13-2-21s2-13 0-19c-1-5 5-9 12-9s13 4 12 9c-2 6 4 11 0 19s4 13-2 21H22Z"
      fill={color}
    />
  ),
  biscuit: (color) => (
    <>
      <rect x="13" y="15" width="38" height="40" rx="9" fill={color} />
      <g fill={INK} opacity="0.18">
        <circle cx="20" cy="22" r="1.5" />
        <circle cx="44" cy="22" r="1.5" />
        <circle cx="20" cy="48" r="1.5" />
        <circle cx="44" cy="48" r="1.5" />
      </g>
    </>
  ),
  orbit: (color) => (
    <>
      <circle cx="32" cy="35" r="16" fill={color} />
      <ellipse
        cx="32"
        cy="42"
        rx="27"
        ry="6"
        fill="none"
        stroke={color}
        strokeWidth="3"
        opacity="0.55"
        transform="rotate(-14 32 42)"
      />
    </>
  ),
}

const ACCESSORIES: Record<string, ReactNode> = {
  glasses: (
    <g fill="none" stroke={INK} strokeWidth="1.8">
      <circle cx="25" cy="35" r="5.5" fill="#fff" fillOpacity="0.25" />
      <circle cx="39" cy="35" r="5.5" fill="#fff" fillOpacity="0.25" />
      <path d="M30.5 35h3" />
    </g>
  ),
  hat: (
    <g fill={INK}>
      <rect x="20" y="17" width="24" height="4" rx="2" />
      <rect x="24" y="8" width="16" height="11" rx="3" />
    </g>
  ),
  bowtie: (
    <g fill={INK}>
      <path d="M32 50l-8-4v8l8-4Zm0 0 8-4v8l-8-4Z" />
      <circle cx="32" cy="50" r="2" />
    </g>
  ),
  headphones: (
    <g>
      <path
        d="M16 36a16 16 0 0 1 32 0"
        fill="none"
        stroke={INK}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <rect x="12" y="33" width="7" height="11" rx="3.5" fill={INK} />
      <rect x="45" y="33" width="7" height="11" rx="3.5" fill={INK} />
    </g>
  ),
  scarf: (
    <g fill={INK} opacity="0.85">
      <rect x="18" y="47" width="28" height="5" rx="2.5" />
      <rect x="38" y="49" width="5" height="10" rx="2" />
    </g>
  ),
}

const hex = (id: string) => AVATAR_COLORS.find((color) => color.id === id)?.hex ?? "#7a6f66"

/**
 * An agent's avatar, drawn from its character, color and accessory. An agent that has not picked
 * one yet gets a stable default derived from `seed`.
 */
export function AgentAvatar({
  avatar,
  seed,
  className,
}: {
  avatar: Avatar | null | undefined
  seed: string
  className?: string
}) {
  const resolved = avatar ?? defaultAvatar(seed)
  const color = hex(resolved.color)
  const body = BODIES[resolved.character] ?? BODIES.pebble!
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="Agent avatar"
      className={cn("size-8 shrink-0 rounded-full", className)}
      style={{ backgroundColor: `color-mix(in oklch, ${color} 22%, var(--canvas))` }}
    >
      {body(color)}
      <g fill={INK}>
        <circle cx="25" cy="35" r="2.4" />
        <circle cx="39" cy="35" r="2.4" />
      </g>
      <path
        d="M27.5 42c2.6 2.4 6.4 2.4 9 0"
        fill="none"
        stroke={INK}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {resolved.accessory ? ACCESSORIES[resolved.accessory] : null}
    </svg>
  )
}
