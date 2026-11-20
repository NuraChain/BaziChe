# Ludo — منچ

**Status:** playable. The engine and the board are built, `games.status` is `available`, and the
achievements are live. A table of four is also played two against two when whoever opens it says so (see *Teams*):
the catalogue's `partners` for ludo is `optional`.

Baziche uses Iranian mench on a 52-square track. Four filled stars protect every token and four hollow
stars mark the entries. A partner's entry also protects a token in team play. The turn passes
whenever the roll leaves no legal move, and each square holds one token.
Baziche uses six-only entry and bonus rolls, clockwise play, and an eight-token team finish.

---

## Sources

Original sources read on 2026-10-04. Plato's rules were checked on 2026-11-20. The keys in square brackets are used through the rest of this file.

| key | source | how it was read |
|---|---|---|
| [Plato] | [Plato Ludo rules](https://platoapp.com/en/games/ludo) | publisher's rules for single occupancy, occupied safe spaces and passing |
| [WP] | en.wikipedia, [*Ludo*](https://en.wikipedia.org/wiki/Ludo): *Rules* (Overview, Gameplay) and *Variants* (Differences, African, Indian) | raw wikitext |
| [MoG] | Masters of Games (James Masters), [*Rules of Ludo*](https://www.mastersofgames.com/rules/ludo-rules-instructions-guide.htm) | the site refuses direct fetches (403); read from the Wayback Machine snapshot of 2025-06-26 |
| [Schmidt] | Schmidt Spiele, [*Die große Spielesammlung, Premium-Edition* (49125)](https://www.schmidtspiele.de/files/Produkte/4/49125%20-%20Die%20gro%C3%9Fe%20Spielesammlung/49125_Die_grosse_Spielesammlung_Premium-Edition-D.pdf), *Mensch ärgere Dich nicht*, pp. 1-2. Schmidt publishes the original | the PDF from schmidtspiele.de |
| [setare] | ستاره, [«نحوه بازی و قوانین بازی منچ + تاریخچه این بازی صفحه ای»](https://setare.com/fa/news/39255/) | direct |
| [fekravaran] | فکرآوران, [«آموزش کامل بازی منچ»](https://fekravaran.com/read/learn-mench-game) | direct |
| [faWP] | fa.wikipedia, [منچ](https://fa.wikipedia.org/wiki/%D9%85%D9%86%DA%86) | raw wikitext |

[Schmidt] is *Mensch ärgere Dich nicht*, the game منچ is named after. It is played on a different
board (40 track squares and four goal fields) and has no safe squares, so it is cited for the rules
of play and never for geometry. [setare], [fekravaran] and [faWP] are the Iranian sources. None of the
sources is a governing body: Ludo has none, and every source calls its own rules one way among several.

---

## Rules matrix

### Setup

| # | rule | basis |
|---|---|---|
| S1 | Two, three or four players, each on their own. Four may also play as two pairs (*Teams*). | cited: [WP] "Two, three, or four can play, without partnerships."; [faWP] «این بازی می‌تواند توسط ۲، ۳، یا ۴ بازیکن انجام شود» ("2, 3 or 4 players can play it") |
| S2 | Four tokens each, all four in the yard at the start. | cited: [WP] "To enter a token into play from its yard to its starting square, a player must roll a six."; [MoG] each player "places the 4 pieces of that colour in the corresponding starting circle". Against: [Schmidt] starts one token on the start square ("Einen Stein stellt er auf das Feld A seiner Farbe") |
| S3 | The board is the Ludo cross on a 15x15 grid: a 52-square ring, then a five-cell home lane per colour and the centre triangle. | house rule: read off the board art (`ludo/board.ts`, held to the art by `ludo-board.spec.ts`). [fekravaran] counts the same board's 72 cells («صفحه بازی منچ شامل 72 خانه است»), which is 52 + 4 × 5 |
| S4 | Colours by seat count: two players are red and yellow (opposite corners, 26 squares apart), three are red, green and yellow, four are all four. | house rule: so two players never start one behind the other |
| S5 | Four filled stars mark safe squares. Each hollow star is a colour's entry square. | Baziche's board. [WP] *Indian* uses a safe star in each quadrant. |
| S6 | The first player is drawn by the server at random. | house rule. [MoG] "highest throw of the die starts"; [Schmidt] "wer die höchste Zahl würfelt, beginnt". A server draw is the same fair choice without a roll-off nobody decides anything in |

### Turn rules

| # | rule | basis |
|---|---|---|
| T1 | One die. A turn is a roll, then (if anything can move) one move with that die. | cited: [MoG] "A single die is thrown to determine movement."; [faWP] «تعداد تاس ۱ عدد می‌باشد» ("there is one die") |
| T2 | Play passes clockwise round the board: red, green, yellow, blue. | cited: [MoG] "Players take turns in a clockwise order"; [Schmidt] "reihum im Uhrzeigersinn" |
| T3 | A six earns another roll after its move. | cited: [WP] "If the bonus roll results in a six again, the player earns again an additional bonus roll."; [setare] «تاس ۶ جایزه دارد!»; [fekravaran] «هر بار شش بیاورید یک نوبت اضافه می‌گیرید» ("every six earns an extra turn"); [MoG] "A throw of 6 gives another turn." |
| T4 | **Only** a six earns a roll. A capture or a token reaching home on one to five passes the turn; on a six it keeps the six's roll. | cited: no accepted source gives a bonus for anything but a six ([setare], [fekravaran], [faWP], [MoG], [Schmidt] all name only the six). Against: [WP] *African* ("If a player captures the piece of another player, they are awarded a bonus roll.") |
| T5 | If the roll has no legal move, the turn passes immediately with `no-move`, including on a six. | [Plato], [MoG] |
| T6 | Three sixes in a row end the turn. The third six is not moved and earns no roll (`pass`, `three-sixes`); the count starts again for the next player. | cited: [WP] "If the third roll is also a six, the player may not move and the turn immediately passes to the next player." Against: [faWP] keeps throwing until a non-six («تا عدد غیر ۶»); [Schmidt] the same ("darf er erneut nach dem Ziehen würfeln"); [fekravaran] says some versions send a piece home instead and to agree first («پیش از شروع، درباره این قانون توافق کنید») |
| T7 | No "three tries to find a six": a full yard rolling one to five passes at once. | cited, by absence: [WP], [MoG], [setare], [fekravaran], [faWP] have no such rule. Against: [Schmidt] "Wer keine Figur mehr im Spiel hat ... kann dreimal würfeln" (that clause is in its team variant) |
| T8 | A player with a legal move must make one. There is no voluntary pass. | cited: [MoG] passes play only "If no piece can legally move". The turn clock plays an expired turn (see *Turn order*) |

### Moves

| # | rule | basis |
|---|---|---|
| M1 | A token leaves the yard only on a six, onto its own start square. | cited: [WP] (S2's quote); [MoG] "A player must throw a 6 to move a piece from the starting circle onto the first square on the track."; [setare] «هر بازیکنی که تاس ۶ بیاورد، مجوز دارد که یک مهره‌اش را وارد بازی کند» |
| M2 | Entering is a choice: on a six the player may bring out any yard token or move a token already out. | cited: [setare] «روش دیگری که در ایران بیشتر بازی می‌شود این محدودیت را ندارد، یعنی بازیکن می‌تواند با هر تاس ۶، یکی از چهار مهره خود را وارد بازی کند» ("the way more played in Iran has no such limit: with any six the player may bring in any of their four pieces"); [MoG] "Each throw, the player decides which piece to move." Against: [Schmidt] base rules make entering compulsory ("Bei einer „6” muss man einen neuen Stein ins Spiel bringen") |
| M3 | Yard tokens are interchangeable. A move naming any yard token brings out the first one in the yard, and the move list offers the entry once. | house rule (engineering; LUDO-11) |
| M4 | A token moves exactly the die, clockwise, and may pass over occupied squares. | [Schmidt], [Plato] |
| M5 | A ring or home-lane square holds one token. An occupied square is a legal destination only if the move captures its opponent occupant. Finished pieces are counted separately. | [Plato] |
| M6 | A token walks 50 squares past its start square (51 of the 52) and its next step enters its own home lane. It never laps the board again. | cited: [WP] home column; [faWP] (for team play) «نمی‌تواند دوباره یک دور دیگر برود» ("cannot go round again") |
| M7 | The home lane and the triangle need an exact count. An overshoot is not offered as a move. | cited: [WP] "In the home column, a player must roll the exact number needed to get each token onto the home triangle."; [MoG] "only ... by an exact throw"; [fekravaran] «بازیکن باید عدد دقیق ... را بیاورد»; [Schmidt] "Auch die Zielfelder werden beim Vorrücken einzeln gezählt" |
| M8 | Nothing forces a capture. Any legal move may be chosen. | cited: [Schmidt] "Es herrscht aber kein Schlagzwang." |

### Captures

| # | rule | basis |
|---|---|---|
| C1 | A token that lands exactly on an opponent sends it back to its yard, where it needs a six like any other. | cited: [WP] "the opposing token is returned to its respective home point"; [MoG] "the piece jumped upon is returned to its starting circle"; [setare] «مهره سبز دوباره باید به بیرون از صفحه بازی بروند و با تاس ۶ بعدی به بازی بیاورید» |
| C2 | Capture is on the exact landing square only, never by passing over. | cited: [Schmidt] "Wer mit dem letzten Punkt seiner Augenzahl auf ein Feld trifft ... schlägt diese Figur"; [fekravaran] «اگر مهره شما دقیقاً روی خانه‌ای بیفتد...» |
| C4 | A move onto a filled star requires an empty destination. In team play a token on its partner's entry is protected too. Other occupants of the entry follow the ordinary capture rule, including on a yard entry. | [Plato] for safe-square occupancy, Baziche house rule for the partner's entry. |
| C5 | The home lane is private: no other colour can enter it, so nothing there can be captured. | cited: [WP] "A player's home column squares are always "safe", since no opponent may enter them."; [fekravaran] «مهره‌ای که وارد خانه پایانی شود ... قابل زدن نیست» |
| C6 | Own tokens are never captured. | cited: [Schmidt] "Eigene Steine können nicht geschlagen werden" |

### End

| # | rule | basis |
|---|---|---|
| E1 | The first player with all four tokens home wins. | cited: [WP] "The first player to bring all their tokens to the finish wins the game."; [faWP] «برندهٔ بازی فردیست که زودتر از دیگر بازیکنان موفق به تمام کردن مهره‌های خود بشود»; [setare]; [MoG] "The first person to move all 4 pieces into the home triangle wins." |
| E2 | The game ends there. Nobody plays on for second place. | house rule. Against: [WP] "The others often continue to play to determine second-, third-, and fourth-place finishers."; [Schmidt] "Die anderen spielen weiter um die nächsten Plätze." |
| E3 | A seat that forfeits (resigns, leaves, or misses three turns in a row) is out. While the game goes on, its tokens go back to the yard and it is skipped. When one seat is left playing, that seat wins, and the forfeit that ended the game leaves the board as it stood: the finished board shows the game that was played, and the position is what says who was behind (*Teams*, T14). | house rule (the platform's forfeit rule, the same at every game) |

### Scoring

| # | rule | basis |
|---|---|---|
| R1 | Places after the winner come from the board: tokens home, then total distance travelled. A seat that forfeited is below every seat still playing, and everybody who forfeited shares that last place whatever was left on the board. In a team game the places are the sides' (*Teams*, T13). | house rule (`ludo/standings.ts`, `placementsOf`), because the game stops at E2 |
| R2 | The rating, the result and XP are the judge's (`judge.ts`), from those places and the ledger, as for every game. A seat counts as engaged after six rolls of its own. | house rule (platform; `judge.ts`) |
| R3 | XP inside a game: a capture is 2, a token home is 3 (`Engine.points`), on top of the platform's finish and win. | house rule |
| R4 | Tallies for achievements: `rolls`, `sixes`, `enters`, `captures`, `home`, credited to the seat that acted. | house rule; the names are a contract with `achieve/families.ts` |

### Special rules

| # | rule | basis |
|---|---|---|
| X1 | The die is drawn by the server, inside the transaction that applies the roll. A play cannot carry a die. | house rule (platform); `ludo-dice.spec.ts` |
| X2 | Turns are 30 seconds live, 24 hours turn-based. A roll and its move share one deadline. An expired turn is played for the seat (roll, then the first legal move, folding up to eight steps) and counts as one miss; three misses in a row forfeit. | house rule (platform: `turns.ts`, `FOLD_MAX`, `MISSES_ALLOWED`) |
| X3 | Nothing is hidden. Every seat and every spectator gets the same board and the same log. | house rule; a ludo board is face up |

---

## Decided choices

Baziche's four filled stars are safe for every token. In a team match a token on its partner's
hollow star is also safe. An opponent on your start or your partner's start can be captured,
including when a token leaves the yard onto its start after a six.

The one-token rule supersedes D28 and D29, which previously allowed two friendly tokens to
form a block. A position recorded under those rules can still show a stack. Tokens may move
off or pass those pieces, and a new landing cannot join them.

---

## State model

`backend/src/domains/match/ludo/`, pure and import-free (`ludo-purity.spec.ts` reads the directory as
text and refuses `node:`, `typeorm`, `Math.random` and `Date.now`).

```
board.ts      the grid, the ring, the entries, the safe squares, the home lanes, ringIndex, cellAt,
              isProtectedRing (C4) and obstacle (M5), shared with the browser
state.ts      LudoState, EngineAction, GameEvent, RefusalReason
engine.ts     create, controlled, legalMoves, apply (never throws)
standings.ts  placementsOf, trailingOf
```

`engines/ludo.ts` is the adapter behind the seam (`docs/games/00-engine-seam.md`): it draws the die,
deals the sides, composes the view and the log, and answers turn, autoplay, finish, standings,
engagement and tally.

```ts
interface LudoState
{
    v: 1;
    game: 'ludo';
    players: { seat: number; colour: LudoColour; pieces: number[]; out: boolean; side: number }[];
    turn: number;
    die: number | null;
    sixes: number;
    rev: number;
    winner: number | null;
}
```

- `players` is ordered by seat. `turn` is an index into it, never a seat number.
- `side` is who a player plays with. Each player is a side of its own in a free-for-all, and partners
  share one in a team game. The engine is handed the sides at `create` and never works them out:
  the pairing rule is `sideOf` in `match/sides.ts`, which `ludo/` may not import.
- `winner` is a side, not a seat and not an index.
- A piece is one integer, its progress from its own start square: `-1` is the yard, `0..50` the
  ring (the ring square is `(ENTRY[colour] + progress) % 52`), `51..55` the five home-lane cells and
  `56` (`FINISHED`) the triangle.
- `die` is the roll waiting to be moved, `null` when the next action is a roll.
- `sixes` counts the sixes rolled in the current turn.

**Actions** (`EngineAction`): `roll` (the adapter fills the die from the server's draw), `move` naming
one of the tokens the seat on turn controls, 0-3 (never a destination), and `forfeit` (`timeout`,
`resign`, `left`). The tokens a seat controls are its own, or its partner's once its own four are
home (`controlled`).

**Events** (`GameEvent`, the ledger): `roll { seat, die }`, `enter { seat, owner, piece }`,
`step { seat, owner, piece, from, to }`, `capture { seat, owner, piece, victim, victimPiece }` (one per
captured token: `piece` is the moving token, `victim` the captured token's seat, `victimPiece` its
token), `home { seat, owner, piece }`, `pass { seat, why: 'no-move' | 'three-sixes' }`,
`forfeit { seat, reason }`, `finish { side, seats }`. `seat` is always who acted and `owner` is whose
token moved; they differ only when a player whose four are home moves a partner's token. `finish`
names the winning side and every seat on it.

**Refusals** (`RefusalReason`, each with a status in `REFUSALS` in `match/refusals.ts` and a sentence
in `SAYS`; the word is the `code` of the answer): `not-your-turn`, `already-rolled`,
`must-roll-first`, `illegal-move`, `not-playing`, `game-over`.

**The board** (`ludoBoard`, what `view` composes; the same for every reader but for `moves`): each
seat's `colour`, `tokens`, tokens `home`, `out` and `side`; the `die` waiting to be moved; `moves`,
the reader's own legal tokens, empty unless it is their turn and they have rolled; and `controls`,
the seat whose tokens the seat on turn is moving. `controls` is the seat on turn, or its partner once
its own four are home, so a token named in `moves` is always one of `controls`' four. It is the
state's own answer (`controlled`), and the browser never works it out for the seat on turn.

---

## Turn order

1. `create` sorts the seats, deals the colours (S4), gives each player its side and starts at the
   drawn seat (S6).
2. The seat on turn **rolls**. On a six, `sixes` goes up; the third six passes the turn at once (T6).
3. If the roll has a legal move, `die` stays and the seat must **move** (T8). When no legal
   move exists, the turn passes (T5).
4. After a move: every token of the mover's side home ends the game (E1; in a team game that is all
   eight). Otherwise a six (below three) clears `die` for another roll (T3) and anything else passes
   the turn (T4).
5. Passing moves `turn` to the next seat clockwise that is not `out`, and resets `die` and `sixes`.

`turnOf` is the seat at `turn` while nobody has won; `turnKey` is `turn`, so a roll and the moves that
follow it on the same seat are one turn with one deadline.

---

## Lifecycle

1. **Table.** A two-, three- or four-seat table, `live` or `turns`; no target. A table of four is
   every seat for itself, or two against two when its opener asked (`tables.teams`).
2. **Start.** Every chair taken and ready; `POST /tables/:id/start` creates the match with
   `create(seats, first, sides)`, the sides from the table's variant.
3. **Play.** `POST /matches/:id/play` (or the socket's `play` frame) carries `{ kind: 'ludo', verb:
   'roll' | 'move', piece? }`, applied in one transaction under the match row's lock, with the
   idempotency key and the revision precondition.
4. **Timeouts.** The sweep plays an expired turn (X2), one miss per turn.
5. **Finish.** A win (E1) or the last opponent's forfeit (E3) sets `winner`. `finish` reports the
   winning seats, and after a forfeit the seats still at the table (`unsettled`) and those of them
   whose side was behind (`trailing`); `standings` reports the places (R1); the judge rates and pays
   (R2).
6. **After.** The board stays on screen; readiness is spent, and Play again asks every chair again.

---

## Invariants

The rules suite (`ludo-rules.spec.ts`) and the specs named below hold these. `ludo-purity.spec.ts`
plays forty random games at two, three and four seats and forty more two against two, and checks the
squares, the captures and who moves whose tokens after every action.

- `apply` never throws, never mutates its input, and moves `rev` by exactly one on every accepted
  action and never otherwise.
- Every player has exactly four pieces, each in `-1..56`.
- `die !== null` only when the seat on turn has a legal move: a roll with none passes.
- `sixes` is 0, 1 or 2 between actions.
- Every playable square on the ring or in a home lane holds at most one token.
- No token is ever sent home by its own side.
- The seat on turn moves its own tokens, and its partner's only once its own four are home. A token
  in the home lane or the triangle is never moved by an opponent.
- An `out` player's tokens are in the yard while the game goes on, and it is never on turn while
  anybody else is playing. The forfeit that ends a game leaves them where they stood (E3).
- Once `winner` is set, `die` is null and every action is refused with `game-over`. The winning side
  has every token home, or is the only side with nobody out.
- The engine imports nothing (`ludo-purity.spec.ts`); the wire cannot carry a die
  (`ludo-dice.spec.ts`); the board matches the art (`ludo-board.spec.ts`); every prediction the
  browser makes matches the engine over self-played games, every seat for itself and two against
  two (`helpers-ludo.spec.ts`).

---

## Known limitations

- **A quick search that says nothing can sit somebody at a table of two against two.** Quick play
  for ludo matches both kinds of table of four unless the search names one (`quickOf`), and opens
  the plain game when it finds none. The lobby, the header and the plates say which kind it is.
- **The rules are fixed.** `matches.variant` says only whether a game is a free-for-all (`standard`)
  or two against two (`teams`), and there are no per-table house rules: no capture bonus, no
  three-sixes penalty, no compulsory entry.
- **Places after the winner are read off the board**, not played out (E2, R1).
- **The first player is a server draw**, not a roll-off (S6).
- **Autoplay is not a strategy.** An expired turn moves the first legal token, which is fair but
  weak.
- **The server rolls and nothing proves it rolled fairly.** No commit-reveal exists, so the product
  claims only that the server rolls (`randomInt` from `node:crypto`, in the match service).

---

## Teams

**Two against two, at a four-seat table.** Whoever opens a table of four chooses it: the catalogue's
`partners` for ludo is `optional`, so the create form, the sheet that opens a table in a
conversation and a group's "Play together" each offer "4 players" and "2 v 2", and the engine plays
the one that was chosen (`4/teams` in `Engine.formats`). The game's own page says "2 v 2 at four" in
its hero, off the same `partners`, and has a fourth card for it.

It was researched on 2026-10-04 against the
sources above and a wider set (Schmidt's team variant *Einigkeit macht stark*, Masters of Games'
*Pachisi* and *Uckers*, Parchís tournament rules, پنکو's منچ گروهی). D24 established team play
and D25 uses the same forfeit policy as hokm. The clause numbers in this section refer to team rules.

| # | rule | basis |
|---|---|---|
| T1 | Four-seat tables only. | house rule (`tables_teams_four`, `matches_teams_four`) |
| T2 | Partners sit opposite: red and yellow (seats 0 and 2) against green and blue (seats 1 and 3), each 26 squares from their partner. | cited: [Schmidt] team variant "die beiden diagonal gegenüberliegenden Farben als Partner"; [faWP] «یاران باید روبروی هم بنشینند»; Pachisi, Uckers, Parchís |
| T3 | The rotation is unchanged, so the turns alternate between the sides. | cited: Pachisi, Parchís |
| T4 | You move only your own tokens until all four are home. | cited: Parchís, Uckers, پنکو |
| T5 | Then you stay in the rotation, and every roll of yours moves your partner's tokens. | cited: Parchís, پنکو, Pegs and Jokers |
| T5a | That starts at once: the roll earned by the six that brought your fourth token home already moves your partner's. | house rule (D24). Against: Uckers, which asks for a six first |
| T6 | Partners cannot capture or land on each other's tokens, including when entering from the yard. | [Plato], M5 |
| T8 | A token leaving the yard can land on an empty start square or capture an opponent there. A token of either partner blocks entry. | C4 |
| T9-T11 | Turn, movement and occupancy rules apply to the tokens the roller controls. | house rule (D24) |
| T12 | The side with all eight tokens home wins, the moment the eighth arrives. One player's four is a hand-over (T5), not an ending. | cited: [Schmidt] team variant "Gewinner ist das Partner-Paar, dessen acht Figuren zuerst ... stehen", Pachisi, Uckers, پنکو |
| T13 | Standings are by side: tokens home and then distance, each added up over both partners, and the pair shares the place. A side with a seat out is last. | house rule (hokm's shape) |
| T14 | A forfeit ends the match and the other side wins, with the board left as it stood (E3). Everybody still at the table is `unsettled`, and a seat whose side was behind on that board (fewer tokens home, or as many and less far round) is `trailing`. The judge decides from those facts as it does for hokm: the partner of somebody who walked out shares a trailing side's rated loss once both had played their share, and comes out `void` otherwise, a timeout included. | house rule (D24 and D25; `judge.ts`) |
| T15 | Tallies and XP are credited to the roller, the seat that acted, whoever's token moved (R3, R4). | house rule (D24) |

Partners may talk, in the table's chat and on its call, and nothing is hidden from anybody (X3);
Parchís tournament rules say the same of talking.

**Where each rule lives.** The engine is handed its sides and never works them out: the adapter asks
`sideOf` in `match/sides.ts` and passes the answer to `create(seats, first, sides)`.

- `controlled(state)` is T4, T5 and T5a: the seat on turn, or its partner once the seat's four are
  home. `legalMoves` and `move` act on that player's tokens, so the roll after a finishing six needs
  no rule of its own. `advance` is unchanged: a seat whose four are home is not `out` and keeps its
  turn.
- The engine and browser helpers use `obstacle` in `ludo/board.ts` to check occupancy.
- `obstacle` checks protection before a move. `captureAt` then captures the opponent on the legal landing square.
- A move ends the game when every token of the mover's side is home, and a forfeit ends it when one
  side is left with nobody out (T12, T14). `winner` is that side.
- `placementsOf` ranks sides and `trailingOf` names the seats behind (T13, T14). The adapter's
  `finish` reports `{ winners, unsettled, trailing }`: nothing unsettled when the winners' tokens are
  all home, and otherwise every seat still at the table.
- `tally` keys on `seat`, the actor, so T15 needs no code.

`ludo-rules.spec.ts` covers teams, `ludo-board.spec.ts` covers occupancy, and `ludo-purity.spec.ts`
checks every position across whole games. `judge.spec.ts` checks forfeits using the engine result.

**At the table.** The board says who plays with whom and whose tokens are being moved (`side` and
`controls`, under *State model*), and everything on screen reads those two.

- **The plates.** Every plate wears its side's mark, a disc in the two colours that play together.
  The reader's partner is tagged "Partner", the other two are "Opponent" to a screen reader, and
  somebody watching reads "Team 1" and "Team 2". The seat on turn is tagged "Helping" while
  `controls` is not that seat.
- **The strip.** A reader whose four are home is told "Your four are home: move {name}'s tokens."
  where it said "Your turn.", and the move list is headed "{name}'s tokens". Everybody else reads
  "{name} is moving {partner}'s tokens.", and the partner "{name} is moving your tokens."
- **The tokens that light up, and a tap.** The playable tokens are `controls`' (`seatsFor`), and a
  tap is a move only for the seat on turn, on a token of `controls` (`pick`).
- **The helpers** (`game/helpers/ludo.ts`). `movedTo`, `outcomeOf` and `pieceFor` act on
  `controls`. An entry occupied by either teammate offers no yard move (T8). The coach reads the tokens
  the reader controls. It explains an occupied or protected square before a move or after a pass,
  and tells the reader once when all four of their pieces are home.
  `helpers-ludo.spec.ts` holds that reading to `controls` over whole games.
- **The pieces.** Recorded stacks are still rendered. A win throws confetti in the colour of every seat that won.
- **The result** is read by side, as at any table of two sides.

`helpers-ludo.spec.ts` (*two against two*) and `game.spec.ts` hold the browser's half, and
`engine-seam.spec.ts` the board on the wire.
