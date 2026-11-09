# Tournaments: the design

Free tournaments that run with nobody at the controls: anybody opens one, players take a place from
the list or a link, and the server starts it, deals every game, moves winners on and names a
champion. People can follow the bracket and watch any game. Paid tournaments come later, and are the
item the paid-tables design left unbuilt (its D14). Entry and prizes here involve no NURA, and no
betting market opens on a tournament game. Somebody watching can still give a player NURA, as at any
public table.

## What was decided

| Question | Decision | Why |
|---|---|---|
| Who plays | One against one, in all five games (ludo, hokm and poker at two seats) | One winner per game keeps every format simple. |
| Formats | Single and double elimination, round robin, Swiss, groups + playoffs | Each is an adapter behind one interface. |
| Start | When full, or at the start time with at least 4 players; otherwise cancelled | Fully automatic. Empty places become byes. |
| No winner | Knockout: one more game, then the better seed. League: a draw | It can never loop. Seeds are drawn at random at the start. |
| Who creates | Any signed-in player, at most 3 at once; listed or link-only | |
| Match length | Best of 1, 3 or 5 | |

Not built: team rosters, check-in, disputes, manual results, prizes. Every game here is played on the
server, so a result never has to be reported or argued over, and paid entry is its own project.

## The engine: `backend/src/domains/tournament/engine/`

Pure code, with no database and no clock, so `tests/tournament-engine.spec.ts` can play every format
at every field size.

- `game.ts`: one `Game` for every format, and what every format shares. A game links to where its
  winner and loser go, and `settle` carries players along those links. A game whose feeders are all
  decided but that received one player is a bye, and with none it is void, which is what makes byes
  work in a double elimination's losers' bracket.
- `elimination.ts`, `league.ts`, `groups.ts`: the formats. A new format is one more `Format`, added to
  `formats.ts`.
- Games carry a `phase`, the longest chain of games they wait for. A phase is dealt only when every
  earlier one is decided, which gives every format "round by round" for nothing.

Double elimination alternates losers' rounds: odd rounds pair survivors, even rounds bring in the
droppers, reversed every other round so a rematch comes as late as possible. A grand final the
losers' side wins adds a reset game. Groups are about four players, snake-seeded; the top two of each
go through, and a group winner meets the runner-up of the mirrored group, never their own.

## Running it: `service.ts`

`advance(id)` brings one tournament as far forward as the rows allow, under a lock on that tournament,
and can run any number of times. A sweep calls it every five seconds for everything active. A finished
game also calls it straight away, but that call is only a courtesy and can be lost; the sweep is what
guarantees a bracket moves. Applying a result and writing the game's new state happen in one
transaction, so a result counts once.

There is a two-minute break before the first games and one minute between rounds, kept on the server
in `next_round_at`, so people can get to the table.

## Tables

A tournament game is an ordinary row in `tables` with `tournament_id` set, opened and dealt in the
same transaction with both chairs ready, so none of the waiting-table sweeps can act on it. It is
public, which makes watching work unchanged; a game of a link-only tournament stays off the live list.
Chat and voice are off, because the two were paired by a draw and may have blocked one another.
Nobody can take a chair at one or play again at one. Results and clocks are the engine's as always:
somebody who is absent loses on time.

## Rules worth knowing

- A tournament game finishes as a normal rated game.
- The per-round break is global; a player who wins early waits for the round.
- Staff can call off an open or running tournament from Admin › Play, with a reason in the staff log
  (it is logged as a `close`). Games already at a table finish as ordinary games.
- A tournament table closes an hour after its game ends, like any idle table, so a finished game can
  be opened from the bracket for that hour and only its result stays after that.
