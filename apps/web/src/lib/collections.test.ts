import { CancelledError } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { client } from "./client.ts"
import { agentsKey, agentsQuery, listedAgents } from "./collections.ts"
import { queryClient } from "./query.ts"

describe("the list of agents, for a route that waits for it", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    queryClient.clear()
  })

  /** The server never answers the first request for the list, and answers the rest at once. */
  function slowAtFirst() {
    let asked = 0
    vi.spyOn(client, "listAgents").mockImplementation(() => {
      asked++
      return asked === 1
        ? new Promise(() => {})
        : Promise.resolve([{ id: "a", workspaceId: "w" } as never])
    })
    return () => asked
  }

  it("is given up as cancelled when the request is let go of, left to itself", async () => {
    slowAtFirst()
    const waited = queryClient.fetchQuery(agentsQuery)
    // What the last thing showing the list does to a request that is on its way.
    void queryClient.cancelQueries({ queryKey: agentsKey })
    await expect(waited).rejects.toBeInstanceOf(CancelledError)
  })

  it("is asked for again, and is the list that came of that", async () => {
    const asked = slowAtFirst()
    const waited = listedAgents()
    void queryClient.cancelQueries({ queryKey: agentsKey })
    expect(await waited).toEqual([{ id: "a", workspaceId: "w" }])
    expect(asked()).toBe(2)
  })

  it("fails when the list does", async () => {
    vi.spyOn(client, "listAgents").mockRejectedValue(new Error("refused"))
    await expect(listedAgents()).rejects.toThrow("refused")
  })
})
