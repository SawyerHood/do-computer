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
          "command": "echo iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAIAAACO1KzYAAAC10lEQVR42u3R04EdAAAAwSsstp3cs23b1tm2bZux3UzayMdOC1N1oXJ+sXJ+qXJ2uXx2pXx6tXx6rXRyvXRyo3R8s3h8q3h0u3h0p3B4t3B4r3BwP3/wIL//ML//KLf3OLf3JLf7NLv7LLvzPLvzIrP9MrP9KrNVnd4SpDeF6U1RakOc2pCk1qXJdVlyTZ5cUyRWlYlVVWJFHV/RxJe18WVdbEkfWzLEFo3RRVN0wRxdsETmrZF5W2TOHp5zhGed4VlXaMYdmvGEpr3BaV9wyh+cCgQmg4HJUGAi7J+I+Mej/vGYbyzuG0v4RpPe0ZR3JO0dyXiGs57hnGco7x4quAeL7sGSa6DsGqi4+muc/bXOvjpnX72jt8HR2+joabL3NNu7W+zdrbauNltXu62zw9rZae3osnZ0W9p7LO29lrY+c1u/uXXA3DpoahkytQybmkeMzaPGpjFj07ihccLQOGlomNI3TOvrZ/T1s7q6OV3dvK52QVu7qK1Z0tYsayormsqqprymLq+rSxvq0qaquKUqbqsKO8rCrjK/p8zvK3IHityhInskzx7LMyfyzKksfSZLn8tSr6WpN9LkW2nynSTxXpL4IIl/FMc/iWOfxbEvouhXUfSbKPJdGPkhDP8Uhn8JQr8FoT+C4N/qYBXBBBNMMMEEE0wwwQQTTDDBBBNMMMEEE0wwwQQTTDDBBBNMMMEEE0wwwQQTTDDBBBNMMMEEE0wwwQQTTDDBBBNMMMEEE0wwwQQTTDDBBBNMMMEEE0wwwQQTTDDBBBNMMMEEE0wwwQQTTDDBBBNMMMEEE0wwwQQTTDDBBBNMMMEEE0wwwQQTTDDBBBNMMMEEE0wwwQQTTDDBBBNMMMEEE0wwwQQTTDDBBBNMMMEEE0wwwQQTTDDBBBNMMMEEE0wwwQQTTDDBBBNMMMEEE0wwwQQTTDDBBBNMMMEEE0wwwQQTTDDBBBNM8P8X/A9p6w5gbFp4lAAAAABJRU5ErkJggg== | base64 -d > sunset.png"
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
  { say: "Show me the code", shot: "code" },
  { say: "Send the picture", wait: 9000, shot: "picture" },
  { say: "Need a key" },
  { say: "Move to Lisbon time", shot: "asks" },
  { say: "/fail 401 invalid api key", shot: "error" },
]
