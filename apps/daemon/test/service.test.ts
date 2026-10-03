import { describe, expect, it } from "vitest"
import { serviceFile } from "../src/service.ts"

const options = {
  home: "/home/sam",
  node: "/usr/bin/node",
  script: "/home/sam/.durable-computer/bin/daemon.cjs",
  args: ["https://agent.example.com"],
  logFile: "/home/sam/.durable-computer/daemon.log",
}

describe("service file", () => {
  it("is a systemd user unit on Linux that restarts the daemon", () => {
    const service = serviceFile({ ...options, platform: "linux" })!
    expect(service.path).toBe("/home/sam/.config/systemd/user/durable-computer-daemon.service")
    expect(service.content).toContain(
      'ExecStart="/usr/bin/node" "/home/sam/.durable-computer/bin/daemon.cjs" "https://agent.example.com"',
    )
    expect(service.content).toContain("Restart=always")
    expect(service.enable.at(-1)).toEqual([
      "systemctl",
      "--user",
      "enable",
      "--now",
      "durable-computer-daemon.service",
    ])
  })

  it("is a launchd agent on macOS that keeps the daemon alive and logs to a file", () => {
    const service = serviceFile({ ...options, platform: "darwin", home: "/Users/sam" })!
    expect(service.path).toBe("/Users/sam/Library/LaunchAgents/com.durable-computer.daemon.plist")
    expect(service.content).toContain("<string>https://agent.example.com</string>")
    expect(service.content).toContain("<key>KeepAlive</key><true/>")
    expect(service.content).toContain("<string>/home/sam/.durable-computer/daemon.log</string>")
  })

  it("quotes paths with spaces and escapes markup", () => {
    const linux = serviceFile({
      ...options,
      platform: "linux",
      script: '/home/sam/my "tools"/daemon.cjs',
    })!
    expect(linux.content).toContain('"/home/sam/my \\"tools\\"/daemon.cjs"')
    const mac = serviceFile({
      ...options,
      platform: "darwin",
      args: ["https://a.example/?x=1&y=<2>"],
    })!
    expect(mac.content).toContain("<string>https://a.example/?x=1&amp;y=&lt;2&gt;</string>")
  })

  it("is not offered where there is no supported service manager", () => {
    expect(serviceFile({ ...options, platform: "win32" })).toBe(undefined)
  })
})
