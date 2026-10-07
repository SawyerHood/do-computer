import { BodyTooLarge, declaredTooLarge, readLimited } from "@durable-computer/protocol"
import {
  cleanLibraryPath,
  LibraryConflict,
  LibraryError,
  type LibraryStore,
  MAX_LIBRARY_FILE_BYTES,
} from "./library-store.ts"

const json = (value: unknown, status = 200) => Response.json(value, { status })
const fail = (status: number, error: string, code?: string) => json({ error, code }, status)

/**
 * Answer a request about a library's files, for whoever keeps the library: an agent that has one
 * of its own, or the actor of a workspace's. `segments` is the path after `library`. Resolves
 * with undefined for a request that is not one of these.
 *
 * `agentId` is the agent through which the request came, where several share the library: a file
 * uploaded in a chat is put down to it, and only its own chats are named in a listing.
 */
export async function routeLibrary(
  store: LibraryStore,
  request: Request,
  segments: readonly string[],
  agentId?: string,
): Promise<Response | undefined> {
  const url = new URL(request.url)
  const method = request.method
  const [fileId, action] = segments
  const missing = () => fail(404, "File not found")
  /** The request's body as a file's content, read only up to the size a file may be. */
  const content = async (): Promise<Uint8Array | Response> => {
    const tooLarge = () => fail(413, "That file is too large.")
    if (declaredTooLarge(request.headers, MAX_LIBRARY_FILE_BYTES)) return tooLarge()
    // Counted as it arrives: the declared length is only what the sender says.
    try {
      return await readLimited(request.body, MAX_LIBRARY_FILE_BYTES)
    } catch (error) {
      if (error instanceof BodyTooLarge) return tooLarge()
      throw error
    }
  }
  try {
    if (fileId === undefined && method === "GET") return json(await store.listing(agentId))
    if (fileId === undefined && method === "POST") {
      // The body is the file. Its name, and where it goes, are in the query: a `path` for a new
      // document at exactly that place, or a `name` to go into `dir` or with the uploads.
      const name = url.searchParams.get("name")
      const path = url.searchParams.get("path")
      if ((name === null || name === "") && (path === null || path === "")) {
        return fail(400, "name is required")
      }
      const bytes = await content()
      if (bytes instanceof Response) return bytes
      const file = await store.add({
        ...(path !== null && path !== ""
          ? { path: cleanLibraryPath(path) ?? "" }
          : { name: name!, dir: url.searchParams.get("dir") ?? undefined }),
        bytes,
        source: "user",
        chatId: url.searchParams.get("chat"),
        agentId,
        contentType: request.headers.get("content-type") ?? undefined,
      })
      return json(file, 201)
    }
    if (fileId === "deleted" && action !== undefined) {
      if (segments[2] === "restore" && method === "POST") {
        const file = await store.restore(action)
        return file === undefined ? missing() : json(file)
      }
      if (segments[2] === undefined && method === "DELETE") {
        return (await store.forget(action)) ? json({ ok: true }) : missing()
      }
    }
    if (fileId !== undefined && action === undefined) {
      if (method === "GET") return (await store.serve(fileId, request)) ?? missing()
      if (method === "PUT") {
        // New content for the file. With `rev`, only if it is still at that revision.
        const rev = url.searchParams.get("rev")
        const bytes = await content()
        if (bytes instanceof Response) return bytes
        try {
          return json(
            await store.write(fileId, bytes, "user", {
              ifRev: rev === null ? undefined : Number(rev),
            }),
          )
        } catch (error) {
          if (error instanceof LibraryConflict) return fail(409, error.message, "conflict")
          throw error
        }
      }
      if (method === "PATCH") {
        const { path } = (await request.json().catch(() => ({}))) as { path?: unknown }
        if (typeof path !== "string") return fail(400, "path is required")
        return json(await store.move(fileId, path))
      }
      if (method === "DELETE") {
        return (await store.remove(fileId, "user")) ? json({ ok: true }) : missing()
      }
    }
    if (fileId !== undefined && action === "versions" && method === "GET") {
      const versions = await store.versions(fileId)
      return versions === undefined ? missing() : json({ versions })
    }
    if (fileId !== undefined && action === "revert" && method === "POST") {
      const { rev } = (await request.json().catch(() => ({}))) as { rev?: unknown }
      if (typeof rev !== "number") return fail(400, "rev is required")
      return json(await store.revert(fileId, rev, "user"))
    }
  } catch (error) {
    if (error instanceof LibraryError) return fail(400, error.message)
    throw error
  }
  return undefined
}

/**
 * Serve a library file as the page it is, to whoever holds an address for it. `segments` is the
 * path after `view`: the token that stands in for a session, then the file's path.
 */
export async function routeLibraryView(
  store: LibraryStore,
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  const missing = () => fail(404, "Not found")
  const [token, ...rest] = segments
  if (token === undefined || request.method !== "GET") return missing()
  let path: string
  try {
    path = rest.map(decodeURIComponent).join("/")
  } catch {
    return missing()
  }
  return (await store.view(token, path, request)) ?? missing()
}
