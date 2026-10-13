import { MCP_APP_STYLE_NAMES } from "@do-computer/protocol"

/**
 * The app's colors and shapes as they are at this moment, under the names MCP Apps gives them,
 * for a connector's page to be drawn in. Each is worked out by the browser, since a page that
 * is somebody else's has none of the app's variables to work it out from.
 */
export function appStyleVariables(): Record<string, string> {
  const probe = document.createElement("span")
  probe.style.display = "none"
  document.documentElement.appendChild(probe)
  const variables: Record<string, string> = {}
  for (const [name, ours] of Object.entries(MCP_APP_STYLE_NAMES)) {
    probe.style.color = `var(${ours})`
    variables[name] = getComputedStyle(probe).color
  }
  probe.remove()
  const root = getComputedStyle(document.documentElement)
  const body = getComputedStyle(document.body)
  variables["--font-sans"] = body.fontFamily
  variables["--font-mono"] =
    '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  variables["--border-radius-md"] = root.getPropertyValue("--radius").trim() || "0.5rem"
  return variables
}
