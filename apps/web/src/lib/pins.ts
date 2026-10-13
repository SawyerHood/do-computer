import { type LibraryFile, type Pin, pinOf } from "@do-computer/protocol"
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query"
import { client } from "@/lib/client"
import { pinsKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"

/** What is pinned to an agent, in the order it is shown. */
export const pinsQuery = (agentId: string) =>
  queryOptions({ queryKey: pinsKey(agentId), queryFn: () => client.agent(agentId).pins() })

export const usePins = (agentId: string) => useQuery(pinsQuery(agentId)).data

/** Pinning a file and taking a pin off: each shown as soon as the agent has answered. */
export function usePinning(agentId: string) {
  const api = client.agent(agentId)
  const keep = (pins: Pin[]) => queryClient.setQueryData(pinsKey(agentId), pins)
  const pin = useMutation({
    mutationFn: (file: { fileId: string; title?: string | undefined }) =>
      api.pin(file.fileId, file.title),
    onSuccess: keep,
  })
  const unpin = useMutation({ mutationFn: (fileId: string) => api.unpin(fileId), onSuccess: keep })
  return { pin, unpin, pending: pin.isPending || unpin.isPending, error: pin.error ?? unpin.error }
}

/**
 * One file's pin: whether it is pinned to the agent, and the pressing that pins it or takes the
 * pin off. A file from before files had a place cannot be pinned.
 */
export function usePin(agentId: string, file: Pick<LibraryFile, "id"> & { path?: string }) {
  const pins = usePins(agentId)
  const { pin, unpin, pending, error } = usePinning(agentId)
  const mine = pinOf(pins, file)
  return {
    pinned: mine !== undefined,
    pending,
    error,
    toggle: () =>
      mine === undefined ? pin.mutate({ fileId: file.id }) : unpin.mutate(mine.fileId),
  }
}
