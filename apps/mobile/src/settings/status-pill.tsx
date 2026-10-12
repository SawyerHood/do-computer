import { useTheme } from "@/lib/theme"
import { Pill } from "@/ui"
import type { ScheduleStatus } from "./schedule"

/** The word on an automation's pill, in the color the web app gives it. */
export function StatusPill({ status }: { status: ScheduleStatus }) {
  const theme = useTheme()
  if (status === "Running") return <Pill label={status} color={theme.tint} />
  return <Pill label={status} tone={status === "Active" ? "good" : "plain"} />
}
