// A chat with something of everything the transcript draws, for pictures of it in both apps
// (tools/chat-shots.mjs for this one, tools/chat-react-shots.mjs for the React app). The echo
// model answers each message as REPLIES writes it out (DC_ECHO_REPLIES), or as `/tool` and
// `/fail` ask. A shot is taken after the message it is named with, at the transcript's end.
export const REPLIES = {
  "Plan a weekend in Lisbon": {
    "text": "Here is a plan for **two days** in Lisbon:\n\n1. Saturday: Alfama and the castle, dinner in Bairro Alto.\n2. Sunday: Belém, pastéis de nata, a sunset at Miradouro da Graça.\n\nThe whole trip comes to about **€820** for two."
  },
  "Send me the notes": {
    "tools": [
      {
        "name": "bash",
        "args": {
          "command": "printf '# Lisbon\\n\\nSaturday: Alfama.\\n' > lisbon-notes.md"
        }
      }
    ],
    "text": "Here are the notes.",
    "files": [
      "lisbon-notes.md"
    ]
  },
  "Draw the budget": {
    "tools": [
      {
        "name": "visual",
        "args": {
          "title": "Budget",
          "html": "<!doctype html><html><head><title>Budget</title><style>.bar{height:24px;background:var(--chart-1);border-radius:6px;margin:6px 0}h2{margin:0 0 8px;font-size:15px}</style></head><body><h2>Budget for two</h2><div class=bar style='width:60%'></div><div class=bar style='width:30%'></div><div class=bar style='width:10%'></div></body></html>"
        }
      }
    ],
    "text": "The budget, drawn."
  },
  "Get help": {
    "tools": [
      {
        "name": "subagent",
        "args": {
          "action": "start",
          "title": "Flights",
          "task": "Find flights to Lisbon"
        }
      }
    ],
    "text": "A helper is looking for flights."
  },
  "Need a key": {
    "tools": [
      {
        "name": "request_secret",
        "args": {
          "secrets": [
            {
              "name": "WEATHER_KEY",
              "description": "From the weather service"
            }
          ],
          "purpose": "To check the forecast"
        }
      }
    ],
    "text": "I asked for the key."
  },
  "Move to Lisbon time": {
    "tools": [
      {
        "name": "settings",
        "args": {
          "action": "set",
          "timezone": "Europe/Lisbon"
        }
      }
    ],
    "text": "Done."
  },
  "Show me the code": {
    "text": "Here is the script, and what it costs:\n\n```ts\nconst nights = 2\nconst perNight = 180\nexport const total = nights * perNight + 460 // flights\n```\n\n| Item | Cost |\n| --- | ---: |\n| Hotel, 2 nights | €360 |\n| Flights | €460 |\n| **Total** | **€820** |"
  },
  "Send the picture": {
    "tools": [
      {
        "name": "bash",
        "args": {
          "command": "echo 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 | base64 -d > sunset.png"
        }
      }
    ],
    "text": "Here is the view from the hotel.",
    "files": [
      "sunset.png"
    ]
  }
}

export const STEPS = [
  { say: "Plan a weekend in Lisbon" },
  { say: "Send me the notes" },
  { say: "Draw the budget" },
  { say: "Get help", wait: 5000, shot: "subagent" },
  { say: "Need a key" },
  { say: "Move to Lisbon time", shot: "asks" },
  { say: "/fail 401 invalid api key", shot: "error" },
  { say: "Show me the code", shot: "code" },
  { say: "Send the picture", wait: 4500, shot: "picture" },
]
