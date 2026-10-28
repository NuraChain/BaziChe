---
paths:
  - "backend/src/domains/market/**"
  - "backend/src/chain/markets.ts"
  - "backend/src/entities/market.entity.ts"
  - "backend/src/entities/market-position.entity.ts"
  - "backend/src/entities/market-disclosure.entity.ts"
  - "backend/tests/market*.ts"
  - "backend/tests/chain-markets.spec.ts"
  - "backend/tests/fake-markets.ts"
---

# Markets: backing a game's outcome with NURA

Somebody watching a game at a public table backs one of its outcomes with NURA, in a pool that
every position on that game shares: the winners split it in proportion to what each staked, and in
every case where nobody can fairly win it, every stake goes back. The money is held by
`ArcadeMarkets` (`contracts/baziche/ArcadeMarkets.sol` in the SmartContract project), never by this
server. The design and its decisions are
`docs/superpowers/specs/2026-10-28-live-watch-donations-markets-design.md` (MK-D1 onwards); the
contract's own rules, its tests and its reference are in the SmartContract project.

## Where markets are offered at all

**Nowhere unless three names say where.** `NURA_MARKETS_ADDRESS` (the contract), `MARKET_REGIONS`
(ISO 3166 two-letter codes separated by commas, from legal advice and nowhere else) and
`MARKET_COUNTRY_HEADER` (the header the proxy writes the reader's country into, overwriting any a
client sent) go together: `loadServerConfig` refuses to start with one or two of them written
(`marketsRefused` in `env.ts`, in either mode), with a code that is not two letters, or a header
name a request cannot carry. Written all three empty, markets are off, and markets are open only
when the chain is configured as well (`createMarketsChain(...).configured`: the rpc, the chain id
and `NURA_REFEREE_KEY`, which is the contract's operator). There is no wildcard: a country nobody
named is offered nothing, and a request that arrives without the header is offered nothing.
`env.spec.ts` holds it.

**The country is asked only of a request, through the port** (`HeaderOf` in `ports.ts`): `api.ts`
hands each market port a way to read a header and never learns which header it is, and
`services.ts` reads `MARKET_COUNTRY_HEADER` with it only while markets are open.

## Who may take a position

**Asked in this order** (`MARKET_MAY` in `domains/market/policy.ts`, each no a refusal word): where
the reader is (`market-region`, 451, the status of a refusal made for a legal reason), then the
rules of paid play as they stand (`market-wallet`, `market-minor`, `market-terms`, `market-break`,
by `eligibilityOf`), then whether they read what a market is (`market-disclosure`:
`POST /markets/disclosure`, a row of `market_disclosures`, once). A player of the game is
`market-playing`. A minor and somebody outside the regions are not shown a market at all; a claim
is never refused for where somebody is or a break, because what it pays is theirs.

## A market

**A market is written the first time somebody who may see it asks** (`GET /markets/matches/:match`):
a game being played at a public, live table that is not closed, whose ninety seconds of taking
positions (`MARKET_WINDOW_MS`, from the match's start, in whole seconds) have not run out, read by
somebody who may watch that table (the watch route's own rule, `table.mayWatch`). Nothing is
written for anybody else, so a game nobody looked at costs nothing. Its terms are the game's and
nobody's choice, so whoever asks first writes the same row and the unique index on the match
keeps one: an outcome a seat (`choicesOf` in `outcomes.ts`), or a side at a table of two sides
(the engine's own `sideOf`), and a draw last where the engine says its game can end level
(`drawable`, chess alone); no fee (`MARKET_FEE_BPS`, MK-D6); 500 NURA a position, 1,000 a bettor in
a market, 100,000 a pool; two bettors and two backed outcomes or every stake goes back. Every
column the terms hash covers is written once.

**A position is a ticket this server signs and the bettor's wallet places**
(`POST /markets/:id/positions`, `{ outcome, amount }`): the row's id is the ticket's, its deadline
the sooner of two minutes and the close, and the answer is `place(terms, ticket, signature)` for
the bettor's own wallet, asked of the contract from that wallet first so a refusal is said in its
own word before the wallet is asked (`market-paused`, `market-closed`, `market-limit`,
`market-amount`, `market-funds` with what the wallet holds, `market-refused` with the contract's
word). No ticket is signed for a game that is over or a market with under five seconds left. One
bettor's positions are written one at a time, and every limit counts what may still be placed as
well as what the chain holds (`LIVE`), so two at once cannot both pass a limit the pair goes past:
a bettor in a market, a bettor over the last day by Postgres's clock (2,000 NURA,
`MAX_PER_DAY_NURA`, which the contract does not know), and the pool. Asked again for the same
outcome and amount while its ticket has fifteen seconds left, it is the same position.

## The worker

**One pass at a time in a process, every three seconds** (`MARKET_SWEEP_MS` in `main.ts`), and it
believes nothing it is told about the chain:

- **A position** is confirmed once the contract holds it under its ticket as it was prepared;
  refused, with the contract's word, once its transaction was; let go of five minutes past its
  deadline (`LAPSE`, for a node or a clock that runs behind). One held under its ticket that is not
  the one prepared needs a ticket nobody here signed, so it is refused (`mismatch`) and said as a
  fault. A position nobody said they sent is asked about every ten seconds.
- **A market whose game is over** is decided once (`verdictOf`): called off for a game the staff
  ended as no contest, for an outcome that is not one of the market's (no winner, a draw it does
  not offer), and **for a game that ended while the chain could still take a position**. A ticket
  signed before the end can be placed until the chain's own clock reaches the close, and the chain's
  clock can run behind this one, so the worker works out the chain's time at the end from both
  clocks read now (the newest block's time, which can only be behind, so the doubt falls toward
  calling off) and settles only a game that ended after it. The adversarial read of the contract is
  where this came from: a walkout inside the window would otherwise have paid whoever placed a
  ticket knowing the result.
- **Then it is sent**: `settle(outcome)` or `cancel` with the operator's key, asked of the chain
  first, so a market the chain already resolved is written down and nothing is sent twice. A
  transaction that is waiting is waited for, one that reverted is sent again, and a refusal is
  written as the market's `failure` (`MarketOpen` until the chain's clock passes the close).
  A market nobody placed in is `empty` once no ticket could still open it (its close five minutes
  past), with nothing sent.
- **What the chain then holds is what is written**: settled with its winner and when winners may
  claim (the end of its dispute window), refunded (unbacked, too few bettors or outcomes), called off
  or expired; and a settled market is asked every thirty seconds until its dispute window has passed
  whether the owner overturned it, which calls it off.
- **A claim** sent from the bettor's wallet is read off its receipt (`claimsIn`, the contract's own
  `Claimed` events): what each position was paid. One that reverted is forgotten, so it can be
  claimed again.

Every step rings the bettors and whoever is looking at the game's table on their `me` scope with
`markets` (`hooks.changed`, coalesced by the hub per flush).

## Claims

**`POST /markets/claims { positions }`** composes `claim(tickets)` for the positions named that the
contract would pay now, all placed from one wallet: a winner's from the end of the dispute window, a
stake back at once from a market refunded, called off or expired; anything else is
`market-unclaimable`. A position the contract says was claimed already, by a call this server never
saw, is written down as claimed: with its stake as what it paid for a stake back, and with no
amount for a winner, whose share depends on who claimed before it (`market_positions.paid` is
nullable for that reason). What a position came to is on `GET /markets/positions`: won, lost or
refund, and its payout from the pools the chain holds (`(pool - fee) * stake / backing`, as the
contract's `payoutOf` works it out before anybody claims).

## How it is held

`market-outcomes.spec.ts` holds the outcomes and the verdict with no Postgres; `chain-markets.spec.ts`
the contract's module against a fake rpc (the two type strings word for word, the digest built by
hand, the operator's signature, every call and read, a claim's receipt); `market.db.spec.ts` the
service through the real ports with `fake-markets.ts`, which a spec steers (what the contract holds,
refuses and mines, its clock, whether it can be reached); `env.spec.ts` the three names;
`market-sweep.spec.ts` the worker's place in `main.ts`; `app.spec.ts` the routes, and
`tools/qa/garbage-pass.mjs` sends them garbage. `tools/qa/vault-deploy.mjs` deploys the contract on
a local node with a dispute window of a minute (`deployMarkets`).
