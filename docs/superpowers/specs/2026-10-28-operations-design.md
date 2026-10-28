# Operations: the database and NuraChain checked against each other, and the server watched

The owner's production brief of 2026-10-28 (`linked-humming-stroustrup-production-brief.md`, §8):
"If on-chain state and backend state temporarily diverge, implement reconciliation and operational
alerting instead of silently assuming one side succeeded", with "persistent, auditable records".
Sections 1 and 2 are that, PB7's first part; section 3 is its second, monitoring and alerts (§9).
Security tests, recovery and the deployment documents are the parts after them.

## 1. What exists

Four families of money records, each written here and held by a contract of Arcade's, each moved by
a worker of its own that believes nothing it is told and asks the contract about the record by its
id (`main.ts`, every two or three seconds):

| Family | Rows | Contract, and its read | Worker moves | Final |
|---|---|---|---|---|
| A paid game | `escrows` | `ArcadeVault.gameOf(id)`: status, fee, stake, players | `locking`, `settling`, `refunding` | `open` until the game ends; `settled`, `refunded`, `reclaimed`, `failed` |
| A shop order | `shop_orders` | `ArcadeShop.saleOf(order)`: buyer, price, refunded | `quoted`, `sent`, a `failed` one in its lapse | `paid` (the owner may still refund it), `refunded`, `expired`, `failed` |
| A gift | `donations` | `ArcadeTips.tipOf(giver, id)`: receiver, amount | `prepared`, `sent` | `confirmed`, `reverted`, `expired`, `failed` |
| A market and its positions | `markets`, `market_positions` | `ArcadeMarkets.marketOf`, `positionOf` | open and closing markets, a settled one until its dispute window has passed, positions `prepared` and `sent`, a claim on its way | the other market states; positions `confirmed` (claimable until claimed), `reverted`, `expired` |

Each worker reads only the records it is still moving. Once a record leaves its hands nothing asks
the chain about it again, so a disagreement that arises later stays silent: a row changed by hand,
a payment the owner made straight to a contract, a player reclaiming stakes while the game is still
being played here, a block clock far enough behind that a gift lands after the worker let it go, a
contract redeployed under the server, or a contract holding less than it owes.

## 2. The design

**A reconciliation pass beside the workers** (`domains/reconcile/`, `jobs.reconcile`), once a
minute and thirty seconds after boot, one at a time in the process. Each family's own service
compares its records (an `audit` beside its worker, using the worker's own reads and writes), and
the reconcile service keeps what it finds. A record the family's worker is still moving is never
compared: the worker asks the chain about it every few seconds already, and a pair it cannot move
shows where it always did (the vault's stuck payments on Money, the workers' warn lines).

Every pair of what the two sides hold is one of four things, in a table per family
(`domains/reconcile/kinds.ts`, which imports nothing, so a spec holds every cell with no Postgres):
they **agree**; the pair is **the worker's**, which moves it on its next pass; it is **put right**,
through a worker's own function, because the chain is the authority and that function would write
exactly this; or it is **for a person**.

### 2.1 A paid game, against `gameOf`

| Here \ NuraChain | none | open | settled | refunded | reclaimed |
|---|---|---|---|---|---|
| `open` | person | agree | person | person | person |
| `settling` | person | the worker's | the worker's | the worker's | the worker's |
| `refunding` | person | the worker's | person | the worker's | the worker's |
| `settled` | person | person | agree | person | person |
| `refunded` | person | person | person | agree | person |
| `reclaimed` | person | person | person | person | agree |
| `failed` | agree | person | person | person | person |

`locking` is the worker's whatever the chain says. Wherever the chain holds the game, its stake,
fee and players in seat order must be the escrow's (`escrow-stakes`, for a person: a game under one
of this server's ids that it never locked). A `settled` game paid by a transaction whose hash is
kept has its winners read off that receipt's `Settled` event and held to the escrow's
(`escrow-winners`). Nothing is put right here: a vault game the chain resolved while the game is
still being played, or the other way round, is for the staff to end as no contest or look into, and
the stake worker follows on its own once they have.

### 2.2 A shop order, against `saleOf`

| Here | NuraChain | |
|---|---|---|
| `paid` | sold to that buyer at that price | agree |
| `paid` | not sold, or refunded | person: a look delivered with no payment the shop still holds |
| `refunded` | sold and refunded | agree |
| `refunded` | sold, not refunded, or not sold | person |
| `expired`, `failed` | not sold | agree |
| `expired`, `failed` | sold to that buyer at that price | put right: the shop worker's `deliver`, refunded or not as the sale is |
| any | sold to another buyer or at another price | person (`order-sale`): a quote this server never signed |

A refund the owner makes on the contract of an order delivered here is for a person: the shop
design says the worker takes the look back, and no worker does yet (Admin › Shop is not built), so
nothing here takes a look from anybody.

### 2.3 A gift, against `tipOf`

| Here | NuraChain | |
|---|---|---|
| `confirmed` | the gift prepared | agree |
| `confirmed` | nothing, or another gift | person: a gift counted here that the chain does not hold |
| `expired`, `reverted`, `failed` | nothing | agree |
| `expired`, `reverted` | the gift prepared | put right: the donation worker's `confirm`, which tells the player once |
| `expired`, `reverted` | another gift under the id | put right: the worker's `failed`, `mismatch` |
| `failed` | another gift | agree: the giver's own call, their NURA, nobody else's |

### 2.4 A market, against `marketOf`, and a position, against `positionOf`

A market past the worker's hands must be in the state the chain holds it in, with the same winner
(`market-winner`, for a person: the operator named another outcome, which is what the owner's
dispute window is for) and, settled, the same claim time (`market-claimable`). A settled market the
chain holds as cancelled is one the owner overturned while the worker was not asking (the server
down through the window): put right through the worker's `resolve`. Every other state apart is for a
person (`market-state`).

| Position here | NuraChain | |
|---|---|---|
| `confirmed` | that ticket as prepared | agree, and then the claim: |
| | claimed, with no claim of this server's on its way | put right: written claimed as the claim route writes a claim it never saw (`PAID_UNSEEN`) |
| | not claimed, though claimed here | person (`position-claim`) |
| `confirmed` | nothing | person: a stake counted here that the chain does not hold |
| `reverted`, `expired` | nothing | agree |
| `reverted`, `expired` | that ticket as prepared | put right: the market worker's `confirm` |
| any | another position under the ticket | person (`position-ticket`): a ticket nobody here signed, which the worker refused as `mismatch` and said only as a fault |

### 2.5 The contracts' own books

Each pass reads `solvent()` on the vault, the shop and the markets contract, with what each holds
and owes, all at one block. One that does not hold what it owes is for a person (`solvency`).
`ArcadeTips` holds nothing: a gift passes through the call that makes it.

### 2.6 Recorded, raised and resolved

**A row of `discrepancies`** for each disagreement: the family, the record (its id, or the
contract's name), the kind, what each side says (`db` and `chain`, small objects of words the page
translates: a state, an amount, an address, seats, a time), what the page shows about the record
(`about`: the game, the amount, the people, a transaction), first and last seen, and resolved when
and how. One open row per record and kind; while it lasts, each pass that meets it again moves
`last_seen` and keeps what the two sides say now. A disagreement put right is a row too, found and
resolved in one pass, so every money record this pass changed is written down.

**Raised**: a `warn` line when one is found, when one is resolved, and when a person closes one (a
line of its own, because a person closing one is not the two sides agreeing); the admin overview's
"Needs you" counts the open ones for a role that opens Money and leads to `/admin/money/checks`,
which lists them (what each side says, first and last seen) and the closed ones.

**Resolved** three ways: `agreed`, when a pass finds the two sides agree (the staff ended the game,
the owner funded the contract, the row was mended); `put-right`, when this pass wrote it through a
worker; and `staff`, when an admin or the owner closes it with a reason, which writes a staff action
(`check`) in the same transaction. A disagreement a person closed stays closed for as long as the
two sides say exactly what they said when it was closed; if either moves, it is a new row.

### 2.7 Decisions

| | Decision | Taken | Not chosen |
|---|---|---|---|
| OP-D1 | What is compared | every record no worker is moving that can still change on the chain (a game being played or paying, a paid order, a confirmed position that can still be claimed: in a market not settled, a winner's, or any while the owner may still overturn its market) or that is a week old or newer, and each contract's solvency | every record ever on every pass; the records the workers are moving, which they ask about every few seconds |
| OP-D2 | How often | a pass a minute, the first thirty seconds after boot; fifty records a family each pass, newest first by keyset, starting again at the newest once a family's list runs out; every open disagreement's record read again each pass, fifty a family | a pass on every worker pass; a full scan a pass |
| OP-D3 | What is put right | only what the chain is the authority on and a worker's own function already writes: an order the shop sold (`deliver`), a gift or a position the chain holds as prepared (`confirm`), a gift the chain holds differently (`failed`), a market overturned while nobody asked (`resolve`), a claim this server never saw (the claim route's own write) | the reconciler writing any state of its own; a second copy of any worker's rule |
| OP-D4 | What only a person decides | money counted here that the chain does not hold; a record under one of this server's ids that it never prepared; a state the chain moved that no worker follows; a contract short of what it owes | taking a look back, ending a game, or refunding anything from here |
| OP-D5 | Who closes one | an admin or the owner (`money`), with a reason, logged | a moderator; closing without a reason; the owner alone |
| OP-D6 | A closed one | stays closed while both sides say what they said when it was closed | closed for ever; reopened at every pass |
| OP-D7 | Calm | a chain that cannot be reached stops that family's pass and is no disagreement; a record the database no longer holds is not compared; a fault is logged once while it is the same; nothing it does sends a transaction or holds a lock past one row's write | alerting on a chain that is down (that is monitoring's, the next part) |
| OP-D8 | Not compared, stated | records under ids this server never wrote (the contracts' events from their deploy block, which no bounded read pages); the winners of a game whose paying transaction's hash was lost; what a claim paid (the worker reads it off its receipt); gifts' books (none) | |

**What it costs**: per pass at most fifty `eth_call`s a family, the open disagreements' records again,
one receipt a settled game, and three contracts' books at one block: a few hundred reads a minute
at the most, through the same bounded client as every other read (four seconds a call), and nothing
a request waits for. A row per disagreement, kept for good.

## 3. Part 2: the server watched, and alerts a person can act on

The brief's §9: "Add monitoring for WebSocket health, spectator delivery latency, error rates, event
backlog, market transitions, failed deposits, settlement delays, payout failures, and reconciliation
problems. Provide appropriate dashboards, metrics, structured logs, and actionable alerts, using the
project's existing observability stack where possible." And §8: the sockets are not the source of
truth, and a restart or an outage must not corrupt state.

### 3.1 What exists, and what is built on it

The JSON log (`main.ts`, every request through `app.ts`'s request log, each worker's info, warn and
error lines, part 1's `chain and database disagree`); `http/ops.ts`, the requests and failures of
the last hour in a ring of sixty minutes and the last fifty failures; the overview's "This server"
for a role that opens `health` (uptime, memory, the event loop, the pool, the sockets open, the
hour's requests and failures); the vault panel's payments stuck on the way (`STUCK_MINUTES`, ten);
part 1's open disagreements, counted in "Needs you". Part 2 grows these, never beside them: the
request ring learns route families, "This server" learns the new measures, "Needs you" lists the
alerts, and the stuck payments and the disagreements become alerts of their own, raised and cleared
in the log, keeping the rows "Needs you" already draws for them.

### 3.2 What is measured, from what, kept how

Every measure is taken from the event itself, in this process's memory, bounded by its shape; what
only the database knows is read from it once every thirty seconds (`SAMPLE_MS`), by indexed queries
over the rows still in flight. Nothing is estimated and nothing is written.

| Measure | Taken from | Kept |
|---|---|---|
| Sockets open | `hub.size()` | now |
| Sockets opened, and closed by code | the gateway's `onConnection` and `onClose(code)`; a code is one of 1000, 1001, 1005, 1006 (a missed pong among them), 1011, 4400, 4401, 4413, 4429, or `other` | a ring of sixty minutes, and totals since the process began |
| Upgrades refused, by why | the gate counts its own refusals (`origin`: none, or not ours; `budget`: the handshake budget; `cookie`: no session); one at the ceiling (`SOCKETS_MOST`, answered 503 by the package before the gate) is an upgrade on `/ws` the gate never saw, counted by a listener of our own beside the package's | the same |
| The deepest outbox | every socket's waiting frames, read at the sample | now |
| Spectator delivery | each `watch` frame for each watcher: from the move's commit (stamped as the move is pushed) to the frame handed to that socket | five minutes, a minute at a time, as counts per whole millisecond under a second and per ten above (at most sixty seconds): p50, p95 and p99 by nearest rank, exact to that grain |
| Requests and failures by family | the request observer: the first segment after `/api/` when it names one of the api's eighteen features, `other` for any other `/api` path, `pages` for the rest; a failure is a 5xx | the hour's ring, by family, and totals |
| The workers' backlog | the database: positions to confirm (`sent`), claims to read (handed in, not read), orders on their way (`sent`), gifts on their way (`sent`), paid games locking, paid games paying (`settling`, `refunding`), markets to settle (`open` or `closing` with their game over and their close passed) | each queue's count and the age of its oldest, at the sample |
| Market transitions | the market worker's tally at each pass (settled, refunded, cancelled, expired, empty; positions placed, refused, lapsed, claimed) | the hour's ring, and totals |
| Failed locks | the stake worker's tally (`failed`) | the hour's ring, and totals |
| Workers failing | each worker's faults at each pass, by record: a record leaves the set at the first pass it does not fail | the records failing now and since when, and how many faults since the process began |
| Payments stuck | the vault panel's own rule: a paid game locking or paying for ten minutes, or with an error | the count, at the sample |
| Disagreements | part 1: those open, and the oldest one's first sighting | at the sample |
| NuraChain out of reach | part 1's pass: the families it could not reach (503) | the last two passes |

A claim's age needs when it was handed in, which no column held: `market_positions.claim_sent_at`,
written with the claim's hash. A deposit is the player's own transaction to the vault, which this
server never sees; what it sees is a lock that cannot take a seat's stake because the deposit no
longer covers it, and that is the failed lock counted here.

### 3.3 The alerts, their thresholds, and what to do

Each alert is judged at every sample by one pure function (`ops/measures.ts`, which imports nothing
and both halves read), against the numbers below. Thresholds are constants in that file, never
`.env` names: the house holds the `.env` to what only the operator can know.

| Alert | Crosses when | Level | For | Why that number | What the operator does |
|---|---|---|---|---|---|
| `sockets-full` | an upgrade refused at the ceiling in the last 10 minutes | warn | health | `SOCKETS_MOST` (4,000) is a third over the brief's 3,000 and was measured clean; one refusal is somebody turned away | One server per database is the design: see who holds the sockets; raise the ceiling only after a load run on that machine |
| `sockets-behind` | 10 or more sockets closed for falling behind (4413) in 10 minutes | warn | health | a socket 256 frames behind is one phone on a bad line, and one now and then is that; ten in ten minutes is the server, or a crowd on one game | Spectator delivery and the event loop beside it |
| `watch-slow` | spectator delivery p95 at or over 1,000 ms over 5 minutes, from at least 50 frames | warn | health | measured p95: 13 ms with twenty games watched, 225 ms with 2,998 watching one game; a second is over four times the worst measured, a board visibly behind its players | The event loop and the audience; one game with thousands watching |
| `errors`, by family | 10 or more 5xx in a family in 10 minutes, or 5% or more of at least 20 requests | warn | health | a 5xx is always ours: one may be a client hanging up mid-request, one in twenty is not | The last failures, the server's error lines, the pool |
| `backlog`, by queue (positions, claims, orders, gifts) | the oldest waiting 10 minutes or more | warn | health | a transaction the chain has taken is read back within one pass, two or three seconds; ten minutes is two hundred passes: a chain not mining, or a worker not moving | Is NuraChain reachable and mining; is the worker running (its own warn lines); the referee's gas |
| `payments-stuck` | one or more paid games stuck by the vault panel's rule | error | money | the vault panel's own ten minutes: a lock or a payout is one transaction | Money: the referee's gas, a paused vault; the stake worker's warn lines |
| `markets-late` | a market due and not settled for 10 minutes or more | error | money | a settlement is one transaction the worker sends within a pass | Money: the referee's gas; the market worker's warn lines |
| `locks-failed` | 3 or more stakes failing to lock in an hour | warn | money | one is a player who withdrew between Ready and the lock; three in an hour is a paused vault, a referee short of gas, or a fee changed under signed Readies | Money: paused, gas, fees |
| `workers-failing`, by worker (stakes, markets, shop, gifts) | a record whose step has failed at every pass for 2 minutes | error for stakes and markets, warn for shop and gifts | money | a refusal the chain clears passes at the next pass, two or three seconds later; two minutes is forty passes | The worker's own warn line names the record and the error |
| `chain-down` | NuraChain could not be reached at two reconciliation passes in a row | error | money | one pass out of reach is a blip a retry absorbs; two is two minutes in which nothing settles | The RPC (`NURA_RPC_URL`), the network |
| `checks-open` | one or more disagreements with NuraChain open | error | money | every one is a money record the chain disagrees with; there is no harmless number | Money › Checks against NuraChain |

**Raised and cleared.** When an alert crosses, one structured line at its level, `alert raised`, with
the alert, what it is about (a family, a queue, a worker), the value and the limit; when it clears,
one line, `alert cleared`, at the same level, so a filter on the level sees both. Nothing is said
per request or per pass: the monitor holds the alerts standing, with since when, and compares each
sample's judgement with them. A restart forgets them, and the first sample after it raises again
what still holds, one line each.

**Never the source of truth.** The monitor reads; it writes nothing anywhere, holds no lock and
sends no transaction. A restart, an outage of NuraChain or of the database, or sockets lost cost it
its memory and nothing else, and every measure is again what it was within a minute of the first
sample (the hour's counts start again).

### 3.4 Shown

**"This server"** (`health`) grows: the sockets of the last hour (opened, closed by code, refused by
why) and the deepest outbox; spectator delivery (p50, p95 and p99 of the last five minutes, and how
many frames); requests and failures by family over the hour; the queues, each with its count and
its oldest; the market transitions of the hour. **Money's own measures** (`money`): the stuck
payments, the markets late, the failed locks of the hour, the workers failing, NuraChain's reach and
the disagreements with their oldest. A measure that crosses its threshold is drawn in danger.
**"Needs you"** lists every alert standing that the reader's role opens, in the reader's words, each
leading to where it is dealt with; the stuck payments and the disagreements keep the rows they
already had. Every word in ten languages.

**The machine endpoint**, `GET /api/metrics`, answers the Prometheus text format (0.0.4) to a caller
that sends `Authorization: Bearer` and the token the operator names in `METRICS_TOKEN`: a name in
`.env.example`, written as every name is and required like them, empty meaning the endpoint is off;
`loadServerConfig` refuses one under 32 characters in any mode. Anybody else, and everybody while
it is off, is answered as a page that is not there, the same bytes, the token compared in constant
time. It reads the monitor's memory and the latest sample and never the database, so a scraper
costs a request. Gauges for what is now, counters since the process began for what is counted, and
one series a standing alert.

### 3.5 Decisions

| | Decision | Taken | Not chosen |
|---|---|---|---|
| OP-D9 | Where measures are kept | this process's memory, bounded by shape (an hour of minutes, five minutes of delays, the records failing now); the database read every thirty seconds for what only it knows | a metrics library for what a few hundred lines do; writing measures to the database |
| OP-D10 | Percentiles | exact by nearest rank from counts per millisecond (per ten above a second) over five minutes | a sample of the frames; buckets too coarse to say 225 ms |
| OP-D11 | Thresholds | constants in one pure file both halves read, each with its reason | `.env` names an operator would tune on one machine |
| OP-D12 | Alerts | judged at each sample, one line when raised and one when cleared, at warn or error, held in memory | a line per request or per pass; alerts written to the database |
| OP-D13 | The endpoint | Prometheus text behind one bearer token the operator names, off while empty, refused under 32 characters, everybody else answered as a missing page | an address allowlist (the proxy's job); the admin's session (a monitor holds no wallet) |
| OP-D14 | Who sees what | the server's measures and alerts for `health`, the money's for `money`; "Needs you" the alerts the reader's role opens | everything for every member of the staff |
| OP-D15 | A failed deposit | the lock that cannot take a seat's stake, which is what this server sees of a deposit | asking the chain about deposits it never handled |
| OP-D16 | A claim's age | `claim_sent_at`, written with the claim's hash | the position's own creation, which says nothing about the claim |

**What it costs**: a sample is nine indexed queries every thirty seconds; the rings are a few thousand
numbers; a frame's delivery is one map increment; the endpoint and the overview read memory.

## 4. As built: the server watched

As designed in part 3, with these differences.

- **A sample asks its questions one after another.** The design's nine queries every thirty seconds
  run on one pooled connection in turn (`ops/sample.ts`), so the monitor never holds more than one
  of the pool's connections, whatever a request is waiting for.
- **The endpoint is the last wrapper round the app**, inside the rate limiters, so a guess at the
  token is metered like any other request; a request without it is handed on and answered by the
  router as an address nothing is served at.
- **What this server does not run is absent, never null.** The monitor's two reads give the wire's
  shape: a vault's stuck payments, the markets due and the disagreements are left out where there
  is no vault, no markets contract or nothing reconciled, and the overview draws only what it is
  handed.
- **"Money on its way" is a wrapping row.** Which of its tiles it has is what the server runs (two
  to five), so a grid of three left empty cells beside the last; each tile grows to fill its row,
  and the workers' row stands under them whole.
- **The Persian counts read number first** («۱۳ درخواست · ۰ خطا», «۲ تا منتظره»): a noun after a
  number is singular in Persian, so the label-first form the other languages use to keep clear of
  plurals is not needed there, and «درخواست ۱۳» reads as request number thirteen.

**Held.** The specs `.claude/rules/operations.md` lists (*The server watched*), each feature's faults
caught one at a time (the monitor 72 of 72, the endpoint 14 of 14, the overview 28 of 28, the walk's
fixes 4 of 4), and `tools/qa/ops-pass.mjs` over the built server and a local chain: 28 of 28, and 13 of
28 against a build broken four ways. On this machine the backlog the pass writes was raised by the
first sample after boot and cleared by the next, and NuraChain out of reach by the second
reconciliation pass after the node stopped. Walked as the owner at 1280 in English and 390 in Persian,
an alert's row taking the keyboard to its panel, the consoles clean.

**For whoever runs it**: `METRICS_TOKEN` is a name every `.env` writes, empty while nothing scrapes
the server and at least 32 characters once something does.
