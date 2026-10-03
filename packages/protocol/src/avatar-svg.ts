import type { Avatar } from "./agent.ts"
import { avatarLook } from "./avatars.ts"

const INK = "#1b2021"

/**
 * A still of an agent's creature as SVG markup: a plain blob in its color. The living one is
 * drawn by the clients; this stands in while that loads, where it cannot run, and anywhere only
 * an image will do.
 */
export function avatarSvg(avatar: Avatar | null | undefined, agentId: string): string {
  const { color } = avatarLook(avatar, agentId)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<ellipse cx="32" cy="56" rx="15" ry="3" fill="${INK}" fill-opacity="0.18"/>` +
    `<path d="M32 11c12 0 21 9 21 21 0 11-8 20-21 20S11 43 11 32c0-12 9-21 21-21Z" fill="${color}"/>` +
    `<g fill="#fff"><ellipse cx="25" cy="32" rx="4.2" ry="5"/><ellipse cx="39" cy="32" rx="4.2" ry="5"/></g>` +
    `<g fill="${INK}"><circle cx="25.6" cy="33" r="2.4"/><circle cx="39.6" cy="33" r="2.4"/></g>` +
    `</svg>`
  )
}
