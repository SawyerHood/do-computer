# Saved passwords and cards

A workspace can keep logins for its Doods to sign in to websites with: a name, a username, a
password, and the sites it is for. A Dood uses one without ever being shown the password.

It is new, and closed to everyone but a deployment's admins unless the deployment says
otherwise: see [who has it](#who-has-it).

## How a Dood signs in

1. The Dood opens the site's sign-in page in a browser on somebody's own computer, with its
   `browser` tool.
2. It calls `sign_in`. Where one login is saved for that site, that is the one; where there are
   several, it names one.
3. Unless that Dood has been told it need not ask, a request appears above the message box:
   "Sign in to github.com as sawyer@example.com". The site in it is read from the browser, not
   taken from what the Dood said. A yes is for that login on that site, once, and where the
   page has changed by the time it comes to typing, nothing is typed.
4. The password goes from where it is kept to the computer, and the program that connects the
   computer types it into the page itself. The Dood is told how it went.

Where no login is saved for the site, the same tool asks the person for one: a form appears
above the message box, with the site filled in. What is typed there is saved for the workspace
and never passes through the chat. Whoever typed it is not then asked a second time whether it
may be used there.

A login can also be added, given a new password, changed or removed under **Passwords** in a
workspace's settings, in the web app or in the phone app. Nothing shows a saved password again,
to a person or to a Dood.

## What it protects

- **The password is in nothing a Dood is sent, says or keeps.** Not in the chat, the search,
  what the Dood remembers, a notification, or the logs of the server or the computer. What is
  written down is the login's name, the site, and which Dood used it and when.
- **It is typed only on the sites the login is for**: those and their subdomains, reached by
  https. On any other page nothing is typed and the Dood is told why, which is what stops a
  page that only looks like the site.
- **It is typed only into a password box**, and where the page still asks afterwards, what was
  typed is taken out of the page again.
- **Nothing a Dood wrote runs while it is typed.** A script a Dood ran earlier in the browser
  can leave things behind that read what is typed later. So before typing, the program that
  drives the browser for Doods is stopped, which ends whatever a script left in it, and the page
  is loaded afresh. A page that another window of the same site opened, or that has opened one,
  is not typed into at all, since that window could read it.
- **It is sealed before it is kept**, with a key made for the workspace from a secret of the
  deployment's (`DC_SECRETS_KEY`, or `DC_AUTH_SECRET`). A copy of the database alone does not
  give it up.

## What it does not protect

- **Hiding a password does not limit what a signed-in Dood does.** Once in, it can do whatever
  the account allows. Asking first and the list of sites are the limits; hiding the password
  keeps it from being recorded or used anywhere else.
- **A Dood that can run commands on the same computer as the browser is not walled off from
  it.** A command runs as the same person and can reach the browser directly. On a computer
  where that matters, set commands to Ask first or Never for that Dood under Permissions.
- **Whoever runs the server can open what it keeps.** Sealing keeps a password from someone who
  comes by the database, not from someone who has the key as well. On a server of your own that
  is you.
- **The site gets the real password**, as it must.
- **A site can be named too widely.** A login saved for `example.co.uk` is typed on that and its
  subdomains. One saved for `co.uk` would be typed on every site under it: name the site itself.
- **A code or a puzzle after the password is the person's to do**, in the browser's window.
  One-time codes are not kept yet.

## Paying with a saved card

A workspace can also keep cards, where the deployment names them (`DC_SECRET_KINDS`). A Dood
pays with one without being shown its number.

1. The Dood gets the page ready with its `browser` tool: everything chosen, the total showing,
   the card's boxes on the page.
2. It calls `pay` with the words on the button that pays, what it says the payment is for, and
   whatever else the page needs filled in beside the card, such as an e-mail address.
3. A request appears above the message box, every time: the site as the browser has it, the
   card, the button that will be pressed, and the Dood's own words for what is being bought.
   Whoever says yes types the card's security code there.
4. The computer's own program loads the page afresh, fills in the other boxes and the card,
   presses the button, and takes the card out of the page again if the page is still there.

What is different from a login, and why:

- **The security code is never kept.** It is typed with each yes, held in memory for that one
  payment, and written nowhere. A copy of everything the server keeps is a card with no code.
- **A card has no site of its own.** A login is typed only on its sites; a card is meant for
  shops nobody listed. So a person is the check, every time: there is no "Always allow", and a
  scheduled run, a sub-agent and Slack cannot pay at all. Read the site in the request.
- **What it is for is the Dood's word.** The request says so. Nothing checks it against the page.
- **The card is typed and the button pressed in one step.** A card's boxes are ordinary boxes,
  and a number left sitting in one could be read by the Dood's next look at the page.
- **The boxes are usually inside the payment company's own frame** (Stripe and the like). The
  computer types into those too. This was tried against Stripe's test pages and against pages
  of our own; other payment companies' pages were not tried.
- **A page that forgets where it was when loaded afresh cannot be paid on**, since nothing a
  Dood did to the page before may still be running when the card is typed.
- **A bank's own check after the button** (a code, an approval in its app) is the person's to
  do, in the browser's window.

A card made for the purpose with a spending limit is the safer one to save. While saved cards
are for a deployment's admins alone, a card kept is its admin's own. Before cards are opened to
anyone else on a deployment that other people use, whoever runs it should either keep cards on
each person's own computer or learn what the card industry's rules (PCI DSS) ask of it: this
was built without an answer to that.

## Who has it

`DC_SECRETS` says, for the whole deployment:

| Value              | Who has saved passwords                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| unset, or `admins` | Only the people `DC_ADMIN_EMAILS` names, and only in a workspace where everyone is one of them: their own, usually. |
| `on`               | Everyone.                                                                                                           |
| `off`              | Nobody. There is no page, no form, and no `sign_in` tool, and a Dood is told nothing of it.                         |

`DC_SECRET_KINDS` says which kinds are kept: `passwords`, which is all an unset one means, or
`passwords,cards`. Cards are had by the same workspaces as passwords, once they are named.

- Admins only is what an unset variable means, so that a deployment is closed to everyone else
  without anything having to be set, and stays closed if a setting is lost.
- An admin here is an account whose address `DC_ADMIN_EMAILS` names and which is known to be
  that person's: where anyone can sign up, only an address that a sign-in with Google or GitHub
  vouched for counts.
- A team with anyone else in it has no saved passwords, since that person's conversations with
  its Doods could otherwise use what an admin saved. What the team saved before is kept,
  sealed and out of reach, and is there again if the team is admins alone once more.
- Whether a Dood asks before it uses one is that Dood's own setting, **Sign in with saved
  passwords** under its Permissions. It asks unless told otherwise.
- A saved login cannot be used from Slack, where anyone in the Slack workspace can speak to the
  Dood. A scheduled run can use one only where the Dood has been told it need not ask.

## What a computer needs

The typing is done by the program that connects a computer (the desktop app, or the daemon),
so it has to be new enough to know how. One from before this is not sent a password at all:
the Dood is told the program is too old, and one that updates itself is asked to.
