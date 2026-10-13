import { describe, expect, it } from "vitest"
import { cardBrand, cardDigits, isCardNumber, paySite, signInSite, siteHost } from "../src/index.ts"

describe("siteHost", () => {
  it.each([
    ["github.com", "github.com"],
    ["GitHub.com", "github.com"],
    ["  github.com  ", "github.com"],
    ["https://github.com/login?return_to=%2F", "github.com"],
    ["http://dashboard.stripe.com:8443/", "dashboard.stripe.com"],
    ["github.com.", "github.com"],
    ["xn--bcher-kva.example", "xn--bcher-kva.example"],
    ["localhost", "localhost"],
    ["127.0.0.1", "127.0.0.1"],
  ])("takes %j for %j", (typed, host) => {
    expect(siteHost(typed)).toBe(host)
  })

  it.each([
    "",
    "com",
    "not a site",
    "10.0.0.1",
    "192.168.1.1",
    "[::1]",
    "javascript:alert(1)",
    "*.github.com",
    "-bad.example",
    "a".repeat(300),
  ])("refuses %j", (typed) => {
    expect(siteHost(typed)).toBeNull()
  })

  it("takes an address for its host, whatever else is in it", () => {
    expect(siteHost("github.com/../evil.example")).toBe("github.com")
    expect(siteHost("https://user:pass@github.com/")).toBe("github.com")
  })
})

describe("signInSite", () => {
  const sites = ["github.com", "dashboard.stripe.com"]

  it.each([
    ["https://github.com/login", "github.com"],
    ["https://GITHUB.com/login", "github.com"],
    ["https://gist.github.com/", "gist.github.com"],
    ["https://dashboard.stripe.com/login", "dashboard.stripe.com"],
    ["https://github.com:8443/session", "github.com"],
  ])("lets a login be typed on %j", (url, host) => {
    expect(signInSite(url, sites)).toBe(host)
  })

  it.each([
    // Not reached by https.
    "http://github.com/login",
    // Another site that only looks like it.
    "https://github.com.evil.example/login",
    "https://evilgithub.com/login",
    "https://github-settings.example.net/",
    "https://github.co/",
    // A site above the one the login is for.
    "https://stripe.com/login",
    // The site's name anywhere but in the host.
    "https://evil.example/github.com",
    "https://evil.example/?next=https://github.com",
    "https://github.com@evil.example/",
    "https://evil.example#github.com",
    // Not a page of a website at all.
    "about:blank",
    "chrome://settings",
    "file:///tmp/github.com.html",
    "data:text/html,<input type=password>",
    "javascript:void 0",
    "",
    undefined,
  ])("lets nothing be typed on %j", (url) => {
    expect(signInSite(url, sites)).toBeNull()
  })

  it("lets a page on this computer be plain http, for a login saved for it", () => {
    expect(signInSite("http://localhost:3000/login", ["localhost"])).toBe("localhost")
    expect(signInSite("http://127.0.0.1:8765/login", ["127.0.0.1"])).toBe("127.0.0.1")
    // And for no other login.
    expect(signInSite("http://localhost:3000/login", sites)).toBeNull()
    expect(signInSite("http://127.0.0.1:8765/login", ["localhost"])).toBeNull()
  })

  it("takes a site kept with a trailing dot, in capitals or as an address", () => {
    expect(signInSite("https://github.com/", ["https://GitHub.com/login"])).toBe("github.com")
    expect(signInSite("https://github.com./", ["github.com"])).toBe("github.com")
  })

  it("is for no site where the login names none that is one", () => {
    expect(signInSite("https://github.com/", [])).toBeNull()
    expect(signInSite("https://github.com/", ["com", ""])).toBeNull()
  })
})

describe("a card's number", () => {
  it.each([
    "4242424242424242",
    "5555555555554444",
    "378282246310005",
    "6011111111111117",
    "2223003122003222",
  ])("%s is one", (digits) => {
    expect(isCardNumber(digits)).toBe(true)
  })

  it.each(["4242424242424241", "1234567890123456", "42424242", "", "4242 4242 4242 4242", "abcd"])(
    "%j is not one",
    (digits) => {
      expect(isCardNumber(digits)).toBe(false)
    },
  )

  it("is read with the spaces and dashes it was typed with taken out", () => {
    expect(cardDigits(" 4242 4242-4242 4242 ")).toBe("4242424242424242")
  })

  it.each([
    ["4242424242424242", "Visa"],
    ["5555555555554444", "Mastercard"],
    ["2223003122003222", "Mastercard"],
    ["378282246310005", "American Express"],
    ["6011111111111117", "Discover"],
    ["3530111333300000", "JCB"],
    ["9999999999999995", null],
  ])("%s says whose it is: %j", (digits, brand) => {
    expect(cardBrand(digits)).toBe(brand)
  })
})

describe("paySite", () => {
  it.each([
    ["https://shop.example/checkout", "shop.example"],
    ["https://Checkout.Stripe.com/c/pay/x", "checkout.stripe.com"],
    ["http://localhost:3000/pay", "localhost"],
    ["http://127.0.0.1:8080/pay", "127.0.0.1"],
  ])("lets a card be typed on %j", (url, host) => {
    expect(paySite(url)).toBe(host)
  })

  it.each([
    "http://shop.example/checkout",
    "about:blank",
    "file:///tmp/checkout.html",
    "data:text/html,<input autocomplete=cc-number>",
    "chrome://settings",
    "",
    undefined,
  ])("lets nothing be typed on %j", (url) => {
    expect(paySite(url)).toBeNull()
  })
})
