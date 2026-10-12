import { ApiError } from "@durable-computer/client"
import type { LibraryFile } from "@durable-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { keys } from "@/lib/queries"
import { useSession } from "@/lib/use-session"

/**
 * Where an edit stands: `clean` before anything is typed, `dirty` and `saving` on the way to
 * `saved`, `conflict` when the file was changed by the agent underneath the edit, and `error`
 * when saving failed for any other reason.
 */
export type SaveState = "clean" | "dirty" | "saving" | "saved" | "conflict" | "error"

/** The words each state is told in, as the web app tells them. */
export const SAVE_WORDS: Record<SaveState, string> = {
  clean: "",
  dirty: "Saving…",
  saving: "Saving…",
  saved: "Saved",
  conflict: "Not saved",
  error: "Could not save",
}

const SAVE_AFTER_MS = 700

/** The name a file's text at one revision is kept under. A revision's content never changes. */
export const textKey = (agentId: string, fileId: string, rev: number) =>
  ["agents", agentId, "library-text", fileId, rev] as const

/**
 * A text file's content, and the editing of it. What is typed is saved a moment after typing
 * stops. A save says which revision it was made from, so a change the agent made meanwhile is
 * never silently overwritten: it becomes a conflict for the person to settle. The same as the
 * web app's.
 */
export function useDocument(agentId: string, file: LibraryFile, enabled = true) {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const api = useMemo(() => client.agent(agentId), [client, agentId])
  const { data, isError, refetch } = useQuery({
    queryKey: textKey(agentId, file.id, file.rev),
    queryFn: () => api.libraryText(file.id, file.rev),
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
  })
  const [draft, setDraft] = useState<string>()
  const [state, setState] = useState<SaveState>("clean")
  /** The revision the draft was made from, and the text known to be stored at it. */
  const base = useRef(file.rev)
  const stored = useRef<string | undefined>(undefined)
  const saving = useRef(false)
  const latest = useRef(draft)
  latest.current = draft

  const save = useCallback(
    async (overwrite = false) => {
      const text = latest.current
      if (text === undefined || saving.current) return
      saving.current = true
      setState("saving")
      try {
        const result = await api.writeLibraryFile(
          file.id,
          text,
          overwrite ? undefined : base.current,
        )
        base.current = result.rev
        stored.current = text
        queryClient.setQueryData(textKey(agentId, file.id, result.rev), text)
        void queryClient.invalidateQueries({ queryKey: keys.library(agentId) })
        // Typed into while it was being saved: there is more to save.
        setState(latest.current === text ? "saved" : "dirty")
      } catch (error) {
        setState(error instanceof ApiError && error.code === "conflict" ? "conflict" : "error")
      } finally {
        saving.current = false
      }
    },
    [agentId, api, file.id, queryClient],
  )

  useEffect(() => {
    if (state !== "dirty") return
    const timer = setTimeout(() => void save(), SAVE_AFTER_MS)
    return () => clearTimeout(timer)
    // Restarted by every keystroke, which changes the draft.
  }, [state, draft, save])

  // The file moved on: the agent wrote to it, or it was put back to an earlier version.
  useEffect(() => {
    if (saving.current || file.rev === base.current) return
    if (latest.current === undefined || latest.current === stored.current) {
      // Nothing unsaved here, so show what it is now.
      base.current = file.rev
      stored.current = undefined
      setDraft(undefined)
      setState("clean")
    } else setState("conflict")
  }, [file.rev])

  // Leaving the file with something typed and not yet saved: save it on the way out.
  const leaving = useRef(() => {})
  leaving.current = () => {
    if (state === "dirty") void save()
  }
  useEffect(() => () => leaving.current(), [])

  return {
    /** Undefined until the content has loaded. */
    text: draft ?? data,
    failed: isError && draft === undefined,
    retry: () => void refetch(),
    state,
    edit: (text: string) => {
      setDraft(text)
      setState((current) => (current === "conflict" ? current : "dirty"))
    },
    /** Save now what was typed, as after a save that failed. */
    saveNow: () => void save(),
    /** Settle a conflict by keeping what was typed. What the agent wrote stays as a version. */
    keepMine: () => void save(true),
    /** Settle a conflict by dropping what was typed. */
    takeTheirs: () => {
      base.current = file.rev
      stored.current = undefined
      setDraft(undefined)
      setState("clean")
    },
  }
}
