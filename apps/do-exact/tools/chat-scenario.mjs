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
]
