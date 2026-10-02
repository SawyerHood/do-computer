import * as path from "node:path"

const LABEL = "com.durable-computer.daemon"

export type ServiceFile = { path: string; content: string; enable: string[][] }

const quote = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`

/**
 * What it takes to keep the daemon running across logins and restarts: a unit file and the
 * commands that load it. Nothing here touches the machine; the caller writes and runs.
 */
export function serviceFile(options: {
  platform: NodeJS.Platform
  home: string
  node: string
  script: string
  args: string[]
  logFile: string
}): ServiceFile | undefined {
  const command = [options.node, options.script, ...options.args]
  if (options.platform === "linux") {
    const unit = path.join(options.home, ".config/systemd/user/durable-computer-daemon.service")
    return {
      path: unit,
      content: `[Unit]
Description=durable computer daemon
After=network-online.target

[Service]
ExecStart=${command.map(quote).join(" ")}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`,
      enable: [
        ["systemctl", "--user", "daemon-reload"],
        ["systemctl", "--user", "enable", "--now", "durable-computer-daemon.service"],
      ],
    }
  }
  if (options.platform === "darwin") {
    const plist = path.join(options.home, `Library/LaunchAgents/${LABEL}.plist`)
    const escape = (value: string) =>
      value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    return {
      path: plist,
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${command.map((part) => `    <string>${escape(part)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escape(options.logFile)}</string>
  <key>StandardErrorPath</key><string>${escape(options.logFile)}</string>
</dict>
</plist>
`,
      enable: [
        ["launchctl", "unload", plist],
        ["launchctl", "load", plist],
      ],
    }
  }
  return undefined
}
