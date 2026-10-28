# Operations, part 1: the database and NuraChain, checked against each other

The owner's production brief of 2026-10-28 (`linked-humming-stroustrup-production-brief.md`, §8):
"If on-chain state and backend state temporarily diverge, implement reconciliation and operational
alerting instead of silently assuming one side succeeded", with "persistent, auditable records".
This is that half of PB7. Monitoring, security tests, recovery and the deployment documents are the
parts after it.

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

**Raised**: a `warn` line when one is found and when one is resolved; the admin overview's "Needs
you" counts the open ones for a role that opens Money and leads to `/admin/money/checks`, which
lists them (what each side says, first and last seen) and the closed ones.

**Resolved** three ways: `agreed`, when a pass finds the two sides agree (the staff ended the game,
the owner funded the contract, the row was mended); `put-right`, when this pass wrote it through a
worker; and `staff`, when an admin or the owner closes it with a reason, which writes a staff action
(`check`) in the same transaction. A disagreement a person closed stays closed for as long as the
two sides say exactly what they said when it was closed; if either moves, it is a new row.

### 2.7 Decisions

| | Decision | Taken | Not chosen |
|---|---|---|---|
| OP-D1 | What is compared | every record no worker is moving that can still change on the chain (a game being played or paying, a paid order, a confirmed position not yet claimed) or that is a week old or newer, and each contract's solvency | every record ever on every pass; the records the workers are moving, which they ask about every few seconds |
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
