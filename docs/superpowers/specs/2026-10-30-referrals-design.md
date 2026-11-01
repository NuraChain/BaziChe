# Inviting friends: a code, the way in, and rewards from the shop

## Context

The owner, 2026-10-30, while the voice messages were being finished, pasted a brief for "a premium,
production-ready Referral and Invite Friends system": a referral identity for every account, a way
in that keeps who invited whom, a page to share from and follow what came of it, rewards with a
lifecycle that never pays twice, campaigns the staff run, a leaderboard, notifications, protection
against farming, an admin section, and the whole of it tested. Beside it, in their own words:
"Reward also can be from shop".

The brief asks for the product's real rules to be found before anything is invented. This document
is that reading and the design built on it.

## What exists

Half of a referral system is already here, and nothing in the browser reaches it.

- **Who invited whom.** `referrals` (`backend/src/entities/referral.entity.ts`): the invitee is the
  primary key, so an account is attributed once; the inviter beside it (`SET NULL` when they go);
  `referrals_not_self`; and `counted_at`, "when the invitee finished a first game: only then does the
  invite count".
- **Attribution at account creation only.** `refer(inviteeId, ref)` in
  `backend/src/domains/invite/service.ts` takes a HANDLE (a leading @ dropped), refuses nobody, a
  suspended account and the invitee itself, and inserts or ignores. `signInWithWallet` in
  `backend/src/services.ts` calls it through `courtesy('referral')` only when the sign-in created the
  account, so an existing account is never attributed. The wire takes it as `ref`, at most 40
  characters (`backend/src/schemas.ts`, the wallet sign-in input).
- **Counting.** After every finish, `countInvites` in `services.ts` asks `invites.countedBy(match)`,
  which sets `counted_at` for every seat that played the game out (a `void` seat not) and has an
  inviter; each inviter's achievements are recorded again and they are told `invite-joined`.
- **What a counted invite already earns.** The `invited` ladder of achievements
  (`backend/src/domains/achieve/families.ts`, 1 to 250 people brought in), and NURA: the shop's
  contract credits whoever brought a buyer in with its share of what that buyer spends
  (`referrerOf` in `backend/src/domains/shop/orders.ts`: a counted invite, an inviter not suspended,
  a wallet other than the buyer's), claimed from the collection page ("From people you invited").
- **The gap.** The browser never sends `ref`: `stores/wallet.store.ts` signs in with the address,
  the nonce, the signature, the wallet's name and the device, and nothing else. No page offers a
  link to invite anybody, so the notice `notify.inviteJoined` ("{who} joined through your link and
  played a first game") speaks of a link nobody can be given.
- **Accounts are wallet accounts.** There is no guest any more, no email and no phone: an account
  exists because a wallet signed the server's challenge, and nothing further can be "verified".
- **What else is built on.** A QR encoder (`frontend/src/lib/qr.ts`, `qrcode-generator`, used by
  the wallet chooser); the public profile a signed-out visitor is sent to (`/people/:handle`, with
  Connect wallet in place of actions); notifications with categories a person mutes
  (`backend/src/domains/notify/notices.ts`), where `invite-joined` sits under `requests`, the friend
  requests, which it is not; the shop's looks, owned by `owned_items` with `via` purchase, gift or
  grant; the admin's sections by ability, its log of `staff_actions` and its pattern for something
  waiting on a decision (a report's close, a refund asked); the sign-in budget and the api's
  ceiling (`backend/src/http/rate-limit.ts`). No IP is stored anywhere, by rule.

## The design

### 1. A code of one's own

Every account that is not suspended has one live invite code: eight characters from an alphabet of
31 with no look-alikes (no 0, O, 1, I or L), made the first time it is asked for. Thirty-one to the
eighth is about 8.5 × 10^11, so guessing one under the api's ceiling is hopeless, and a guessed code
could only credit a stranger with a new account, never move an attribution. The code is not the
handle: a handle can be renamed, which would break every link shared, and a code can be retired
without anybody renaming.

- `invite_codes (code, user_id, created_at, retired_at)`, the code its primary key, one live code
  an account (a partial unique index on `user_id` where `retired_at is null`).
- The link is `${ PUBLIC_ORIGIN }/join/<code>`.
- A new code retires the old one: links already shared stop attributing, and their page says so.
  Asked as a question that loses something, and at most once a day.
- No custom codes: a vanity namespace is one more thing to police, and the page the link opens shows
  the inviter's own name and handle anyway.

### 2. The way in

- **`/join/:code`** is a public page (lazy, rendered in the browser, no session needed). It reads
  `GET /api/public/invites/:code`: the inviter's public face (name, handle, picture), answered only
  where `/people/:handle` would answer it, so a minor's or a suspended account's code shows no face;
  a retired code or one nobody holds is answered as a link that no longer works. Below it: what
  Baziche is in one line, Connect wallet, and for somebody already signed in, "You already have an
  account" with the way into the app. Nothing attributes an existing account, whatever it opens.
- **A visit is counted once a device a day, and nothing about the device is kept.** The page keeps a
  random visitor token on the device and sends it with `POST /api/public/invites/:code/visit`;
  `invite_visits (code, visitor, day)` is unique on the three, so a refresh is the same visit. No IP,
  no user agent, no fingerprint. The code's owner opening their own link is not a visit.
- **The device keeps the code until a wallet signs in, first touch.** `{ code, at }` is kept in
  `localStorage`; a second link does not replace a kept code younger than 30 days (the attribution
  window), so whoever brought a person here first is the one who brought them. A retired code is
  replaced.
- **Signing in sends it.** The wallet store sends `invite: <code>` with the sign-in from any page (the
  landing's chooser, `/sign-in`, `/join`), and lets the kept code go whatever the answer. The wire's
  `ref` becomes `invite`, a code of the alphabet's eight characters (nothing has shipped).
- **The server decides.** `refer` looks up the live code, refuses a suspended inviter and the account
  itself, and writes `referrals` with the code it came by, only for an account that sign-in just
  created. Opening a link on a phone and signing in on a computer loses it: no fingerprinting, by
  rule.

### 3. A friend who played

`counted_at` keeps its meaning, and the rule behind it gets one condition: **the first game that
counts is a finished game, not void, that the inviter did not play in.** Otherwise anybody could
count a second wallet of their own by playing it once. A later game without the inviter still counts.
The `invited` ladder, the shop's inviter share and the notice all follow the counted invite, so all
three gain the condition with it.

### 4. Rewards: looks from the shop, through campaigns

- **What can be given is a look.** The server holds no NURA and must not invent a payout; the shop's
  contract already pays inviters in NURA from what their invitees spend, and stays as it is; XP is
  not given, because a level says how much somebody has played. A look from the shop's catalogue is
  something the product can give today, owned for good like any other (`owned_items` gains `via =
  'reward'`, apart from a staff grant).
- **Nothing is given without a campaign**, and there is none until the staff make one. A campaign
  (`invite_campaigns`): a name, the look for the inviter, the look for the friend invited, milestones
  (a number of friends and a look each), the most rewards one inviter can earn in it, whether every
  reward waits for the staff (`review`), a start and an end, and a state (draft, active, paused,
  ended). At most one is active, so a referral belongs to exactly one: the campaign active when the
  friend's account was made (`referrals.campaign_id`).
- **A reward is a row, and a row is given once.** `invite_rewards (id, campaign_id, user_id,
  invitee_id, kind, milestone, item_id, state, …)`, unique on (campaign, invitee, kind) for the
  inviter's and the friend's and on (campaign, user, milestone) for a milestone. When an invite
  counts, its rewards are written in one transaction, each insert ignoring the one already there, and
  a reward that does not wait is given in the same transaction (the look inserted, ignored when owned
  already, which the row then says: nothing given). A second count, a retry or two finishes at once
  find the rows and give nothing more.
- **The lifecycle** is in review, given, refused and taken back. The brief's "approved" and
  "credited" are one step here, because giving a look is one insert in the decision's own
  transaction; "pending" is "in review". Taking back deletes the look if it came by reward (it comes
  off every slot it was worn in, by the foreign key).
- **It is a courtesy.** Writing rewards after a count runs through `courtesy()`: it can fail, and the
  game it followed stays finished.

### 5. Farming, and what is flagged

What the product structurally refuses: a second attribution (the primary key), attribution of an
existing account (creation only), a self-invite (the CHECK, and the code's owner), counting through
a game with the inviter (§3), a reward twice (the uniques), more than a campaign's limit for one
inviter, anything for a suspended account.

What is flagged for a person to look at, never acted on irreversibly: a friend whose first counted
game came within an hour of joining; a first counted game whose other players were invited by the
same inviter (a ring of fresh wallets); an inviter with more than ten friends counted in a day. A
flagged invite's rewards wait for the staff even in a campaign that gives at once. Nothing here
reads an IP, a fingerprint or a contact list.

The two public routes sit under the api's ceiling and a budget of their own like sign-in's, and a
visit counts nothing anybody is ranked by.

### 6. The page

`/app/invite` ("Invite friends", a lazy chunk), mobile first, every word in the ten languages:

- **The hero**: one headline, one sentence on what counts (a friend joins through your link and
  plays a first game), the link with Copy, Share (the Web Share API where there is one, else a sheet
  of WhatsApp, Telegram and email links whose words are the reader's language's template), the QR of
  the link, and while a campaign runs, what it gives.
- **What came of it**, only what is tracked: people who opened the link (a device a day), joined,
  played a first game, rewards given and in review.
- **The people invited**, newest first, twenty a page: the name and handle (public anyway), when they
  joined, the step they reached (joined, played, rewarded) and the reward's state. Nothing else of
  them: no online state, no last seen. An account no longer here is a row that says so and no more.
- **The code**, a new one behind its question.
- **Top inviters**, a tab: friends counted in the running campaign (or all time with none running),
  never a minor, never somebody who turned it off in Settings ("Show me among the top inviters").
- **Its doors**: Invite friends beside Add friend on the Friends page, a chip on `/app/me` beside the
  collection's, and where `notify.invite-*` notices lead.

### 7. Notifications

A category of its own, `inviting` ("Friends you invited"), and the existing kind moved into it from
the friend requests. Three kinds: `invite-joined` (a friend's account was made through your link),
`invite-played` (they played a first game: the invite counts) and `invite-reward` (a look was
given, held for review, refused or taken back). Each deduplicated by invitee or reward, rung on the
`me` scope, pushed like any notice.

### 8. The admin

A section `invites` for an admin and the owner, in the Platform group:

- **Overview**: the funnel (visits, joined, played, rewards given, in review, refused, taken back)
  over a day, a week and all time; the rewards in review count in "Needs you".
- **Campaigns**: made, changed, started, paused and ended with a reason, one at a time under a lock,
  each a row of the log (`invite-campaign`); a campaign that gave anything keeps its looks.
- **Review**: rewards waiting, newest first with the invite's flags; given or refused with a reason;
  a given one taken back with a reason (`invite-reward`), the rank rule of any action on a person.
- **A person's page** gains an Invites tab for roles that open People: who invited them and by which
  code, whom they invited, their rewards and flags.

### 9. Data

New: `invite_codes`, `invite_visits`, `invite_campaigns`, `invite_rewards`; `referrals` gains `code`
and `campaign_id`; `owned_items.via` gains `reward`; `notifications_kind_known` gains
`invite-played` and `invite-reward`, and `mutes_notice_known` the category `inviting`;
`staff_actions_kind_known` gains `invite-campaign` and `invite-reward`. Pages by the keyset (`lib/keyset.ts`), counts by aggregate queries, the snapshot
re-recorded as its own commit.

## Decisions

| | Decision | Default, and what was not taken |
|---|---|---|
| RF-D1 | Identity | A random code of eight characters a person, made when first asked for, one live at a time; not the handle (a rename would break shared links), no vanity codes |
| RF-D2 | The link | `/join/<code>`, a public page that shows the inviter where their public profile would be shown |
| RF-D3 | Attribution | First touch, kept on the device 30 days, only for an account the sign-in creates; never an existing account, never across devices |
| RF-D4 | A counted invite | A first finished, not void game the inviter did not play in; the ladder, the shop's share and the notice follow it |
| RF-D5 | Rewards | Looks from the shop only, through a campaign; no NURA invented, no XP |
| RF-D6 | Campaigns | One active at a time; a referral belongs to the campaign active when the account was made |
| RF-D7 | Exactly once | Unique rows a reward, inserts that ignore what is there, the look given in the decision's own transaction |
| RF-D8 | Lifecycle | In review, given, refused, taken back (approved and credited are one step) |
| RF-D9 | Flags | Played within an hour, a ring of the inviter's invitees, more than ten a day; flagged rewards wait for the staff; no IP, no fingerprint |
| RF-D10 | Visits | Counted a device a day by a random token kept on the device; nothing ranked by them |
| RF-D11 | What a referrer sees | The name and handle of whom they invited and how far each got; nothing else |
| RF-D12 | Leaderboard | Friends counted, the running campaign or all time; no minors; a switch in Settings to leave it |
| RF-D13 | Notices | A category `inviting`; joined, played, reward |
| RF-D14 | The admin | A section `invites` for an admin and the owner; campaigns and reviews in the log |
| RF-D15 | Sharing | Copy, the Web Share API, WhatsApp, Telegram, email; nothing asks for contacts |
| RF-D16 | A farm of fresh wallets (the owner, during RF3) | An invite counts only through a game with somebody established; RF-D20 is how it was built |
| RF-D17 | Many in a day | Past a daily number of counted invites an invite is held for the staff, never lost; RF-D21 |
| RF-D18 | What waits for the staff | A milestone's look and every reward of a flagged invite; RF-D22 |
| RF-D19 | A friend suspended, deleted or blocked | Left out of the counts and the list when suspended; a deleted account takes its referral with it; a block hides nothing, since a friend who vanished from the list would say they had blocked their inviter |
| RF-D20 | Established | An account a week old with five games played out with somebody established or on the staff (the owner by the wallets the server names, and every member of the staff, with no row); an invite counts only through another player in the game who played it out, is established or on the staff, is not suspended and was not brought in by the same inviter |
| RF-D21 | Many, as built | `many` when the inviter already had five invites counted in the last day (the design said ten) |
| RF-D22 | What waits, as built | Every milestone; every reward of a flagged invite; every reward of a campaign that reviews them all |
| RF-D23 | When a campaign gives | Only while the invite's own campaign runs at the moment the invite counts |
| RF-D24 | The reward notice | Said when a look is given; a reward held, refused or taken back tells nobody, since a hold said aloud tells a farmer which invite was flagged |
| RF-D25 | Joined and played | `invite-joined` when the account is made through the link, `invite-played` when the invite counts, each with a dedupe key of its own, both in `inviting` |
| RF-D26 | The most | Counted under the person's row lock; a refused reward does not count against it |
| RF-D27 | Who vouches, and quick | The player a game counts through must have played it out; `quick` is a first counted game within ten minutes of joining (the design's hour would flag nearly every real friend, who plays at once) |
| RF-D28 | A suspended account | Given nothing by a campaign, not even a row to review; the friend of a suspended inviter is given their look all the same |
| RF-D29 | Who runs it | Admin › Invites is an admin's and the owner's; a person's Invites tab is People's, so a moderator reads it and acts on nothing there |
| RF-D30 | A campaign's looks | Changed only while it has written no reward; its name, most, review and window at any time, each a row of the log |
| RF-D31 | Giving to a suspended account | Refused (`staff-reward-suspended`); refusing or taking back is allowed |
| RF-D32 | Taking back | Only a reward given, and the look goes only if it came by reward, off every slot it was worn in; nobody is told |
| RF-D33 | The overview's days | UTC days, because a visit is kept by its day |
| RF-D34 | A change against a count | A count rewarding holds its campaign's row shared and a change takes it for update, so what a campaign gives changes only before a count or after it |

## Phases

Each its own commit or commits: specs first, faults put in one at a time, the gates and eslint on the
commit's files, the build in budget, and a walk at 1280 in English and 390 in Persian.

- **RF0** `docs(spec)`: this design.
- **RF1** `feat(schema)`: the four tables, the columns, the kinds and the category, the snapshot.
- **RF2** codes and the way in on the server: the code read, made and retired; the public read and
  the visit with their budget; sign-in's `invite`; `refer` by code; the counted invite's condition.
- **RF3** the way in in the browser: `/join/:code`, the kept code, sign-in sending it.
- **RF4** the page: hero, sharing, QR, what came of it, the people invited, the doors, the words.
- **RF5** campaigns and rewards on the server: writing rewards at a count, giving, flags, the notices.
- **RF6** the admin's section: overview, campaigns, review, a person's tab, the log, the garbage pass.
- **RF7** top inviters and the Settings switch; the notices in the browser.
- **RF8** `test(qa)`: an invite pass on the built server in real browsers (a link shared, opened,
  joined through, a first game, a reward given, one held and decided, one taken back), the notes.
- **RF9** `docs(spec)`: as built.

## Verification

The brief's twenty-one checks, each where it is held: a code per account and its uniqueness (database
specs, the pass); a link that opens (browser specs, the pass); attribution, its surviving navigation
and sign-in, and the relationship written (database specs on `refer`, the pass across pages); an
existing account and a self-invite refused (database specs); the counted invite's rule (database
specs with the inviter in the game and without); a reward once, under duplicate and concurrent counts
(database specs racing two finishes at a gate, as the start race does); taking back (database specs,
the pass); the numbers (database specs against rows written by hand); sharing (browser specs on the
links and the Web Share call; the pass presses Copy); the QR naming the link (a spec decoding the
path's modules back); a campaign's limit (database specs); flags and the review (database specs, the
pass); notices (database specs, browser specs, the pass); the admin's refusals (every route answered
as a page that is not there to anybody else, `app.spec.ts`); pages of a long history (database specs
across a millisecond); phone and desktop (the walks, the fit of the page at 360 to 1440). Light and
dark themes do not apply: the product has one theme by design (`frontend/CLAUDE.md`).

## Not in this work

- Email or phone verification: no account has either; a wallet's signature is how an account exists.
- NURA rewards: the server holds none; inviters already earn NURA through the shop's contract.
- Attribution across devices, and anything that would make it possible (fingerprints, IPs, contacts).
- Vanity codes, and more than one active campaign at a time.
- Automatic suspension for farming: a flag holds a reward, and a person decides.

## As built

Built in this order, each part its own commits with specs, faults put in one at a time and caught,
its checks, a build within budget and a walk at 1280 in English and 390 in Persian: RF0 the design
(`0eae20e1`); RF1 the schema (`6f947c73`); RF2 codes, the public way in and the counted invite
(`516a195d`); RF3 the way in in the browser (`973e9204`); RF4 the page (`2ef3dd0b`, `834643cb`); RF5
established players, flags, the notices and rewards from a campaign (`e169be43`, `37068225`,
`54ea30c9`, `5519072e`, `785ce767`, `401ca9fb`); RF6 Admin › Invites (`47ac301d`, `298597b6`,
`13aa98ff`, `c25c2ca4`); RF7 the top inviters, the switch and the campaign on the page (`57476972`,
`47c3def6`); RF8 the invite pass (`3675884a`). On the way, and each a commit of its own: specs that
left chat messages behind (`b780adb5`), two type errors and an unused import from RF4 and RF5
(`85bf6f12`, `f56311c9`), the guards fetching the admin's rules so the landing's first chunk stayed
under its 60 KB (`44663a88`), and the landing's chooser offering every wallet that announces itself
(`a5e66bcc`).

Where it differs from the design above:

- **The flags** are RF-D21 and RF-D27: `quick` is ten minutes, not an hour, and `many` five a day,
  not ten.
- **The owner's question about ten thousand wallets** became RF-D16 to RF-D18, built as RF-D20 to
  RF-D22: a farm of fresh wallets that only play each other never counts an invite, because nobody
  in its games is established.
- **The top inviters** are strict places (`rank()` with the handle in the window, as the game boards
  rank), ties to whoever reached the count first, twenty of them, the reader's own place wherever it
  is, and counted only from invites with no flag, so a farm never climbs them.
- **The way in** needed the landing's chooser to offer any wallet that announces itself: it offered
  three and dropped the rest, so a friend with any other wallet could not join from a link. The invite
  pass found it with a wallet of its own.
- **The sheet about a person** named everybody on the invite page's lists by their handle until the
  invites store asked the people store who they are (`47c3def6`).

Measured at RF's close: `npm run check` clean with no warning; the browser suite, 5218, and the
server's, 2468, each in order and shuffled (seeds 1793538821437 and 1793538904639); every database
spec, 1041 in 67 files; the invite pass clean on the built server, 39 checks, and
8 of 39 against the compiled server broken three ways; the garbage pass 177 of 181 on RF6's build, every
route of this work answering no 5xx, the four that did not being the NuraChain reads this machine's
chain does not hold.

Not done, and why:

- **Scanning the QR with a camera** was not tried: Chromium on Windows has no `BarcodeDetector`. A
  spec holds the drawing to the encoder's own output for the link.
- **A friend who joins is not made a friend of the inviter**: nothing in the brief asks for it, and
  it is a decision about two people's lists that is the owner's to make.
