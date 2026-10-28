---
paths:
  - "backend/src/domains/reconcile/**"
  - "backend/src/entities/discrepancy.entity.ts"
  - "backend/tests/reconcile*.ts"
  - "frontend/src/pages/admin/checks.page.azeroth"
  - "frontend/src/components/admin/check-row.component.azeroth"
  - "frontend/src/lib/check-words.ts"
  - "frontend/tests/admin-checks.spec.ts"
  - "tools/qa/reconcile-pass.mjs"
---

# Operations: the database and NuraChain, checked against each other

Every money record here has a worker that asks its contract about it by its id until it is done
(`.claude/rules/stakes.md`, `markets.md`, the shop and the gifts in their designs). Once a record
leaves its worker's hands nothing asked the chain about it again, so a row changed by hand, a payment
made straight to a contract, a reclaim while a game is still played here, a gift a block clock behind
took after it was let go of, or a contract short of what it owes stayed silent. The reconciliation
pass is what asks. The design and its decisions (OP-D1 to OP-D8) are
`docs/superpowers/specs/2026-10-28-operations-design.md`; this file is what the code does.

## The pass

**Once a minute, the first half a minute after boot, one at a time in a process** (`jobs.reconcile`,
`RECONCILE_MS` in `main.ts`, stopped on the way down with the other sweeps; a second asked for while
one runs is that one). It reads the three contracts' books first, then each family in turn, with a
budget of twenty seconds. Each family's own service compares (`audit` in the stake, order and donation
services, `auditMarkets` and `auditPositions` in the market service), using its worker's own reads and
writes; `domains/reconcile/service.ts` keeps what they find. A family whose contract this server does
not keep compares nothing, and is not listed as watched.

**What is compared**: every record no worker is moving that can still change on the chain (a game
being played or paid out, a paid order the owner could still refund, a confirmed position that
can still be claimed: one in a market that is not settled, a winner's, or any in a settled market
the owner may still overturn, `CLAIMS_YET`; a loser past the dispute window never can, and is left
to the week), whatever its age, and every other record made in the last week (`RECENT`); fifty a
family a pass (`AUDIT_PAGE`), newest first by keyset over `(created_at, id)`, the next fifty the pass
after, starting again at the newest once a family's list runs out, so a list that grew with all of
history would make a fresh disagreement wait longer to be found. The cursor is memory, so a restart
starts at the newest. Every open disagreement's record is read again each pass (fifty a family, the longest
unseen first), however old it is, so a record that has left the week is still found to agree.

**What no worker is moving.** A record its worker still holds is never compared, because the worker
asks the chain about it every few seconds: a lock (`locking`); an order quoted, handed in, or refused
while it can still be paid; a gift prepared or handed in; a market open, closing, or settled inside
its dispute window plus the lapse; a position prepared or handed in, or one whose claim is on its way.
Each audit asks this twice: its query leaves them out, and its compare answers `null` for one it is
handed anyway (the re-read of an open disagreement), which is not counted as compared, so the open
row stays open rather than read as agreeing.

## The tables

Every pair is one cell of a table in `domains/reconcile/verdicts.ts`, which imports only types, and
`reconcile-verdicts.spec.ts` holds every cell: **agree**; **the worker's** (a pair its worker moves on
its next pass); **put right**, through a worker's own write, because the chain is the authority and
that write is the one the worker makes; or **for a person**.

- **A paid game** against `gameOf`: the state (the design's table), and wherever the vault holds the
  game, its stake, fee and players in seat order (`escrow-stakes`), and a settled game's winners read
  off its paying transaction's own `Settled` event (`escrow-winners`, with who each seat is). Nothing
  of a paid game is put right: a game the vault resolved while it is played here is for the staff to
  end as no contest, after which the stake worker follows on its own.
- **A shop order** against `saleOf`: a sale to the order's own buyer at its price for an order that
  ran out or failed here is delivered by the worker's own `deliver`, refunded or not as the sale is; a
  sale to anybody else or at another price is a quote this server never signed (`order-sale`) and
  delivers nothing; a paid order the shop holds as refunded or not at all is a person's (no worker
  takes a look back: Admin › Shop is not built).
- **A gift** against `tipOf(giver, id)`: held as prepared after it was let go of here, it is the
  donation worker's `confirm`, which tells the player once; held as another, its `failed`/`mismatch`.
  Both writes now take any state but the one they write (`confirm` any but `confirmed`, `settleAs` the
  states it is handed), which changes nothing for the worker, whose query hands them only
  `prepared` and `sent`. A gift counted here that the chain does not hold is a person's.
- **A market** against `marketOf`: settled here and called off on the chain is an overturn the worker
  was not asking about any more (the server down through the window), written by its own `resolve`;
  another winner (`market-winner`, the owner's dispute window is for it), another claim time
  (`market-claimable`) or another state is a person's. The outcome the server decided is never
  overwritten with the chain's.
- **A position** against `positionOf`: held as prepared after it was let go of here, the worker's
  `confirm` (any state but `confirmed`, as the gift's); claimed on the chain by a call this server never
  read, the claim route's own write (`claimedUnseen`, `PAID_UNSEEN`, the one copy the claim route,
  `settleGone` and the pass share), and the bettor rung; claimed here and not on the chain, or a
  position under the ticket that is not the one prepared (`position-ticket`, a ticket nobody here
  signed, which the worker refused as `mismatch` and said only as a fault), a person's.
- **The books**: the vault, the shop and the markets contract each answer what they hold, what their
  own books say they owe and their own `solvent()`, every figure at one block (`booksOf` in
  `chain/rpc.ts`). One short of what it owes is a person's (`solvency`), with both figures.

## What is kept

**A row of `discrepancies`** (`entities/discrepancy.entity.ts`): the family, the record (its id, or the
contract's name for its books), the kind, what each side said when it was last seen (`db`, `chain`,
small objects of words the admin translates: a state, an amount, a fee, addresses, the seats paid and
who they are, an outcome and who backed it, a time, the figures held and owed), what the page shows
about the record (`about`: the game, the amount, the people, a look, a transaction), first and last
seen, and resolved when and how. A partial unique index keeps one open row per record and kind; while
it lasts each pass that meets it moves `last_seen` and keeps what the two sides say now. Nothing is
ever deleted.

**Resolved three ways**: `agreed`, when a pass compares the record and no longer finds that kind;
`put-right`, written in the pass that found it (a row is written even then, found and resolved at once,
so every money record the pass changed is on record); and `staff`, when an admin or the owner closes
it with a reason (`POST /admin/checks/:id/close`, `{ reason }`, `money`), which writes the staff
action `check` (`{ check, family, record, kind }`) in the same transaction, the row locked
(`pessimistic_write`), so two closing one at once close it once. One already closed is
`staff-check-closed` (409); an id that is not a uuid, or names nothing, is the page that is not there.
Closing one tells nobody and changes nothing on either side: it says a person looked. A disagreement
a person closed stays closed for as long as the two sides say exactly what they said when it was
closed (compared with the keys sorted); if either moves, the next pass opens a new row.

**Raised**: a `warn` line in the server's log when one is found (`chain and database disagree`, with
what each side says), when one is resolved (`chain and database agree again`, with how), and when a
person closes one (`chain and database disagreement closed`, with who: closing one is not the two
agreeing), through the ports' `note` at `warn` (`Note` takes a level; everything else still says
`info`). The overview carries `checks`, the open ones, for a role that opens Money where this server
watches anything, and `GET /admin/checks?list=&cursor=` (`money`) lists them newest first by first
sighting, fifty a page by the microsecond keyset: `open` (the default), `closed` or `all`, with how
many are open, the families this server watches and when its last pass finished.

## The page

**`/admin/money/checks`**, for a role that opens Money, reached from Money's head and from the
overview's "Needs you", which counts the open ones ("3 disagreements with NuraChain") for that role
alone. What it draws is written with the rest of the admin's pages, in `.claude/rules/admin.md`
(*The checks against NuraChain*). The log says "mina closed a disagreement with NuraChain about a
shop order.", the family in the reader's words, under the chip "Checks".

## Calm

A chain that cannot be reached (503) ends that family's pass with nothing said about the record being
read and no fault; what it found before stays open. Any other throw is a fault of that record alone,
reported by the pass and said once by `main.ts` while it is the same (`reconcile step failed`), and the
next record is compared. A record the database no longer holds is not compared, so its open row waits
for a person. The pass sends no transaction (the fakes' sent lists stay empty under it), takes no lock
but the one row a worker's own write takes, and nothing it does is in a request's path.

## How it is held

`reconcile-verdicts.spec.ts` every cell with no Postgres; `reconcile.db.spec.ts` every kind of
disagreement and every resolution against a real database and the four fakes (what is put right and
through which write, what is a person's, a row kept while it lasts, the week, the re-read of an old
one, paging fifty a pass, a chain out of reach, a fault, a family not kept, one pass at a time, who
reads the list and the count, and the staff's close: logged, said, refused a second time, one of two
at once, and closed until either side moves); `reconcile-sweep.spec.ts` the pass's place in
`main.ts`; `chain-books.spec.ts` and `chain-vault.spec.ts` the books and the winners off a receipt;
`app.spec.ts` the routes; `admin-checks.spec.ts`, `admin-overview.spec.ts` and `admin-log.spec.ts`
the page, "Needs you" and the log's sentence; `tools/qa/reconcile-pass.mjs` all of it over the built
server and a local chain (`tools/qa/CLAUDE.md`, *The reconcile pass*).
