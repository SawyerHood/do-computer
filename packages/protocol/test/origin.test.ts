import { describe, expect, it } from "vitest"
import { deviceOf } from "../src/index.ts"

describe("the kind of device a browser is on", () => {
  it("is read from what the browser calls itself", () => {
    expect(
      deviceOf(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
      ),
    ).toBe("Mac")
    expect(
      deviceOf(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      ),
    ).toBe("Windows")
    expect(deviceOf("Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0")).toBe(
      "Linux",
    )
    expect(
      deviceOf(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
        5,
      ),
    ).toBe("iPhone")
  })

  it("is Android for a browser that also calls itself Linux", () => {
    expect(
      deviceOf(
        "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
        5,
      ),
    ).toBe("Android")
  })

  it("is an iPad for a Mac that can be touched, which is what an iPad says it is", () => {
    const mac =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
    expect(deviceOf(mac, 5)).toBe("iPad")
    expect(deviceOf(mac, 0)).toBe("Mac")
    expect(
      deviceOf("Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"),
    ).toBe("iPad")
  })

  it("is the desktop app's too, which is a browser underneath", () => {
    expect(
      deviceOf(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) do-computer/0.7.0 Chrome/146.0.0.0 Electron/44.7.0 Safari/537.36",
      ),
    ).toBe("Mac")
  })

  it("is not said where the browser does not say", () => {
    expect(deviceOf("")).toBeUndefined()
    expect(deviceOf("curl/8.5.0")).toBeUndefined()
  })
})
