You are a senior product designer reviewing the user interface of three personal agent apps. You are looking at screenshots only: do not run commands or edit anything.

The screenshots are in the folder given below:

- `do-computer-*`: **Do Computer**, the app under review. Fixed views of the actual web UI (also the Electron app's main UI), responsive phone UI, and Electron's own computer/device settings pages with a mocked preload bridge. Light and dark themes. A personal agent companion (Doods), with a deliberately friendly creature identity and teal accents.
- `grok-*`: **Grok Bot**, xAI's always-on agent app launched August 2026: specialized bots using a persistent cloud computer and connected tools. Not Grok chat or Grok Build. Official launch-video frames, including desktop conversations and phone work.
- `muse-*`: **Meta Muse**, Meta's consumer long-running personal agent at muse.ai, available across mobile, Mac, and web. Continues working while the user is away, handles tasks, goals, browser work, approvals and connected apps. Not Meta AI chat or the muse coding CLI. Official product-site UI images.
  The comparison shots are video frames and marketing crops, some at lower resolution and different sizes. Judge the design, not the image quality, the demo content or the window chrome.

Score each of the three apps from 1 to 10 (one decimal allowed) in each of these categories:

- `hierarchy`: visual hierarchy
- `typography`
- `iconography`
- `color_contrast`: color & contrast
- `spacing_layout`: spacing & layout
- `consistency`
- `polish`: polish / overall

Be calibrated and strict: 10 is flawless, best-in-class work; 5 is mediocre. Score each app on its own merits, by the same standard.

Then list Do Computer's **top 8 concrete issues**, most important first. For each: the screenshot(s), the exact element, what is wrong, and a specific fix (sizes in px, weights, colors, radii, alignment). The owner wants a minimal UI with little text, no colored status dots, keeps the creature-companion + teal identity and wants it to keep some color rather than turn grayscale: suggest polish of details, not a redesign.

Answer with only this JSON object, nothing before or after it:

```json
{
  "scores": {
    "do_computer": {
      "hierarchy": 0,
      "typography": 0,
      "iconography": 0,
      "color_contrast": 0,
      "spacing_layout": 0,
      "consistency": 0,
      "polish": 0
    },
    "grok_bot": {
      "hierarchy": 0,
      "typography": 0,
      "iconography": 0,
      "color_contrast": 0,
      "spacing_layout": 0,
      "consistency": 0,
      "polish": 0
    },
    "meta_muse": {
      "hierarchy": 0,
      "typography": 0,
      "iconography": 0,
      "color_contrast": 0,
      "spacing_layout": 0,
      "consistency": 0,
      "polish": 0
    }
  },
  "issues": [
    { "where": "do-computer-01-thread-light.png", "element": "", "problem": "", "fix": "" }
  ],
  "strengths": ["what already works in Do Computer, briefly"]
}
```
