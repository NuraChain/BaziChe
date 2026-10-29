# Compliance: what the product enforces, and what needs a lawyer

Baziche lets people play for NURA (paid tables), back the outcome of a game they watch (markets),
send NURA to a player (donations) and buy looks (the shop). Whether each is allowed, where, and
under which conditions is a legal question that differs by country and by the kind of game. This
document says what the code does today and lists, as questions for qualified legal counsel, what
it cannot decide. Nothing here is legal advice, and no region should be opened on the strength of
it.

## What the product enforces today

### Who may play for NURA (paid tables)

- A wallet account; a guest cannot (`paid-wallet`).
- Not marked under 18 by the staff (`paid-minor`).
- The terms of paid play accepted once, which include the line "I am 18 or older, and playing for
  money is allowed where I live" (`paid-terms`). This is a declaration: nothing verifies the age or
  the country.
- Not on a break (`paid-break`, below), not suspended.
- Live tables only; the stake from a ladder of 1, 5, 10, 25, 50, 100 or 250 NURA, under the vault's
  ceiling on a stake (1,000 NURA as deployed). The vault's fee, signed by every player for their own
  game, is 5% of the pot as deployed.
- **Offered in every region the server can be reached from.** Paid tables do not ask where a reader
  is. If counsel says they must be limited to some countries, that gate has to be built before real
  value.

### Who may back a game's outcome (markets)

- A wallet account, not marked under 18, the terms of paid play and the markets' own disclosure
  accepted, not on a break, not suspended, and not a player of that game.
- **Offered in every region the server can be reached from.** Markets asked a reader's country
  until 2026-10-28, when the owner took that gate out (`MARKET_REGIONS`, `MARKET_COUNTRY_HEADER` and
  the refusal `market-region` went with it). A market is offered wherever `NURA_MARKETS_ADDRESS` is
  written beside the server's key and the chain's names, and nothing asks where a reader is. Until
  counsel has answered for every region the server can be reached from, the one way to keep markets
  from a region is to write `NURA_MARKETS_ADDRESS` empty on the server that serves it; a gate that
  offers them in some countries alone has to be built again.
- Limits: 1 to 500 NURA a position, 1,000 a bettor in one market, 2,000 a bettor a day, 100,000 a
  pool; a market with fewer than two bettors or two backed outcomes gives every stake back; the fee
  is nought. The estimated payout is shown before the bettor confirms.
- A market is open for ninety seconds from its game's start; a game that ends before its market
  closes calls the market off, so nobody can back a result already known.

### Donations

- A wallet account, not marked under 18, the terms of paid play accepted, not on a break; 1 to 1,000
  NURA; only to a player of a game the giver watches and does not play in; a player can turn them
  off. NURA goes from the giver's wallet straight to the player's; Baziche keeps nothing.

### The shop

- Looks only: nothing sold changes a rule, a chance or what anybody may see.
- A wallet account not marked under 18 buys, from their own wallet; a minor may receive a friend's
  gift. No card payments, no premium currency, no loot boxes, no resale.

### Self-exclusion, age and the staff

- **A break** locks a person out of paid tables, markets and donations for a day, a week or a month;
  a shorter one asked for later never cuts a longer one short, and NURA in the vault can still be
  taken out during it.
- **Under 18.** The staff can mark an account under 18: it loses stranger messages, paid play,
  markets and donations at once, its paid tables waiting stand it up and its paid games being played
  end with every stake given back.
- **Suspension.** The staff can suspend an account for a day, a week, 30 days or for good: its
  sessions end and it cannot sign in. Its NURA stays in the vault, which it can withdraw from the
  contract directly.

### Records

- Every change the staff make is a row of `staff_actions`, with who, the role they held, the person,
  the reason and when, written in the same transaction as the change; no route edits or deletes one.
- Every paid game, order, donation and market position is a row with the transactions that moved
  its NURA, and NuraChain holds the same in its contracts' state and events. A reconciliation
  compares the two every minute and keeps every disagreement for a person.
- A report keeps the message the reporter disclosed, verified at filing; nothing else of a
  conversation is readable by anybody but its members.

## Questions for qualified legal counsel

To be answered for each country the server can be reached from before any paid feature runs with
real value there:

1. **Paid tables.** Is playing Hokm, Ludo, backgammon, poker or chess for stakes between players,
   with a fee to the operator, lawful? Is it gaming, gambling or a skill competition there, and does
   the answer differ by game (Ludo's dice, poker's cards)? Does it need a licence?
2. **Markets.** Is backing a game's outcome with NURA, pooled and paid in proportion (pari-mutuel),
   betting there? Which licence would it need? In which countries may markets be offered at all?
3. **A region gate.** Must paid tables, markets and donations be limited to some countries, and is
   a country read from the proxy's GeoIP enough, or is more needed (a declared residence, checks
   against VPNs)? Nothing in the product asks where a reader is today.
4. **NURA.** How is NuraChain's coin treated: money, a virtual asset, a security? Does holding
   players' stakes in a contract whose admin takes a fee make the operator a custodian or a money
   transmitter?
5. **Identity, AML and sanctions.** Is identity verification required, at what amounts? Screening
   against sanctions lists? Monitoring and reporting of transactions? Which countries must be
   refused outright?
6. **Age.** Is a declared 18 enough, or must age be verified? Is 18 the age everywhere (19, 21)?
7. **Responsible gambling.** Are deposit, loss or time limits required, reality checks, a national
   self-exclusion register, messages and helplines that must be shown? Is a break of a day, a week
   or a month enough as self-exclusion?
8. **The shop.** Consumer law for digital goods bought with a coin (refunds, price display, taxes
   such as VAT), and for gifts to minors.
9. **Donations.** Are gifts of NURA between people who meet at a table lawful, taxable, or a money
   transfer service?
10. **Data.** What may be kept and for how long (wallet addresses, sessions, reports, staff notes),
    and how an erasure request meets the append-only staff log and what is on a public chain.
11. **Terms.** What the terms of paid play, the markets' disclosure and the terms of service must say,
    including the owner's power to overturn a market within its dispute window.
12. **Tax and advertising.** The operator's and the players' tax obligations, and what may be said
    when advertising paid play or markets.

Until these are answered for every region the server can be reached from, the safe settings leave
each paid feature off: `NURA_REFEREE_KEY` written empty (no paid tables, no shop and no markets, which
all sign with the server's key) and `NURA_TIPS_ADDRESS` written empty (no donations).
