import { appendFileSync } from "node:fs"
import { relative } from "node:path"
import type { FullConfig, Reporter, Suite } from "@playwright/test/reporter"

/** What a workflow command's message may not hold as it is. */
const message = (text: string) =>
  text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
/** And one of its properties, where a colon or a comma would end it. */
const property = (text: string) => message(text).replace(/:/g, "%3A").replace(/,/g, "%2C")

/**
 * Names the tests that failed and then passed when they were run again. CI runs a failed test
 * once more, so such a test no longer fails a run, and would go unseen: here it is a warning on
 * the run and a line in its summary, for whoever looks for the tests that cannot be relied on.
 */
export default class Flaky implements Reporter {
  private suite: Suite | undefined

  onBegin(_config: FullConfig, suite: Suite) {
    this.suite = suite
  }

  onEnd() {
    const flaky = (this.suite?.allTests() ?? []).filter((test) => test.outcome() === "flaky")
    if (flaky.length === 0 || process.env.GITHUB_ACTIONS !== "true") return
    const root = process.env.GITHUB_WORKSPACE ?? process.cwd()
    const lines: string[] = []
    for (const test of flaky) {
      const file = relative(root, test.location.file).replace(/\\/g, "/")
      // Without the project and the file, which the place already says.
      const title = test.titlePath().slice(3).join(" › ")
      const failed = test.results.find((result) => result.status !== "passed")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: the colors of a terminal
      const why = (failed?.error?.message ?? "").replace(/\x1b\[[0-9;]*m/g, "").split("\n")[0]!
      console.log(
        `::warning file=${property(file)},line=${test.location.line},title=Flaky test::${message(`${title}: ${why}`)}`,
      )
      lines.push(`- \`${file}:${test.location.line}\` ${title}: ${why}`)
    }
    const summary = process.env.GITHUB_STEP_SUMMARY
    if (summary !== undefined) {
      appendFileSync(summary, `### Failed, then passed when run again\n\n${lines.join("\n")}\n\n`)
    }
  }

  printsToStdio() {
    return false
  }
}
