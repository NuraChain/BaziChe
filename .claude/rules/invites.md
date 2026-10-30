# Inviting friends

A person shares a link, somebody joins through it, and once that friend has played a game the invite
counts. The design, with every decision and what was not chosen, is
`docs/superpowers/specs/2026-10-30-referrals-design.md`.

## A code of one's own

**A code is eight letters of an alphabet of thirty-one** (`CODE_ALPHABET` in
`domains/invite/policy.ts`: no 0, O, 1, I or L, which a person reading a code aloud mistakes for each
other). `policy.ts` imports nothing, so the browser reads it too, and `invite-policy.spec.ts` holds the
alphabet to `invite_codes_shape`. The code is not the handle: a handle can be renamed, which would
break every link shared, and a code can be retired with nobody renaming. There are no vanity codes.

**One live code a person, made the first time it is asked for** (`GET /api/invites/code`, `{ code,
link, since, next? }`). `invite_codes_live` is a partial unique index on the person where the code is
not retired, and the code itself is the primary key, so `makeCode` in `domains/invite/service.ts`
inserts a fresh draw and lets the two indexes decide, ignoring a clash, and reads the live code back:
a code somebody holds is drawn again, and a code another ask of theirs made meanwhile is theirs. An
insert that ignores rather than fails is what lets the same function run inside a transaction.
`randomInt` draws each letter, so no letter is likelier than another. The link is the server's
(`${ PUBLIC_ORIGIN }/join/<code>`, development's own origin in development), so the browser never
composes it.

**A new code retires the old one, at most once a day** (`POST /api/invites/code`). Links already
shared stop bringing anybody in. Under the person's row lock, so two asks at once are one after the
other: a code retired in the last day refuses the next as `invite-code-soon` (409) with `{ at }`, a
day after that retirement, and `next` on the code says the same while it is still ahead. A person who
has never had a code is simply made one. The old code ends `greatest(now(), created_at)`, the
notice's rule: a code another ask of theirs made after this transaction began must not end before it
began, which `invite_codes_retired_after` would refuse.

## The way in

**`GET /api/public/invites/:code` is who a link invites to**, with no session: the inviter's handle,
name, hue, picture and frame, where their public profile would show them (`card` in `services.ts`),
and nothing for a minor, whose link still works. A code that is retired, one nobody holds, one that is
no code and a suspended account's are one answer, the bytes of a link that no longer works
(`invite-missing`, 404, "That invite link no longer works."). A code is read in capitals with its
spaces trimmed (`codeFrom`), so a link a phone lower-cased still works.

**`POST /api/public/invites/:code/visit`, `{ visitor }`, says a device opened the link.** The visitor
is a token the device made up and keeps, twenty-two letters of base64url (`VISITOR_SHAPE`, held to
`invite_visits_visitor_shape`), and nothing else about the device is kept: no address, no agent.
`invite_visits` is unique on the code, the visitor and the day (by Postgres's clock, in UTC), so a
refresh is the same visit and the next day another. The code's own owner opening their link is no
visit; the route asks the session it may carry (`identity.principal`) for that alone, and a signed-in
stranger counts as anybody. Nothing anybody is ranked by is counted from visits.

**The two have a budget of their own**, a tenth of `API_RATE_MAX` and never under twenty
(`publicInviteRateLimit` in `http/rate-limit.ts`, beside the sign-in budget in `main.ts`): 60 a minute
at 600, which is thirty pages opened from one address. Guessing at codes and writing visits under
made-up tokens go no faster than that. `rate-limit.spec.ts` holds the share, the two routes, a refusal
however the path is spelled, and the line of `main.ts` that puts it on.

**A wallet's first sign-in carries the code** (`invite` on `POST /api/auth/wallet`, which replaced a
handle under `ref`; any text up to 32 characters, so a kept value that is no code never fails a
sign-in). `refer` in the invite service credits the account that sign-in created, and only that one,
to the code's owner when the code is live and its owner not suspended, with the code it came by and
the campaign running as the account was made (`state = 'active'` and inside its window, by Postgres's
clock). It inserts or ignores: `referrals` is keyed by the invitee, so an account is credited once and
never moved. Anything else is let go of without a word, through `courtesy('referral')`, because a
sign-in never fails for an invite. There is no check that the code is the new account's own: a code
is made only for somebody who asked for it, and nobody has been signed in as this account yet;
`referrals_not_self` is the belt.

## The way in, in the browser

**`/join/:code` is a page for anybody** (`pages/join.page.azeroth`, lazy, rendered in the browser,
no guard), drawn as the public profile is: the site's header and footer, the inviter's picture in its
frame, "Sara Kamali invited you to Baziche" and their handle, one line on what Baziche is, and
Connect wallet, which opens the landing's own chooser and goes to the app once a wallet has signed
in. A link whose owner shows no face says "A friend invited you". A link that no longer works says
so and offers the way in all the same; an address that holds no code asks the server nothing.
Somebody already signed in is told they have an account, with the way into it, because nothing
credits an account that already exists. A read that fails is a failure with Try again, never a link
that no longer works. The words are a catalogue of their own (`locales/<code>/invite.ts`, ten
languages, registered for English and Persian by `locales/invite-catalogue.ts`).

**The device keeps the code, first link first** (`lib/invite.ts`): `{ code, at }` under
`nura.invite` in `localStorage`, read back for thirty days (`KEPT_MS`) by the product clock and as
nothing after them, and anything kept there that is not a code read as nothing. A second link within
the window does not replace the first, so whoever brought somebody here first brought them, unless
the first link no longer works: the page asks about the kept code, and only a 404 gives it up. The
same link opened again starts its window again. Somebody signed in keeps nothing. A device that keeps
nothing (a private window, a full disk) is no harm: nothing is kept and nothing throws.

**A visit is told once the link has answered** (`visitorToken`): twenty-two letters of base64url
made once and kept under `nura.visitor`, the one thing this device says about itself, and a fresh
one each time where nothing can be kept. A refused visit says nothing.

**A wallet's sign-in carries the kept code and lets it go once it has signed in** (`connect` in
`stores/wallet.store.ts`), from whichever page signed in: the landing's chooser, `/sign-in` or the
join page. A wallet that said no, and a sign-in the server refused, keep it for the next try.

`invite-link.spec.ts` holds the keeping and the token, `join-page.spec.ts` the page in each state,
in Persian, and its place in the route table, and `wallet.spec.ts` (*a wallet that signs in after
an invite link*) the sign-in. The specs keep what they store in `tests/memory-storage.ts`, because
the storage this environment gives them keeps nothing.

## A friend who played

**An invite counts when the friend finishes a game their inviter did not play in** (`countedBy` in the
invite service, one UPDATE after every finish, `countInvites` in `services.ts`): a seat with a result
that is not `void`, in a finished game, and no seat of that game the inviter's. Otherwise anybody could
count a second wallet of their own by playing it once. A game with the inviter changes nothing, and
the friend's next game without them counts. The `invited` ladder, the shop's inviter share
(`referrerOf`) and the notice all follow `counted_at`, so all three gained the condition with it.

`invite.db.spec.ts` holds all of it against Postgres: a code made once for asks that cross, renewed once
a day and once for two asks at once, the page for a face, a minor and every link that no longer works,
visits, the crediting (in any case, with and without a campaign running) and every code it lets go of,
and the counting with the inviter in the game, a game still played, a void game and three friends at
once. `app.spec.ts` (*inviting friends*) holds the routes, what the page sends and the garbage pass's
bodies.
