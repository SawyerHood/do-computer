import { MAX_PINS, type Pin, pinOf, pinsFull } from "@do-computer/protocol"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { keys, useAgentLive, useAgentSummary } from "@/lib/queries"
import { useSession } from "@/lib/use-session"
import { errorText, haptic, type MenuItem, type SwipeAction, tell } from "@/ui"
import { pinChoice } from "./model"

/**
 * What is pinned to a Dood, in the order it is shown. The Dood says when that changes, over the
 * socket every screen of it follows, so nothing is asked for on a timer.
 */
export function usePins(agentId: string): Pin[] | undefined {
  const { client } = useSession()
  useAgentLive(agentId)
  return useQuery({ queryKey: keys.pins(agentId), queryFn: () => client.agent(agentId).pins() })
    .data
}

/**
 * Pinning a file to a Dood and taking a pin off. Each answers with all that is then pinned,
 * which is shown at once. One more than a Dood can have is refused here, in the words the
 * server would use, without asking it.
 */
export function usePinning(agentId: string) {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const name = useAgentSummary(agentId)?.name ?? "Your Dood"
  const pins = usePins(agentId)
  const keep = (next: Pin[]) => {
    haptic.done()
    queryClient.setQueryData(keys.pins(agentId), next)
  }
  const pin = useMutation({
    mutationFn: (file: { fileId: string; title?: string | undefined }) =>
      client.agent(agentId).pin(file.fileId, file.title),
    onSuccess: keep,
    onError: (error) => {
      haptic.fail()
      tell("It could not be pinned", errorText(error))
    },
  })
  const unpin = useMutation({
    mutationFn: (fileId: string) => client.agent(agentId).unpin(fileId),
    onSuccess: keep,
    onError: (error) => {
      haptic.fail()
      tell("The pin could not be taken off", errorText(error))
    },
  })
  return {
    name,
    pins,
    pending: pin.isPending || unpin.isPending,
    pin: (file: { fileId: string; title?: string | undefined }) => {
      if (pinsFull(pins) && pinOf(pins, { id: file.fileId }) === undefined) {
        haptic.fail()
        tell(
          `${MAX_PINS} things are pinned already`,
          `That is as many as ${name} can have. Unpin one first.`,
        )
        return
      }
      pin.mutate(file)
    },
    unpin: (fileId: string) => unpin.mutate(fileId),
  }
}

/**
 * One file's pin: whether it is pinned to the Dood, the pressing that pins it or takes the pin
 * off, and the same as an item for a menu and an action for a swipe. A file from before files
 * had a place cannot be pinned, and gets neither.
 */
export function usePinOf(agentId: string) {
  const pinning = usePinning(agentId)
  return (file: { id: string; path?: string | undefined }) => {
    const choice = pinChoice(pinning.pins, file, pinning.name)
    const toggle = () => {
      if (choice === undefined) return
      if (choice.pinned) pinning.unpin(choice.fileId)
      else pinning.pin({ fileId: choice.fileId })
    }
    return {
      pinned: choice?.pinned === true,
      toggle,
      menu:
        choice === undefined
          ? []
          : [
              {
                title: choice.title,
                icon: choice.icon,
                disabled: pinning.pending,
                onPress: toggle,
              } satisfies MenuItem,
            ],
      swipe:
        choice === undefined
          ? []
          : [
              {
                title: choice.short,
                icon: choice.icon,
                color: PIN_COLOR,
                onPress: toggle,
              } satisfies SwipeAction,
            ],
    }
  }
}

/** The color of pinning where it is a swipe: the orange Messages and Notes pin with. */
export const PIN_COLOR = "#f09a1a"
