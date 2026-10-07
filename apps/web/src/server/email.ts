import type { Config } from "./platform.ts"

const RESEND_URL = "https://api.resend.com/emails"

/** Whether this deployment can send mail: it needs a Resend key and an address to send from. */
export const canSendEmail = (config: Config) =>
  config.email.resendApiKey !== undefined && config.email.from !== undefined

/**
 * Send one plain email through Resend. Resolves false when the deployment has no mail set up or
 * the message did not go: mail is a courtesy here, and whoever asked for it is told it was not
 * sent and given another way.
 */
export async function sendEmail(
  config: Config,
  message: { to: string; subject: string; text: string },
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const { resendApiKey, from } = config.email
  if (resendApiKey === undefined || from === undefined) return false
  try {
    const response = await fetcher(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${resendApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    })
    return response.ok
  } catch {
    return false
  }
}
