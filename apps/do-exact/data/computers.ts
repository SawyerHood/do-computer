import type { Result, Sources } from "../app.contract.d.ts"
import type { ComputerSummary, ComputerRequest } from "../protocol/daemon.ts"
import type { ComputerKinds } from "../protocol/agent.ts"
import { boundedAdapterStatus, PAIRED_COMPUTER } from "../protocol/daemon.ts"
import { API, current, del, get, NOBODY, patch, post, put, reply, seg } from "./api.ts"
const answer = async (owner: string, work: () => Promise<void>) => ({
  owner,
  ...(await reply(work)),
})
const pairingAnswer = async (owner: string, code: string, work: () => Promise<void>) => ({
  owner,
  code,
  ...(await reply(work)),
})
export const computersSources: Pick<
  Sources,
  | "loadComputers"
  | "changeComputer"
  | "addComputer"
  | "readPairing"
  | "confirmPairing"
  | "showComputerBrowser"
  | "pairingCodeFromAddress"
> = {
  pairingCodeFromAddress: ([address]) => ({
    code: new URL(address, API).searchParams.get("code") ?? "",
  }),
  loadComputers: async ([owner, workspaceId], store): Promise<Result<"loadComputers">> => {
    if (!workspaceId || !current(owner, store))
      return {
        owner: NOBODY,
        workspaceId: "",
        items: [],
        requests: [],
        kinds: [],
        preferred: "",
        install: "",
        showBrowser: false,
        canChange: false,
      }
    const [{ computers }, { requests }, kinds, options] = await Promise.all([
      get<{ computers: ComputerSummary[] }>(store, "/api/computers"),
      get<{ requests: ComputerRequest[] }>(store, "/api/computers/requests"),
      get<ComputerKinds>(store, "/api/computer-kinds"),
      get<{ showBrowser: boolean; canChange: boolean }>(
        store,
        `/api/workspaces/${seg(workspaceId)}/settings`,
      ),
    ])
    const adapter = (reported: ComputerSummary["screenAdapter"], legacy: boolean) => {
      if (!reported) return legacy ? "Enabled (legacy runner)" : "Not reported by this runner"
      const a = boundedAdapterStatus(reported)
      return `${a.name} · ${{ unsupported: "Unsupported here", disabled: "Disabled by owner", blocked: "Currently blocked", ready: "Ready" }[a.state]}${a.tools?.length ? ` · ${a.tools.join(" / ")}` : ""}${a.reason ? ` · ${a.reason}` : ""}`
    }
    const offered = kinds.kinds.filter((k) => k.id !== "none" && !k.perAgent)
    return {
      owner,
      workspaceId,
      install: `curl -fsSL ${API}/install.sh | sh`,
      preferred: offered.find((k) => k.id === kinds.default)?.id ?? offered[0]?.id ?? "",
      kinds: offered.map((k) => ({ id: k.id, label: k.label, description: k.description })),
      showBrowser: options.showBrowser,
      canChange: options.canChange,
      requests: requests
        .filter((r) => r.canAnswer)
        .map((r) => ({
          id: r.id,
          agentId: r.agentId,
          computer: r.computer.name,
          reason: r.reason,
          note: r.computer.readOnly
            ? "It will be able to read files there"
            : "It will be able to run commands and change files there",
        })),
      items: computers.map((c) => ({
        id: c.id,
        name: c.name,
        workspaceId: c.workspaceId,
        pairedBy: c.pairedBy.id,
        pairedName: c.pairedBy.name,
        machine: c.kind !== PAIRED_COMPUTER,
        kind: c.kind,
        description:
          c.kind !== PAIRED_COMPUTER
            ? (kinds.kinds.find((k) => k.id === c.kind)?.label ?? c.kind)
            : `${({ darwin: "macOS", linux: "Linux", win32: "Windows" } as Record<string, string>)[c.platform] ?? c.platform} · ${c.hostname}${c.readOnly ? " · read-only" : ""}${c.screen ? " · screen" : ""}${c.browser ? " · browser" : ""}`,
        online: c.online,
        readOnly: c.readOnly,
        shareable: c.shareable,
        access: c.access,
        canManage: c.canManage,
        stale: c.kind === PAIRED_COMPUTER && c.online && c.daemon === "outdated",
        daemon: c.daemon ?? "",
        lastSeenAt: c.lastSeenAt ?? 0,
        screen: adapter(c.screenAdapter, c.screen ?? false),
        browser: adapter(c.browserAdapter, c.browser ?? false),
        agentIds: c.agentIds,
        folders: c.folders,
      })),
    }
  },
  changeComputer: async ([owner, id, operation, value, approve], store) =>
    answer(owner, async () => {
      if (!current(owner, store)) throw new Error("Signed out")
      const path = `/api/computers/${seg(id)}`
      if (operation === "remove") await del(store, path)
      else if (operation === "update") await post(store, `${path}/update`)
      else if (operation === "move") await patch(store, path, { workspaceId: value })
      else if (operation === "access") await patch(store, path, { access: value })
      else if (operation === "answer")
        await post(store, `/api/computers/requests/${seg(id)}`, { approve })
      else if (operation === "connect") await put(store, `${path}/agents/${seg(value)}`)
      else if (operation === "disconnect") await del(store, `${path}/agents/${seg(value)}`)
      else throw new Error("Unknown computer change")
    }),
  addComputer: async ([owner, kind, name, workspaceId], store) =>
    answer(owner, async () => {
      if (!current(owner, store)) throw new Error("Signed out")
      await post(store, "/api/computers", {
        kind,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(workspaceId ? { workspaceId } : {}),
      })
    }),
  readPairing: async ([owner, code], store): Promise<Result<"readPairing">> => {
    if (!code || !current(owner, store))
      return {
        owner: NOBODY,
        error: "",
        code: "",
        name: "",
        hostname: "",
        home: "",
        readOnly: false,
      }
    try {
      const p = await get<Omit<Result<"readPairing">, "owner" | "error">>(
        store,
        `/api/computers/pair/request/${seg(code)}`,
      )
      return {
        owner,
        error: "",
        code: p.code,
        name: p.name,
        hostname: p.hostname,
        home: p.home,
        readOnly: p.readOnly,
      }
    } catch (error) {
      return {
        owner,
        code,
        error:
          error instanceof Error
            ? error.message
            : "The computer could not be looked up. Try again.",
        name: "",
        hostname: "",
        home: "",
        readOnly: false,
      }
    }
  },
  confirmPairing: async ([owner, code, workspaceId, agentIds], store) =>
    pairingAnswer(owner, code, async () => {
      if (!current(owner, store)) throw new Error("Signed out")
      await post(store, "/api/computers/pair/confirm", {
        code,
        ...(workspaceId ? { workspaceId } : {}),
        agentIds,
      })
    }),
  showComputerBrowser: async ([owner, workspaceId, showBrowser], store) =>
    answer(owner, async () => {
      if (!current(owner, store)) throw new Error("Signed out")
      await patch(store, `/api/workspaces/${seg(workspaceId)}/settings`, { showBrowser })
    }),
}
