import { type Avatar, avatarSvg } from "@durable-computer/protocol"
import { useMemo } from "react"
import { cn } from "@/lib/utils"

/**
 * An agent's avatar, drawn from its character, color and accessory. The drawing itself is shared
 * with the mobile app; here it is shown as an image.
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
  const source = useMemo(
    () => `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(avatar, seed))}`,
    [avatar, seed],
  )
  return (
    <img
      src={source}
      alt="Agent avatar"
      className={cn("size-8 shrink-0 rounded-full bg-background", className)}
    />
  )
}
