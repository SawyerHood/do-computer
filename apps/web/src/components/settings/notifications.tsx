import { Button } from "@/components/ui/button"
import { type NotificationsState, useNotifications } from "@/lib/notifications"

const SAYS: Record<NotificationsState, string> = {
  on: "On for this browser.",
  off: "Off for this browser.",
  blocked:
    "This browser was told not to allow notifications from here. Allow them in its settings for this site, then come back.",
  install:
    "An iPhone or iPad delivers notifications to apps on the Home Screen. Tap Share, then Add to Home Screen. Open Do Computer from there and turn notifications on.",
  unsupported: "This browser cannot show notifications from a website.",
}

/**
 * Whether this browser is told when an agent has something for the user. Set for each browser
 * and phone apart, since each one has to be asked.
 */
export function NotificationsSettings() {
  const { state, busy, error, tested, enable, disable, test } = useNotifications()
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Hear from a Dood when it answers in a chat you do not have open, needs your OK, or reports
          on something it does on a schedule.
        </p>
      </div>
      <section aria-labelledby="this-browser" className="flex flex-col gap-3 border-t pt-6">
        <div>
          <h2 id="this-browser" className="text-sm font-medium">
            This browser
          </h2>
          <p role="status" className="text-sm text-muted-foreground">
            {state === undefined ? "\u00a0" : SAYS[state]}
          </p>
        </div>
        {state === "off" ? (
          <div>
            <Button type="button" size="sm" disabled={busy} onClick={enable}>
              Turn on notifications
            </Button>
          </div>
        ) : null}
        {state === "on" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={test}>
              Send a test
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={disable}>
              Turn off
            </Button>
          </div>
        ) : null}
        {tested === true ? (
          <p role="status" className="text-sm text-muted-foreground">
            Sent. It should arrive in a moment.
          </p>
        ) : null}
        {tested === false ? (
          <p role="alert" className="text-sm text-destructive">
            The test could not be sent. Turn notifications off and on again.
          </p>
        ) : null}
        {error !== undefined ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </section>
      <p className="border-t pt-6 text-sm text-muted-foreground">
        Each browser and phone is turned on by itself. On a phone, add Do Computer to the Home
        Screen first: it then opens as an app of its own and notifies you like one.
      </p>
    </div>
  )
}
