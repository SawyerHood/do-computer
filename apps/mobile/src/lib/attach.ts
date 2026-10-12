import type { LibraryFile } from "@durable-computer/protocol"
import { atom, getDefaultStore, useAtomValue } from "jotai"

const store = getDefaultStore()

/**
 * Files of the library chosen to go with the message being written in a chat, by the chat's id.
 * The screen that picks one is not the one that writes the message, so what was picked waits here.
 */
const pickedAtom = atom<Readonly<Record<string, readonly LibraryFile[]>>>({})

export const usePicked = (chatId: string): readonly LibraryFile[] =>
  useAtomValue(pickedAtom)[chatId] ?? []

export function pick(chatId: string, file: LibraryFile): void {
  store.set(pickedAtom, (kept) => {
    const have = kept[chatId] ?? []
    return have.some((each) => each.id === file.id) ? kept : { ...kept, [chatId]: [...have, file] }
  })
}

export function unpick(chatId: string, fileId?: string): void {
  store.set(pickedAtom, (kept) => ({
    ...kept,
    [chatId]: fileId === undefined ? [] : (kept[chatId] ?? []).filter((each) => each.id !== fileId),
  }))
}
