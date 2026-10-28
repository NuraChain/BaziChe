# Live watching, NURA donations and markets: what exists, and the design

The owner's production brief of 2026-10-28 (saved beside the plan as
`linked-humming-stroustrup-production-brief.md`) asks for: a Watch that is live, the realtime socket
audited and load-tested toward 3,000 clients, NURA donations to the players a spectator watches,
markets on games that many spectators back with different outcomes and stakes, NuraChain contracts
where escrow needs them, and the operations around all of it. This is its first phase: the
architecture as it is, read in the code, with the cause of the delay found before anything changes,
and the design every later phase builds. Each decision below is a default the owner can overturn.

## 1. What exists (read in the code, 2026-10-28)

**Games.** A table is a row of chairs (`domains/table/`); a game is a `matches` row with a revision,
the engine's state as jsonb, and one `match_actions` row a revision holding the events the engine
wrote and the state after them (`domains/match/service.ts`). Engines are pure (`engines/*.ts`): every
play is checked by the engine under the match row's lock, never by the browser. A game finishes in
the same transaction as its last play: `finished_at`, `outcome` (`won`, `drawn`, `abandoned`, held by
`matches_outcome_known`), `winner_seat`, and a result on every seat in `match_players`. The staff can
end a game as no contest (`voidIn`: every seat `void`, `voided: true` in the state).

**Players, sockets and rooms.** One process holds every socket (`realtime/hub.ts`, the "one server
per database" rule in `.claude/rules/games.md`). A socket is admitted by the session cookie and the
origin (`realtime/admit.ts`), is limited per account (`SOCKETS_PER_ACCOUNT` 16), per process
(`SOCKETS_MOST` 2000) and per address (`HANDSHAKES_A_MINUTE` 300, `handshake-limit.ts`), is pinged
every 15 s by the server (`HEARTBEAT_MS`) and probed by the page after 10 s of silence. Frames are
JSON with a per-socket ordinal `n` stamped when they are decided; each socket has an outbox
(`OUTBOX_FRAMES` 256, `OUTBOX_BYTES` 256 KiB) and a socket that falls that far behind is closed 4413
rather than silently dropped, so the page reconnects and reads what it missed. Inbound frames are
floored and budgeted per kind (`FRAME_FLOORS`, `FRAME_BUDGETS`). There is no pub/sub between
processes: presence, doorbells, game pushes, voice and parties are this process's memory.

**A move, end to end.** `POST /matches/:id/play` (or a `play` frame) runs the engine under the row
lock; after commit `services.ts` reads the new actions (`match.feed`) and pushes each seated player a
`game` frame with their own view and their own events (`gamePushed`), and rings the table's
watchers (`gameWatched`).

**Watching.** A watcher is anybody who read the table (`tableViewed`, the newest four tables a
person looked at). `GET /matches/:id/watch?rev=N` (`watch.ts`, `services.ts`) answers the board and
the events since `N`, for a watchable table only (`watchableTable`: never a private one). What a
watcher sees is the engine's view for no seat and the events as no seat may read them
(`engine.view(state, null)`, `engine.log(events, null)`): no hand, no hole cards, no glimpse.
`redaction.db.spec.ts` holds that a watcher is told nothing secret.

**NURA.** NuraChain, chain id 1020, whose native coin is NURA (18 decimals, `data/chain.ts`); the
server reads it through one bounded viem client (`chain/rpc.ts`). The browser's wallet sends every
transaction; the server composes unsent calls and never holds a player's NURA. Three contracts are
Arcade's (`SmartContract/contracts/baziche/`): `ArcadeVault` (stakes at paid tables, a referee key
signing results, deployed 2026-10-24 at `0x2743…F6CB`), `ArcadeShop` (looks, quotes signed by the
server, orders read back by id, not yet deployed), `ArcadeAchievements`. A purchase's pattern is the
model for anything paid here: the server writes an order, signs what the contract must check,
hands the wallet the unsent call, and a worker asks the contract about the order by its id
(`saleOf`), so a lost hash or a replaced transaction loses nothing. The same repository holds a
vendored prediction-market system (`contracts/forecast/`, see 5.2).

**Who may play for NURA.** A wallet account, not marked under 18, that accepted the terms of paid
play, not on a break (`domains/stake/policy.ts`: `paid_accounts`, `BREAK_DAYS`). The same gates are
the floor for donations and markets.

**Jobs, transactions, operations.** Self-rescheduling sweeps in `main.ts` (turns, tables, the vault
worker, the shop worker, suspensions); every money change is one transaction with its row locked;
advisory locks where no row exists yet. Requests are logged as JSON lines; `http/ops.ts` keeps the
last hour of requests and failures, the event loop's busy share and the pool, shown to the staff in
the admin's Overview. Deployment is one process behind nginx (`README.md`, `scripts/service-*.sh`,
the Docker image), the schema built from the entities (`npm run schema:sync`), no migrations.
Tests: vitest in both halves, database specs on a disposable Postgres, and hand-run passes in
`tools/qa/` (among them `latency-pass`, `load-pass`, `realtime-pass`, `sync-pass`).

## 2. Where the thirty seconds come from

Three places, all on purpose, and nothing else adds to them:

1. **The board a watcher is shown is the newest at least 30 s old**: `WATCH_DELAY_MS = 30_000` in
   `domains/match/turns.ts`, applied in `watch.ts` as `a.created_at <= now() - 30 s` (Postgres's
   clock), except the opening.
2. **Watchers are rung 31 s after a move**: `gameWatched(..., WATCH_DELAY_MS + 1000, ...)` in
   `services.ts`, a `setTimeout` in the hub.
3. **The watch page also reads every 30 s** (`WATCH_POLL_MS`, `stores/watch.store.ts`).

The page tells a watcher why: "Everyone watching is behind by the same amount, so nobody can be
coached from the sidelines" (`watch.why`). That reason does not hold here. A watcher is shown
strictly less than the player they would coach (no hand, no hole cards), and anybody who wants to
coach a player can watch that player's own screen; the delay protects nothing a player cannot
already get, and it costs every honest watcher the game. **LW-D1: the delay goes, at every table.**
What a watcher may see is unchanged and stays the engine's view for no seat.

## 3. Toward 3,000 sockets

What holds today, and what the measurements must decide:

- `SOCKETS_MOST` (2000) refuses the 2001st socket in this process: the target needs it raised, to
  what the measured memory per socket allows.
- The handshake limit (300 a minute an address) is per address, as it should be in production; a
  load generator on one machine is one address, so it names its clients by `X-Forwarded-For`, which
  this server trusts only in production behind its proxy (`trustProxy`): a local test server, never
  a public one.
- One process holds every socket; a second would not see the first one's watchers. The networking
  audit (2026-10-15) measured 400 sockets at 200 tables, the knee between 100 and 200 tables, with
  the event loop, the pool of ten database connections and the database on the same machine not
  told apart. A new service (pub/sub between processes) comes only if the measurements show one
  process cannot hold the target.
- A broadcast to many watchers is serialised once per socket today (`emit` stamps `n` inside the
  JSON): measured before it is changed.

The pass (`tools/qa/crowd-pass.mjs`, PB3) runs clients in a process of its own: a ramp of 100, 500,
1,000, 2,000 and 3,000 sockets, many games with watchers, one game with a crowd, moves while the
crowd watches (move to frame latency, p50, p95, p99), a reconnection storm, slow clients that do
not read (the outbox closes them, nobody else waits), and a soak; server memory, the event loop's
busy share and its longest wait, sockets open, frames sent, failures, and every frame's revision
checked for loss and duplication. It reports what this machine sustained and what limited it.

## 4. Donations

A watcher gives NURA to a player of the game they watch.

- **DN-D1 A contract forwards it and records it by an id.** `ArcadeTips.tip(id, to)` (payable,
  `contracts/baziche/`) sends the whole value to `to` in the same transaction and records
  `{ from, to, amount, at }` under `id`, refusing an id already used. The contract never holds NURA
  past the call and takes no fee. The server confirms a donation by asking the contract about its
  id (`tipOf`), never by a hash the page reports, so a transaction the wallet replaced (sped up,
  re-priced) is found all the same, and an id can be paid once. A plain transfer could only be
  confirmed by its hash.
- **DN-D2 Who.** A wallet account that may play for NURA (adult, terms accepted, not on a break)
  gives to a player who has a wallet, is an adult, is seated in a game the giver may watch, and has
  not turned donations off (`acceptDonations`, Settings, on by default). Nobody gives to themselves.
  A minor neither gives nor is offered.
- **DN-D3 How much.** Presets of 1, 5, 10, 25, 50 and 100 NURA or an amount between 1 and 1,000
  NURA; the giver's wallet is asked first whether it holds that much, as the shop does.
- **DN-D4 The steps.** Preparing (the server writes the donation and its id), the wallet (the review
  says who receives it, how much NURA, NuraChain and the network fee, before the wallet is asked),
  pending on NuraChain with the transaction, then confirmed once the contract says so, or rejected
  (the wallet said no), reverted, or failed (gone past its deadline). Retrying a donation that was
  never sent reuses its id; one that reverted gets a new id. A donation and a wager never share a
  table, a route, a word or a contract.
- **DN-D5 Told.** Once confirmed, the receiver gets a notification (`donation`, "{who} sent you
  {amount} NURA") and the table's watchers see it in the table's chat line. History: what a person
  gave and received, each with its transaction, on their wallet page.

## 5. Markets

### 5.1 The model

A market is one question about one game, its outcomes, a pool for each outcome and positions in
them. **Many people, many outcomes, unequal stakes; nobody is matched with anybody.**

- **MK-D1 What is asked.** "Who wins?" with one outcome a seat, or a side at a game of two sides,
  and a draw where the game can end in one (chess). The outcomes are the game's own and are fixed
  when the market opens.
- **MK-D2 When it opens and closes.** A market opens on a game as it starts, at a public live table
  of a game whose rules allow markets, and takes positions for its opening window
  (`MARKET_WINDOW_MS`, 90 s, policy) and never after; the game's own pace means nobody can know the
  result in that time, and every bettor sees the same live board (LW-D1). There is no betting after
  the window and no fixed-odds market.
- **MK-D3 A position.** One outcome, one stake in NURA, one bettor; a person may hold several.
  A position is a ticket the server signs for that bettor, market, outcome and exact amount with a
  deadline; the contract takes no stake without one. That is how eligibility (below) is enforced on
  the chain and not only in a page.
- **MK-D4 Limits are policy, in one module** (`domains/market/policy.ts`): the most a position
  (500 NURA), the most one person in one market (1,000), the most a pool (100,000), the fewest
  distinct bettors for a market to stand (2), the fewest backed outcomes (2). Nothing in the schema
  or the contract assumes two of anything.

### 5.2 The contract, and why a new one

`contracts/forecast/` already has a pari-mutuel pool (`PredictionPool`, one EIP-1167 clone a market,
2 to 16 outcomes, native collateral, signer-quorum resolution, refunds on cancel, pull claims). It
was weighed and not chosen:

- a resolved pool whose winning outcome nobody backed pays nobody and is swept to the treasury when
  the claim window closes, which keeps the bettors' money (the brief: refund instead);
- unclaimed winnings are swept to the treasury too;
- every market is a deployment the server's key pays for, bet on or not;
- anybody can bet on any open pool with no ticket, so no eligibility rule reaches the chain;
- it is vendored without its tests ("Tests ... live in the original project").

**MK-D5 `ArcadeMarkets`** (`contracts/baziche/`, the Arcade conventions: AccessControlDefaultAdminRules,
Pausable, ReentrancyGuard, EIP712, custom errors, not upgradeable): one contract, many markets.

- A market's terms (its id, the game, the number of outcomes, the close time, the fee, the limits,
  the fewest bettors) are hashed; the first ticket of a market brings the terms and the contract
  stores them once, every later ticket names the same hash. So nobody pays to open a market nobody
  bets on.
- `place(ticket, signature)` takes exactly the ticket's amount, before the close, signed by the
  operator (the server's key), for the sender only, once (the ticket's id), within every limit.
- `settle(market, outcome)` by the operator after the close, from the game's recorded result
  (5.4). `cancel(market)` by the operator for a game that ended with no result. Anybody can expire a
  market the operator never settled, a week after its close: then it refunds.
- **Claims are pulled, a position at a time or many in one call**, and never a loop over every
  bettor. A winning position is paid its share of what is left: `payout = left × stake / backingLeft`,
  in wei, with `left` and `backingLeft` falling as each is paid, so the last winner is paid the
  exact remainder and no unit is left over. A refund is the stake.
- A market whose winning outcome nobody backed, whose bettors are fewer than its fewest, or which
  only one outcome was backed in refunds every position in full and takes no fee.
- The fee is a term of each market, capped on the contract (5%), and **0 by default** (MK-D6): no
  fee is taken until the owner sets one.
- The invariant every test runs: the contract's balance is at least the stakes of every unsettled
  market, plus every unpaid payout and refund, plus fees not withdrawn.

### 5.3 Accounting rules, all of them

| Case | What happens |
|---|---|
| A seat or side wins and somebody backed it | its backers share the pool less the fee, by stake |
| Nobody backed the winner | every position is refunded, no fee |
| A draw, offered as an outcome | as any outcome |
| A draw where none was offered (a game that cannot draw) | not possible; a result the outcomes do not name cancels |
| Fewer bettors than the fewest, or one outcome backed | refunded, no fee |
| The game abandoned, voided by the staff, or a walkout with no winner | cancelled, refunded |
| The result never settled (server down) | anybody expires it a week after the close: refunded |
| A ticket past its deadline, or a stake after the close | refused by the contract; nothing taken |
| A deposit sent but not mined, or reverted | no position; the page says so; nothing to refund |
| A position the server has not yet seen on the chain | shown as pending, never in the pool totals |

### 5.4 From the game's result to the chain

The result is the server's own: the match row the engine finished under its lock. The settlement
worker reads finished matches that have an open market, maps the result to an outcome
(`outcomeOf(match, market)`, pure, specced against every result kind), and sends `settle` with the
operator key; it is idempotent (the contract refuses a second settle), retried, and reconciled
(every settled market's on-chain outcome is compared with the database's). The contract cannot
check a game's result itself and the documents never say it does: it trusts its operator, the key
that already signs results for paid tables, and that trust is bounded by the expiry (refunds) and
by the operator being unable to move a stake anywhere but to the market's own bettors.

### 5.5 Who may bet, and the law

**MK-D7 Markets are off unless the operator turns them on**: `NURA_MARKETS_ADDRESS` (the contract)
and `MARKET_REGIONS` (country codes where they are allowed) in the root `.env`, both empty by
default. Wagering on game outcomes is gambling under most legal systems, prohibited outright in some
(Iran among them) and licensed in others; **only qualified legal advice for the countries of launch
can decide where it may be offered**, and nothing here decides it. The server reads the country
from a header the proxy sets (`MARKET_COUNTRY_HEADER`, for example `cf-ipcountry`) and refuses
anybody whose country it cannot read or is not listed. A bettor must also be: an adult, a wallet
account, past the terms of paid play and a market disclosure, not on a break (the existing
self-exclusion, a day, a week or a month), and not seated at the table of the game (nobody bets on a
game they play). Limits per position, market and day (MK-D4); every position, ticket and settlement
is a row kept for good.

## 6. Operations

Metrics the admin's Overview gains: sockets open, watchers, frames a second, the move-to-watcher
latency of the last hour, outboxes closed for falling behind; donations pending, confirmed and
failed; markets open, closed, settling, settled, and any whose on-chain state disagrees with the
database (reconciliation, every minute, alerting in the log and in "Needs you"). Every new name in
`.env.example` with its sentence; `loadServerConfig` refuses a half-configured feature (a markets
address with no regions, or the other way round). Deployment, rollback and recovery in `README.md`
and `docs/operations/`: contracts deployed only by the owner's key (nothing here touches a real
chain or real money), the schema sync, the backup before it, and what to do when the chain is
unreachable (workers wait and catch up; nothing is lost because everything is read back by id).

## 7. Phases

- **PB1** this document.
- **PB2** live watching: the delay removed, the watch pushed (`watch` frames with the public view
  and the move's events, a gap read back), the poll a fallback, the page's words, a latency pass.
- **PB3** the socket audit and `crowd-pass.mjs`, limits raised to what is measured, fixes, numbers.
- **PB4** donations: `ArcadeTips` with its tests, the server (`domains/donate/`, worker, routes,
  notification), the browser (a Support button on each player of a watched game, the sheet, the
  history), a pass on the local chain.
- **PB5** markets off-chain: the model, tickets, routes, the worker, the realtime pool, the pages.
- **PB6** `ArcadeMarkets` with its tests, fuzz, invariant, coverage and an adversarial read; the
  server's half of the chain.
- **PB7** observability, reconciliation, security tests, deployment documents.
- **PB8** end-to-end passes on the built server and the local chain, the report.

## 8. What only the owner can give

A funded deployer key and the decision to deploy `ArcadeTips` and `ArcadeMarkets` on NuraChain (as
for `ArcadeShop`); the production referee key's address as the operator; legal advice before
`MARKET_REGIONS` is written anywhere; and the fee, if any, markets should take.
