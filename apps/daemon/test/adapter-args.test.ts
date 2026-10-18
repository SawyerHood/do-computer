import { expect, it } from "vitest"
import { parseArguments } from "../src/args.ts"

it("keeps selecting an adapter separate from granting screen access", () => {
  expect(parseArguments(["--screen-adapter=hyprland"])).toMatchObject({
    screenAdapter: "hyprland",
    screen: undefined,
  })
  expect(
    parseArguments(["--enable-screen", "--screen-adapter", "x11", "--browser-adapter=dev-browser"]),
  ).toMatchObject({ screen: true, screenAdapter: "x11", browserAdapter: "dev-browser" })
  expect(parseArguments(["--no-screen"]).screen).toBe(false)
  expect(parseArguments(["--doctor"]).doctor).toBe(true)
})
it.each([
  ["auto", "auto"],
  ["wayland", "hyprland"],
  ["hyprland", "hyprland"],
  ["x11", "x11"],
  ["embedded", "ipc"],
  ["ipc", "ipc"],
])("treats --screen=%s as an explicit owner opt-in", (mode, adapter) => {
  expect(parseArguments([`--screen=${mode}`])).toMatchObject({
    screen: true,
    screenAdapter: adapter,
    browser: undefined,
  })
})
it("keeps off authoritative and wake separately opt-in", () => {
  expect(parseArguments(["--screen=off", "--enable-screen"])).toMatchObject({
    screen: false,
    screenAdapter: "none",
  })
  expect(parseArguments(["--screen=x11", "--no-screen"])).toMatchObject({
    screen: false,
    screenAdapter: "x11",
  })
  expect(parseArguments(["--wake-display"])).toMatchObject({ wakeDisplay: true, screen: undefined })
  expect(parseArguments(["--wake-display", "--no-wake-display"]).wakeDisplay).toBe(false)
})
it.each([
  ["auto", true],
  ["dev-browser", true],
  ["off", false],
])("selects --browser=%s independently", (mode, enabled) => {
  expect(parseArguments([`--browser=${mode}`])).toMatchObject({
    browser: enabled,
    screen: undefined,
  })
  expect(parseArguments(["--browser", String(mode)])).toMatchObject({
    browser: enabled,
    screen: undefined,
  })
})
it.each([
  ["--screen-adapter"],
  ["--screen=__proto__"],
  ["--screen=constructor"],
  ["--screen=unknown"],
  ["--browser=unknown"],
  ["--browser", "unknown"],
  ["--screen-adapter=unknown"],
  ["--browser-adapter=unknown"],
  ["--screen-adapter", "--enable-screen"],
])("rejects invalid adapter arguments %s", (...args) => {
  expect(() => parseArguments(args)).toThrow()
})
