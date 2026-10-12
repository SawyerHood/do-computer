# Doods and the waiting list

A **Dood** is a creature anyone can hatch with no account, at `/hatch`: an egg comes down, they
name it and choose its color, hatch another if they would rather, and keep one of the three
things in its present. It then has a page of its own, `/dood/<id>`, where anyone can stroke it
and give it a treat, one a day each. Both pages say in their heads that they are X's player
card, so a post on X that links to one plays it inside the post, 480 pixels square, where X
does that; elsewhere the link shows as a picture that opens the page. The pictures are in
`apps/web/public/dood` (made by `prototypes/dood-embed/posters.mjs`): one of an egg, and one
Dood of each color, since a Dood's own look cannot be drawn by the server.

Whoever hatched one can **claim** it by signing in, from the browser they hatched it in. It
becomes their first agent, named and looking as it did and wearing what it kept. From then on
the treats people give it on its page are eaten by the agent's creature, and every four of
them are a present for it, besides the one that turns up every twelve hours.

With `DC_SIGNUP=waitlist` anyone can make an account, in the first run or by claiming a Dood,
and has their Dood and nothing else: every other call answers 403 until they are let in. The
app is for whoever was there before the list, the first account, the addresses
`DC_ALLOWED_EMAILS` and `DC_ADMIN_EMAILS` name (once known to be theirs: sign in with Google
or GitHub), and anyone invited to a team. Someone `DC_ADMIN_EMAILS` names lets the rest in one
at a time under **Settings → Waiting list**; with `RESEND_API_KEY` set they are sent
an email. `DC_SIGNUP=open` lets everyone in at once. A Dood that waited becomes its owner's
agent the first time they come back, with the treats it was given meanwhile.

A name is shown to anyone under the deployment's own address. It is kept to 20 letters,
digits and a little punctuation, and nothing that reads as a web address; there is no list of
words it refuses. `DELETE /api/doods/<id>`, as someone `DC_ADMIN_EMAILS` names, takes one down.
