# Calling a Dood

A Dood can be called: press **Call** under its name in its panel, or the phone in the strip above
the chat, and talk. It answers out loud, in a voice of its own, and goes on working while you
talk. It works in a browser on a computer and in the desktop app. The phone app shows a call that
was held but cannot start one yet.

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
3. Anything else, such as a file, the web, a computer or a fact it was not given, it **hands
   on**. That arrives in the chat as a message from you, marked "Said on a call", with what was
   said on the call beside it for the Dood to read. The Dood answers it as it would a typed
   message, using whatever it needs, and asking first where it is set to.
4. While the Dood works, the voice is told which step it is on. When the Dood has answered, the
   voice says the answer.

The Dood's answer is in the chat in full. The voice says it in its own words, and shortens a
long one.

## What the chat keeps

While a call is on, the chat it is held in shows it as one card: what is being said, and what
was handed on. When it ends, the chat keeps one record of it: how long it was, what came of it
in up to three lines, and what was said, folded away. The lines are written by the small model
that also notes where each chat stands (`DC_REVIEW_MODEL`); without one the record has only the
words. The Dood is told what was said too, so it remembers a call like anything else in the
chat.

A call belongs to the window, not to the page. Open another Dood or the settings and it carries
on as a card in the corner. Closing or reloading the page ends it.

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

Calling from the phone app. A Dood calling you. Approving something by voice: a request for an
OK shows above the message box as always, and is answered there. What you type during a call
goes to the Dood, and its voice is not told of it. Safari and phone browsers have not been tried.
