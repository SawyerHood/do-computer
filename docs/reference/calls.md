# Calling a Dood

A Dood can be called: press **Call** under its name in its panel, or the phone in the strip above
the chat, and talk. It answers out loud, in a voice of its own, and goes on working while you
talk. It works in a browser on a computer, in the desktop app, and in the phone app: see
[on the phone](#on-the-phone).

It is new, and closed to everyone but a deployment's admins unless the deployment says
otherwise: see [who can call](#who-can-call-and-what-it-costs).

## How a call works

Two models share a call. A small, fast one does the talking: it hears you, answers within a
moment, and can be talked over. It is not the Dood. The Dood is whatever model you chose for it,
with its tools, its computers and its memory, and it is not replaced.

1. When the call starts, the voice is told who the Dood is (its name, its personality, what it
   knows about you, its notes) and is given the end of the chat the call is held in: about the
   last forty messages, without the steps the Dood took.
2. What the voice can answer from that, it answers.
3. Anything else, it **hands on**: a file, the web, a computer, a fact it was not given, or
   something to remember, save, schedule or send. The voice can only talk. The Dood does it, with
   every tool it has, and asking first where it is set to.
4. While the Dood works, the voice is told which step it is on. When the Dood has answered, the
   voice says the answer in its own words, and shortens a long one.

## Where the call's work is done

A call is held in the Dood's main chat. What is handed on goes there, as a message from you
marked "Said on a call", with what was said on the call beside it for the Dood to read.

- **What the Dood sends is what its voice says.** In the main chat a Dood speaks only with what
  it sends; on a call, its first send after what was handed on is said as soon as it is whole,
  and everything it sent once it is at rest.
- **Longer work goes to a sub-agent.** The Dood is told to hand anything more than a quick look
  (browsing, several steps, anything long) to a sub-agent and to send that it is on it, so the
  voice is not kept waiting and the main chat is not filled with the work. The sub-agent's
  report reaches the main chat as an event; what the Dood sends about it then is in the chat.

Work that is not finished when you hang up carries on in its sub-agent, and the Dood sends what
came of it in the main chat.

## What the chat keeps, and what is remembered

While a call is on, the chat it is held in shows it as one card: what is being said, and what
the Dood is doing about what was handed on. When it ends, the chat keeps one record of it: how
long it was, what came of it in up to three lines, and what was said, folded away. The lines
are written by the small model that also notes where each chat stands (`DC_REVIEW_MODEL`);
without one the record has only the words.

What was said out loud counts as said:

- **The Dood in the main chat is told the call is over**, as an event, with whatever was said on
  it that it had not been shown, so it remembers a call like anything else in the chat.
- **The Dood's other chats** find the call's words with the `history` tool, and the chat's
  note for them takes the call in: the same small model reads the call when it ends.
- **Lasting things are remembered.** That small model adds what will still matter months from
  now to what the Dood remembers about you and its own notes, as it does for what is typed: up
  to three things of each kind from one call. And asking out loud for something to be
  remembered is handed on like anything else, so the Dood saves it itself.

Without the small model none of the last two happens by itself; what is handed on still does.

A call belongs to the window, not to the page. Open another Dood or the settings and it carries
on as a card in the corner. Closing or reloading the page ends it.

## On the phone

In the phone app the phone in a chat's bar calls the Dood, wherever the web app would offer a
call. The call fills the screen: the Dood's creature, what is being said, what was handed on
and what the Dood is doing about it, and Mute, End and Chat. Swipe it down, or press Chat, and
the call goes on: a bar over every chat leads back to it. The screen is kept on while a call
is, because a phone that locks stops the call's sound. The record lands in the chat as it does
from a browser.

The sound is carried by the phone's own web view, which has WebRTC, so the app needs no new
parts built into it for calls. It goes straight from the phone to OpenAI and back, as it does
from a browser.

## Who can call, and what it costs

A call is placed with a sign-in under **Models**, and the nearest one is used: the workspace's
own, and then the deployment's (Global models). Of the two kinds that can place a call, the
first is tried first:

| Sign-in                         | What a call costs                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| **OpenAI Codex** (with ChatGPT) | Nothing beyond the ChatGPT plan. It counts against the plan in a way OpenAI does not state. |
| **OpenAI**, with an API key     | $0.05 a minute, to the key's account.                                                       |

Signing in to **OpenAI** with ChatGPT, the newer way, does not count: that sign-in runs models
and cannot place a call. With no sign-in that can, there is no Call button.

Either way, the work a Dood is handed costs what it would have cost typed.

`DC_CALLS` says who can call, for the whole deployment:

| Value              | Who can call                                 |
| ------------------ | -------------------------------------------- |
| unset, or `admins` | Only the people `DC_ADMIN_EMAILS` names.     |
| `on`               | Everyone.                                    |
| `off`              | Nobody. There is no button, and no settings. |

Two limits:

- `DC_CALL_MINUTES` is the longest a call can last, in minutes. Thirty where it is not set. A
  call also ends after two minutes in which nobody says anything.
- `DC_CALL_MONTHLY_MINUTES` is how many minutes a calendar month each person can be on calls
  that **the deployment's** sign-in pays for. Sixty where it is not set; `0` is no limit. Calls
  paid for by a workspace's own sign-in are not counted.

The server tells the browser how long a call may last and the browser hangs up. The server's
own count stops at that length whatever the browser does, but it does not cut the sound off
itself, so the limits are for people who are trusted not to change the page.

## Its voice

A Dood has a voice of its own, picked by which Dood it is so that two seldom sound alike. It can
be changed under **Voice** in the Dood's settings, beside its look. The two kinds of sign-in
have different voices, so a Dood that moves from one to the other gets a new one.

## What leaves the server

- **The sound goes straight from your browser to OpenAI and back**, whichever model the Dood
  thinks with. It does not pass through the Do Computer server, and neither the server nor
  OpenAI is asked to keep a recording.
- **OpenAI is sent** who the Dood is and the end of the chat, as above, to start the call.
- **The server keeps** the words, as text, in the chat.
- **The sign-in stays on the server.** The browser is handed the answer to its call and nothing
  that could place another.

## The ChatGPT route

A call on a ChatGPT plan goes the way OpenAI's own open-source Codex client makes its voice
calls, with the app saying plainly who it is. OpenAI documents that route for nobody else. It
has stopped working for everyone before, Codex's own client included, and it may again without
notice. When it does, a call says that it could not be started, and an OpenAI API key is the
documented way to have calls.

## What is not there yet

A Dood calling you. A call on the phone going on with the phone locked or the app in the
background. Approving something by voice: a request for an OK shows above the message box as
always, and is answered there. What you type during a call goes to the Dood, and its voice is
not told of it; nor is the voice told how work is going in the main chat that it did not hand
on. Safari, phone browsers and a call from the phone app on a real phone have not been tried.
