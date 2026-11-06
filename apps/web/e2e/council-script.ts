// What the council's pictures show (`council-shots.ts`): what is said in the main chat, and what
// the echo model answers, written out (`DC_ECHO_REPLIES`). A personal agent planning a weekend
// away: commands on its computer, a document in the library, a chart in the chat, a schedule,
// and a helper still at work, as a day with a Dood looks.

type Reply = {
  readonly tools?: readonly { readonly name: string; readonly args: Record<string, unknown> }[]
  readonly thinking?: string
  readonly text: string
  readonly files?: readonly string[]
}

export const ASK_TRIP =
  "Plan a weekend in Lisbon for Mia and me, Oct 17–19. Under €900 all in, walkable, near the river."

export const ASK_BOOK = "Go with Memmo Alfama. Hold it, and keep an eye on the fare for me."

export const ASK_DINNER =
  "Also find somewhere for dinner on Saturday with a view. Mia loves seafood."

const ITINERARY = `# Lisbon weekend

**Fri 17 – Sun 19 October** · Mia and Sawyer · budget €900

## Getting there

- TAP 1353, SFO → LIS, Fri 07:10 → 08:05 (+1), €412 return each
- Metro from the airport to Baixa-Chiado, 25 min

## Where to stay

Memmo Alfama, two nights, €318. A roof terrace over the river, five minutes from the tram 28 stop.

## Friday

- Coffee at Fábrica, then the Miradouro de Santa Luzia at sunset
- Dinner at Taberna da Rua das Flores (no bookings: go at 18:30)

## Saturday

- Tram 28 to Estrela, walk back down through Bairro Alto
- LX Factory in the afternoon
- Dinner with a view: booking below

## Sunday

- Pastéis de Belém before the queue (08:00)
- Train back to the airport at 13:00
`

const CHART = `<!doctype html><html><head><style>
body{margin:0;font:13px/1.4 system-ui,sans-serif;color:var(--foreground)}
.row{display:grid;grid-template-columns:84px 1fr 52px;align-items:center;gap:10px;margin:7px 0}
.bar{height:10px;border-radius:999px;background:var(--chart-1)}
.bar.b{background:var(--chart-2)}.bar.c{background:var(--chart-3)}.bar.d{background:var(--chart-4)}
.n{color:var(--muted-foreground);text-align:right;font-variant-numeric:tabular-nums}
h2{font-size:13px;font-weight:600;margin:0 0 10px}
</style></head><body>
<h2>Where the €900 goes</h2>
<div class=row><span>Flights</span><div class=bar style="width:92%"></div><span class=n>€824</span></div>
<div class=row><span>Hotel</span><div class="bar b" style="width:36%"></div><span class=n>€318</span></div>
<div class=row><span>Food</span><div class="bar c" style="width:24%"></div><span class=n>€210</span></div>
<div class=row><span>Getting around</span><div class="bar d" style="width:6%"></div><span class=n>€48</span></div>
</body></html>`

export const REPLIES: Record<string, Reply> = {
  [ASK_TRIP]: {
    tools: [
      {
        name: "bash",
        args: {
          command:
            "printf 'option          nights  price  to river\\nMemmo Alfama    2       €318   4 min\\nLumiares        2       €366   9 min\\nAlecrim ao Chiado 2     €342   7 min\\n'",
        },
      },
      { name: "write", args: { path: "library/Trips/Lisbon weekend.md", content: ITINERARY } },
      { name: "visual", args: { title: "Where the budget goes", html: CHART } },
    ],
    text: [
      "Here is a plan that comes in at **€852** for the two of you. It is in your library as *Lisbon weekend*.",
      "",
      "| Hotel | 2 nights | Walk to the river |",
      "| --- | ---: | ---: |",
      "| **Memmo Alfama** | €318 | 4 min |",
      "| Alecrim ao Chiado | €342 | 7 min |",
      "| Lumiares | €366 | 9 min |",
      "",
      "- **Flights:** TAP 1353 on Friday morning, €412 each, back on Sunday afternoon.",
      "- **Saturday:** tram 28 up to Estrela, then down through Bairro Alto to LX Factory.",
      "",
      "Memmo Alfama has a roof terrace over the river and is the cheapest of the three. Shall I hold it?",
    ].join("\n"),
    files: ["library/Trips/Lisbon weekend.md"],
  },
  [ASK_BOOK]: {
    tools: [
      {
        name: "schedule",
        args: {
          action: "create",
          schedule: "every 6h",
          title: "Watch the TAP fare",
          prompt: "Check the TAP fare SFO to LIS for Oct 17–19 and tell me if it drops below €380.",
        },
      },
    ],
    text: "Held until Friday at noon, free to cancel. I'll check the TAP fare every six hours and tell you if it drops below **€380**.",
  },
  [ASK_DINNER]: {
    tools: [
      {
        name: "subagent",
        args: {
          action: "start",
          title: "Saturday dinner",
          task: '/tool bash {"command":"sleep 1800"}',
        },
      },
    ],
    text: "On it. A helper is looking at places along the river while we talk; I'll come back with three to choose from.",
  },
}

/** The other Doods in the sidebar, by name. */
export const OTHER_DOODS = ["Pico", "Maple", "Otto"]
