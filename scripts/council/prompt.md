You are a senior product designer reviewing the user interface of three apps for personal AI agents: agents that keep working on their own computer after you close the app. You are looking at screenshots only: do not run commands or edit anything.

The screenshots are in the folder given below:

- `do-computer-*`: **Do Computer**, the app under review. Its agents are called Doods; each has a name and a creature for a face. Every view is shot in a light and a dark theme (`-light`, `-dark`); `01`–`06` are a desktop window (1440×900), `07`/`08` a phone (390 wide). The views: `01` a Dood with nothing said yet, `02` a chat with work done in it, `03` further up the same chat (a table and a chart the agent drew), `04` the agent at work with the panel about it open, `05` the library of documents, `06` settings (connectors), `07` the chat on a phone, `08` the home screen on a phone.
- `grok-*`: **Grok Bot**, xAI's agent app (named AI teammates with their own cloud computer, desktop and iOS), for comparison: frames of tutorial screen recordings of the desktop app.
- `muse-*`: **Muse**, Meta's consumer long-running personal agent (muse.ai: iPhone, Android, Mac and web), for comparison: frames of Meta's own product tour and a tutorial, and composites from muse.ai.

The comparison shots are video frames and marketing images, some at lower resolution, some with a presenter's webcam inset or other video overlays. Judge the design of the apps, not image quality, overlays, demo content or window chrome.

Score each of the three apps from 1 to 10 (one decimal allowed) in each of these categories:

- `hierarchy`: visual hierarchy
- `typography`
- `iconography`
- `color_contrast`: color & contrast
- `spacing_layout`: spacing & layout
- `consistency`
- `polish`: polish / overall

Be calibrated and strict: 10 is flawless, best-in-class work; 5 is mediocre. Score each app on its own merits, by the same standard.

Then list Do Computer's **top 8 concrete issues**, most important first. For each: the screenshot(s), the exact element, what is wrong, and a specific fix (sizes in px, weights, colors, radii, alignment). The owner's taste: a minimal UI with little text, no colored status dots, polish of details rather than a redesign, and keeping the app's identity (its creatures and their colors) and some color rather than turning it grayscale.

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
    "muse": {
      "hierarchy": 0,
      "typography": 0,
      "iconography": 0,
      "color_contrast": 0,
      "spacing_layout": 0,
      "consistency": 0,
      "polish": 0
    }
  },
  "issues": [{ "where": "do-computer-02-chat-light.png", "element": "", "problem": "", "fix": "" }],
  "strengths": ["what already works in Do Computer, briefly"]
}
```
