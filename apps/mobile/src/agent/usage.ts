const UNITS = ["", "K", "M", "B", "T"] as const

/**
 * A count of tokens in a few characters: 950, 1.2K, 123.5K, 4M. It reads the same as the web's
 * `Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })`, which is written
 * out here because a phone's JavaScript engine does not have that notation everywhere.
 */
export function tokens(count: number): string {
  let value = Math.abs(count)
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit += 1
  }
  let rounded = Math.round(value * 10) / 10
  // 999,950 is a million, not a thousand thousands.
  if (rounded >= 1000 && unit < UNITS.length - 1) {
    rounded /= 1000
    unit += 1
  }
  return `${count < 0 ? "-" : ""}${rounded}${UNITS[unit]}`
}

/** Small amounts keep their cents' cents: a chat can cost a fraction of one. */
export const dollars = (cost: number): string =>
  cost === 0 ? "$0" : cost < 0.01 ? "under $0.01" : `$${cost.toFixed(cost < 10 ? 2 : 0)}`
