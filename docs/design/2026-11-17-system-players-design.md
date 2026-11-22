# System players: the server's own seats at quick play

What was built so that a person at a quick-play table is not left waiting for a full table, and the
decisions taken on the way, numbered SP-D1 onward. The code is `backend/src/domains/system/`
(identity, pool, switch, seat filling, the admin's side) and `backend/src/domains/ai/` (the runtime,
the worker, one agent per game). What to do in operation is the System players section of
`docs/operations/runbooks.md`.

## What it is and what it is not

A **system player** is a seat the server plays. After a person has waited at an open public
quick-play table for the set time, the server seats system players in its free chairs, one at a
time, and starts the match once every chair is taken and ready. Players and spectators see a localized AI label beside each server-controlled
seat, including in the waiting room and the game result. The account keeps its name, colour and
game record, and its profile identifies it as an AI player.

It is not a way to make the site look busier: system players are never seated at a table where no
person is waiting, never in a private, paid or tournament game, never on a board, and they leave the
table when the people do. It is not a hidden opponent that changes the money or the rankings: a
match with a system seat moves no rating, makes no market, and for the people in it counts for no
quest, no invite, no achievement progress and no streak.

## Identity (SP-D1)

A system player is one `users` row plus one `system_players` row. The `users` row exists only
because chairs (`table_seats`), match seats (`match_players`) and moves (`match_actions`) all key on
a user id; nothing else about it is an account.

`system_players` holds `user_id` (the key, cascading with the user), `skill` (one of `casual`,
`intermediate`, `advanced`, `semi-pro`), `style` (0 to 999, seeding small differences in how it
plays), `retired_at` (never seated again once set) and `created_at`. Raw SQL asks "is this a system
player" only through `system/sql.ts` (`isSystem`, `notSystem`, `hasSystemSeat`), so a query that
forgets to ask is found by searching for one name.

- **No wallet and no session, ever.** Nothing makes one sign in or link a wallet; the two places that
  insert either (`identity/service.ts`) also ask, and refuse a system user, so a bug elsewhere cannot
  hand one a session or money.
- **Its `users` values** are set so nothing has to be faked: not a minor, no messages from strangers
  (so no stranger can open a conversation or send a table invite), presence shown to nobody, no
  picture, no bio, a colour from the generator.
- **Its name** (`system/names.ts`) is a first name common on a Persian/English site with the short
  tails people add when theirs is taken (`sara.m`, `amir_h7`, `reza1372`); the display name is the
  Persian spelling, the capitalised name, the name and an initial, or the handle. First names only,
  so no name is a public figure's. Every handle passes `checkHandle`, and a name with a part that
  reads as staff, the product or a machine (`admin`, `support`, `bot`, `ai`, `nura`…) is never given.
- **The pool grows as seats need it**, up to the cap (`most`, retired ones not counted). A filler
  takes an idle one (not retired, not seated, in no live match, neither blocking nor blocked by
  anyone at the table, and not one that sat at this table in the last 10 minutes) and makes a new
  one only when none is idle and the pool is under the cap; otherwise the table waits.
- **Public identity.** Occupied chairs, match seats and profiles carry `ai: true` when the user
  is registered in `system_players`. Watchable match lists and match history identify the same
  players by handle. These fields follow the existing visibility of each table and profile.
  Admin › People continues to expose its `system` flag to staff. Skill and style stay internal.

## The switch and the settings (SP-D2)

One setting, `system-players`, JSON `{ on, games, wait, skill, most }`, read by one parser
(`systemConfigOf`) that reads each part on its own with a default:

- `on`: off unless it says `on: true`. The feature ships off.
- `games`: per game id; **a game absent from the map is on**, so switching on fills every game not
  switched off by name.
- `wait`: seconds a person waits before seats are filled, 5 to 120, default 20.
- `skill`: what a newly made system player plays at, default `intermediate`. Existing ones keep
  theirs.
- `most`: the pool's cap, 1 to 200, default 40. Lowering it retires nobody; it only stops new ones
  being made.

Reading the page and retiring a system player need `system` (an admin's). The switch, the games and
the settings are the owner's (`wallet`). A missing ability answers 404. Every change is a staff
action of kind `system-players` in the same transaction, with a reason and the part's before and
after.

**Off** means nobody new is seated, and system players waiting at a table that has not started stand
up at the next pass. A match under way is untouched and played to the end by its system players.
The same holds for one game switched off.

## Which tables are filled (SP-D3)

There is no queue: quick play is ready chairs at open public tables. The seat filler
(`system/fill.ts`, a worker every 2 seconds with a 1.5-second budget) fills a table when all of
these hold:

- the switch and its game are on, the game is available, and **an agent plays it** (the games with
  an agent are handed to the filler; a game with none is never filled, whatever the settings say);
- the table has a `quick_tables` row, is public and open, has no live match, no stake and no
  tournament;
- a chair is free and not held for an invite;
- a person is seated and present (by the realtime hub), and **every person seated is ready**: a
  table one person is not ready at could not start once filled, so it is not waiting at all;
- the wait is **a fresh one** of `wait` seconds, counted from the latest of: when the
  longest-waiting person got ready, the end of the last game at that table, and the last time a
  system player stood up from it. Saying "ready" restarts the seat's `joined_at`, which is the ready
  time; there is no column of its own.

Quick play, for its part, only offers a person tables where another person is seated: a table left
to system players is on its way out.

Under quick play's per-game lock and then the table's lock it reads the table again, seats **one**
system player in a free chair, ready, and starts the match through the same path quick play uses
once every chair is taken and ready. One a pass means a table fills over a few seconds and a person
arriving meanwhile still finds a chair. At a teams table the system player takes a chair on the side
with more people, so the other side's chairs stay open and people end up on both sides. People are
never moved.

A seated system player is never "absent" to the table sweep and is left out of quick play's
"everyone here" test, which counts people only. It is exempt from the same-age rule (it has no age).
It joins the table's game chat thread exactly as a person who sits down does, and the thread's
members are told; standing up takes it out again, as for anyone.

**Not the same table twice in a row.** A system player is not seated at a table it sat at within
the last 10 minutes (`LATELY_MS`): it would look like someone who left and came straight back. The
filler reads this from the seats of matches that finished there lately, plus what it remembers of
stand-ups there.

**A system player stands up**:

- when no person is left at a table with no match running: one at a time, the lowest seat first,
  each 3 to 15 seconds (seeded by the table, the seat and the moment) after the table emptied or the
  previous one stood up. All of them going the instant the last person did would mark them. A person
  who sits down meanwhile keeps the rest seated, and the table closes by the existing rule when the
  last one goes;
- when the switch or its game goes off, the game is no longer available, or no agent plays it,
  before the start;
- when it has been retired and the table has not started;
- when every chair has been taken for 60 seconds and no match started;
- 8 to 20 seconds after its match finishes, its own moment for its own seat, seeded by the table,
  the seat and the finish so nothing is held in memory;
- in poker, when it busts, like anyone.

Never: a match with no person in it, a seat a person could have taken first, one system player in
two places. `takeIdle` takes the `system_players` row `for update skip locked` and asks again in a
statement of its own whether it is seated or playing; making one takes an advisory lock so two
fillers at the cap do not both make one. "A match with no person in it" is refused where a match is
dealt (`deal` in `match/service.ts`, which `match.start` goes through): a table where no chair is a
person's (`seatsAPerson`) is answered `not-ready`. The filler also starts a match only at a table
with a ready, present person.

**What the filler keeps in memory.** A stand-up leaves no row, so each process remembers, per
table, when a system player last stood up, which ones did, and since when it has seen no person
there. Another process keeps its own; the worst this does is let a table be filled or emptied a
step early.

## What a match with a system seat counts for (SP-D4)

The recorder (`match/record.ts`) learns once per finish which seats are system players.

- **Rating** is frozen for every seat: each seat that would have been rated gets its row with
  `after = before`. The result stands; nobody's rating moves, and no seat is missing a rating row.
- **Results, XP, played and won** are recorded as usual for people and for system players, so a
  system player's record is its real games.
- **Kept apart:** `player_stats` gains `system_played`, `system_won` and `system_xp`, the part of a
  person's `played`, `won` and `xp` that came from matches with a system seat (a check keeps each
  between 0 and its total), and `system_tallies` (jsonb, default `{}`, checked to be an object like
  `tallies`), the part of `tallies` from those matches. The profile shows `tallies` whole. Every board ranks on what is left: the all-time board on
  `xp - system_xp` and shows `played - system_played` and `won - system_won`; the windowed and
  season boards leave out matches with a system seat.
- **Streak:** in a match with a system seat a person's win streak neither grows nor resets
  (`streakOf`), so a best streak cannot be built against opponents summoned at will. A system
  player's own streak moves as usual.
- **Never counted:** system players appear on no board, among no achievement's holders, in no
  rarity denominator, in no distinct-opponents count, in no public "playing" count, and not in the
  admin's people totals.
- **Achievements:** a person's achievements stand on games among people only: played, won and xp
  less their system parts, and the per-seat, pace, days, distinct-opponents and hosted facts leave
  out matches with a system seat; the level fact is worked from that filtered xp (the level on the
  profile is unchanged). A system player earns its own achievements from all its games, so its
  profile never shows a record with nothing earned for it; it is still left out of holders, rarity
  and boards, never notified, and never minted (`nft/service.ts` refuses it, wallet or not). The
  tally ladders stand on `tallies` less `system_tallies` for a person, and on plain `tallies` for a
  system player (`ownOf`).
- **Rewards:** a match with a system seat in any seat reports **no players** to the quests
  (`questPlayersOf`). Leaving out only the system opponents was not enough: in a team game a
  person's partner is among their opponent ids too, so two people could have earned quests together
  against summoned opponents. A match among people only is passed through unchanged.
  `eligibilityOf` and the quest claim gate also refuse a system player.
- **Invites:** a system player is never established and never vouches, and a match with a system
  seat counts towards nothing here: not towards becoming established, and it never counts an
  invite (`countedBy` does nothing for it), for the same partner reason.
- **Money:** never seated at a staked table, and the stake lock refuses a deal that seats one (the
  stakes are refunded). No market is made for a match with a system seat. Never a gift's or a tip's
  recipient, never a "friend" in the shop's gift search.
- **Tournaments:** `join` refuses a system player, and the filler never seats one at a tournament
  table.
- **Notifications:** none are written for a system user, so no badge and no push. (No achievement
  notification exists for anyone.)
- **Social:** left out of suggestions. A friend request to one is stored and never answered, as an
  unresponsive person's would be.

## How the AI runs (SP-D5)

**Trigger.** Every committed action passes the post-commit path, which tells the runtime
(`ai/runtime.ts`); if the seat to move is a system player it schedules one decision for that match in
memory. A backstop sweep (`driveSeats`, every 3 seconds, 2-second budget, up to 200 live matches with
a system seat, nearest deadline first) finds turns nothing scheduled: after a restart, or a game
another process dealt. The first sweep is also what switches the runtime on, so a process that never
sweeps never drives a seat. At most one decision per match is in flight in a process; a second
process acting on the same turn is answered `already` or `stale` and drops it.

**What an agent may see** is declared once (`OPENNESS` in `ai/agent.ts`):

- *open* games (chess, backgammon, ludo) hide nothing from a seat, so the agent is handed the engine
  state and may search with the engine's own moves and a die of its own;
- *hidden* games (hokm, poker): the agent is handed only the seat's board (`engine.view`) and the
  seat's log as `match.feed` composes it for that seat, exactly what that seat's client receives,
  and models the rest itself. Never the state, the draw seed or a raw event. The seat logs are kept
  per match (for up to 256 matches, sized for the pool cap, the one read longest ago dropped first)
  and extended with what is newer, and any doubt is answered by a full read. A spec proves
  that two states differing only in what the seat cannot see give the same decision for one seed.

**An agent** is pure and synchronous: no I/O, no clock, no `Math.random`. It is given the seat, the
format, its input, its skill and style, a seeded random (seeded from the match, the revision, the
style and a salt drawn at each start, so moves cannot be foreseen from a match id) and a time budget,
and it answers with the same play a client sends. `match.act` is the only judge of legality, so a
wrong agent is a refused move, never a corrupted game. A system player acts through the same path
and the same courtesies as a person's move, with the key `ai:<rev>`.

**Where it runs.** Decisions run in a small lazy pool of `worker_threads` workers, so a search never
holds the event loop. The pool starts with one worker and adds another only while a job is waiting,
up to `min(4, max(1, cores - 2))` (two cores are left to the main thread and the database), since
one worker cannot keep up with the strongest skill at the pool cap. Each worker takes one job at a
time from one shared queue of at most 64. The worker file's extension follows the running file's,
so it works from the `.ts` sources in development and from `.dist-backend` when built. A job whose
match moved on is dropped before it is handed over; a job that runs 2 seconds past its budget ends
its worker, and a waiting job makes a new one, as does a worker that died. Each worker's heap is
capped at 256 MB.

**Think time.** The move is sent after a delay that first waits out anything the board is still
showing (a trick, a pot). The window is worked out first (`thinkBounds`): at least 0.7 s and at most
the smallest of 7 s, a third of the turn, and on a chess clock a thirtieth of the bank (a bank too
small for 0.7 s lowers the least to 60% of that cap); a forced move takes at most 1.2 s; and always
at least 2 seconds before the deadline, which wins over every other bound. The delay is then drawn
inside that window around a pace that grows with the game (a typical move: chess 2.6 s, poker 2 s,
backgammon 1.8 s, hokm 1.5 s, ludo 0.9 s) and the number of real choices, spread by 40% of the pace
(at least 0.25 s) either way. Drawing inside the window rather than clamping a draw onto it means no
exact interval recurs at a bound. It is never the same interval twice running in one match (the last
interval is kept per match and dropped with it). The decision starts at once and may use 80% of the
delay (between 0.1 and 3 seconds).

**Fallback.** If no decision has arrived when the move is due (it may wait up to 2 seconds more, never
past the 2-second safety), or the decision failed or was refused, the runtime plays a cheap legal
move: the engine's own autoplay, except chess, whose autoplay flags, where it plays the best move by
material one ply deep. Each fallback is counted. A system seat that still reaches its deadline is
handled by the turn sweep as anyone's would be, and counted as an error.

**Nobody left.** When no person is still playing in a match, each system seat resigns or forfeits
at its own seeded moment, 4 to 20 seconds after the runtime first found the match with no person
left, and plays its turns normally until then. Seats leaving together would show they were never
people; the match still ends within about half a minute. A seat's leave goes before its own move
when the move would come later, unless the leave would land past the turn's deadline.

**Skill** changes real decision quality (how far it looks, what its evaluation sees, how wide a
margin of near-equal moves it picks among), never random blunders: no level ever picks a play it
judges worse on purpose. **Style** moves a few tastes a little either way, so two system players at
one table do not play alike.

**Diagnostics** are kept in memory since the process started: decisions, average and slowest
decision time, fallbacks, and the last 50 errors, which also go to the log.

## Each game's strategy (SP-D6)

Every agent is version 2. The margin is how far below the best a choice may score and still be
picked; it narrows with skill.

- **Chess** (open). An iterative-deepening alpha-beta search (principal variation, transposition
  table, null-move pruning, late-move reductions, quiescence) over its own board. Casual looks 3 plies
  (12,000 nodes) on material and placement only; intermediate 6 plies (60,000) and also sees pawn
  structure, the bishop pair and rooks on open files; advanced 10 (200,000) and also mobility and
  king safety; semi-pro 16 (600,000). Margins 40, 20, 10 and 4 centipawns, wider in the first 12
  plies so openings vary. It takes a draw when clearly worse or late in a level game, declines one
  otherwise, and never offers, resigns or flags.
- **Backgammon** (open). Every whole-turn move read by the position it leaves (winning and gammon
  chances); intermediate and above read with the full set of terms; advanced also looks over the
  other side's 21 rolls for its best 4 candidates, semi-pro over its best 6 and one roll further on
  its best 2. The cube is decided in match-winning chances (Crawford included); advanced and
  semi-pro read it after a look over the dice.
- **Ludo** (open). Each token it may move read by progress, captures, the chance of being hit and the
  threat it poses. Casual reads progress and captures only; intermediate adds danger and the home stretch;
  advanced looks over the next roll; semi-pro one roll further and counts the exact rolls of the
  endgame.
- **Hokm** (hidden). Casual plays by rule of thumb and remembers only the trick in front of it;
  intermediate counts every card and void and plays the last 4 cards out over the deals still
  possible; advanced plays every card out over 32 deals consistent with everything seen, reading
  other players' choices; semi-pro over 200 deals and leans the trump suit towards the Hâkem. At two
  seats only the ending is played out.
- **Poker** (hidden). Casual plays a tight chart before the flop and its made hand after, and never
  bluffs; intermediate opens by position, pushes or folds when short, and plays each street on its
  share of the pot over sampled deals against rough ranges; advanced reads each opponent's range
  from the hand's betting, continuation-bets and semi-bluffs; semi-pro also reads how each opponent
  has played this match and sizes its bets from a wider choice over more deals. Every raise lies
  between the board's least raise and its all-in.

## What staff can see and do (SP-D7)

Admin › System players (`/admin/system`, the `system` ability):

- the switch, each game on or off with the strategy that plays it (agent, version, whether it sees
  the whole board or only its seat), and the settings (wait, skill of new ones, the cap); changing
  any of them is the owner's;
- figures: per game, system players waiting at tables and playing now, live matches with one, and
  matches with one started today (by the database's clock); the pool's size and retired count; and
  the runtime's decisions, average and slowest time, fallbacks and recent errors;
- the pool, newest first: handle, skill, style, games played, where it sits or plays now, and
  whether it is retired, with Retire (a reason; a match it is playing is played to the end).

On Admin › People and a person's page, everyone who may open them (the `people` ability: a
moderator and above) sees "System player" on those rows; the rest of a system player's face (no
wallet, no sessions, no devices) would tell them anyway. The admin people totals leave them out.
The staff log names the system player retired.

## The tells that were accepted

These follow from putting the integrity of ratings, rewards and money first, and were accepted
knowingly:

- a match with a system seat moves no rating, no quest and no streak for the people in it, and
  opens no prediction market; someone who looks for that can infer it;
- the public "playing" count counts people only, so a chair filled without the count rising is a
  system player;
- system players show no presence dot, as a person with presence switched off does;
- they sit in the game chat but never write in it, never send or answer a friend request, and
  cannot be messaged by a stranger;
- they never appear on a board, among an achievement's holders or in its rarity, whatever their
  record, though their own profile shows what they earned;
- they leave on a timetable: from a table its people left, one at a time within 3 to 15 seconds
  each; from a match with no person left, each within 4 to 20 seconds; and never back at the same
  table within 10 minutes;
- in poker, one that busts simply stands up;
- every member of the staff who may open Admin › People sees the mark, and the staff log names them
  to the staff;
- players can identify each AI opponent on its seat and profile.

## Not built yet

- **Several processes**: the filler's memory (last stand-up, who stood up, since when a table had no
  person) and the runtime's "no person left since" are per process. With more than one filler a
  table can be filled or emptied a step early; after a restart, a match's system seats can leave
  later than 20 seconds after the last person did, since the clock starts when the process first
  sees it (fixing it needs a left-at time in the turn the runtime reads).
- **Changing an existing system player's skill**: the setting applies to new ones only.
- **The overview**: the figures are on the System players page only, not on Admin › Overview or in
  `GET /api/metrics`, and the runtime's figures restart at zero with the process.
