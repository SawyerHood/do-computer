import { Appearance } from "react-native"
import { storage } from "@/lib/storage"

/** Light or dark, or whichever the phone is set to. Kept by this phone, not by the account. */
export type AppearanceChoice = "system" | "light" | "dark"

export const APPEARANCES: readonly { value: AppearanceChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

const KEY = "dc.appearance"

/** Whether the app can be told how to look. A browser follows its own setting and nothing else. */
export const canSetAppearance =
  typeof (Appearance as { setColorScheme?: unknown }).setColorScheme === "function"

export function chosenAppearance(): AppearanceChoice {
  const kept = storage.get(KEY)
  return kept === "light" || kept === "dark" ? kept : "system"
}

/** Make the app look the way that was chosen. Called once at start, and on every change. */
export function applyAppearance(choice: AppearanceChoice = chosenAppearance()): void {
  if (!canSetAppearance) return
  Appearance.setColorScheme(choice === "system" ? "unspecified" : choice)
}

export function setAppearance(choice: AppearanceChoice): void {
  if (choice === "system") storage.remove(KEY)
  else storage.set(KEY, choice)
  applyAppearance(choice)
}

// Whoever imports this has the kept choice applied: the root should, so that it holds from launch.
if (chosenAppearance() !== "system") applyAppearance()
