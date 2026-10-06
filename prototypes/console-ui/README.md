# Console-mascot UI prototype

A design exploration from 2026-10-05: what the whole app could look like if it leaned into a
late-90s console look, to go with the agent's creature. It is a click-through page, not part of
the app. Nothing here is imported by the app.

```sh
node prototypes/console-ui/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for three.js and its fonts. Useful switches on the address:
`?theme=night`, `?demo=0` (no scripted conversation), `?speed=3`, `?boot=0`, and `#chat`,
`#hatch`, `#agent`, `#automations`, `#library` and the other page names.

## The direction

One design with two faces, switched by the theme button: a pale "system menu" by day and a
deep-blue "online lobby" by night.

1. **Pixels only where that era had them.** The creature and a small 1-bit readout are pixelated.
   Everything else is smooth: glossy capsule buttons, glass bubble icons in the rail, translucent
   windows in a soft space, a dithered sky only behind the creature.
2. **The creature gets a stage.** It stands on a slowly turning checker turntable in its own
   viewport at the top of the agent panel, with a name plate, the readout and a strip of counts.
3. **Arcade type on the chrome, a rounded face on what you read.** Titles, tabs and buttons are
   italic condensed capitals. Messages are a rounded face at a comfortable size on plain bubbles.

There are no real console, game or character names in it, and it must stay that way.

## What is in it

- **Chat**, opening mid-conversation, with a scripted turn that plays by itself: the creature
  listens, thinks, runs commands, asks for an OK, schedules a task, answers and finishes.
  Pause, Replay, Tour and About are in the bottom bar.
- **The agent panel** with the per-request activity entries the app now has, plus small blocks
  for each step, colored by kind of work.
- **First run** (`#hatch`): the egg presented as a new save slot.
- **Identity and memory** (`#agent`) as a character sheet, with bars read from the creature's seed.
- **Automations** with clock dials, **Library**, and lighter versions of the remaining pages.
- **Phone width**: one column, the agent panel as a bottom sheet.

Only one creature is ever animated: one canvas is moved between the places it appears.

## What its author would carry into the app, in order

| #   | Idea                                                                                     | Rough size                              |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | The stage in the agent panel: turntable, dithered backdrop, name plate; panel to ~400 px | One small component                     |
| 2   | Step blocks on the activity entries, colored by kind of work (`toolKind` gives the kind) | Small addition                          |
| 3   | The two palettes and the type                                                            | Colors and three fonts in `styles.css`  |
| 4   | A key-hints bar with a few real shortcuts                                                | One small component                     |
| 5   | The 1-bit readout, and memory counted in blocks                                          | One component; charm more than function |
| 6   | Identity and memory as a character sheet                                                 | A screen redesign; the largest item     |
| 7   | First run and the agent switcher as save slots                                           | New framing of an existing screen       |

Not worth carrying: the "now loading" moment on every page change.

## Known weaknesses

- The day look is calmer and less clearly of the era than the night one.
- The "Done!" banner covers the turntable for a couple of seconds.
- The creature's shadow sits on the turntable as a grey slab.
- Some seeds make a rough 1-bit portrait.
- It was only ever checked with software rendering in headless Chromium: not on a real GPU, a
  real phone, Safari, Firefox or with a screen reader.

The owner has seen it and has not yet said which of these to build.
