# The money path, read adversarially

PB7 part 3. Every path on which NURA moves or a money record is written, read on the server and in
the browser against a threat model written before the read, as the house's two earlier audits were
(`.claude/rules/chat-and-keys.md` and `.claude/rules/games.md`). A finding is reproduced by a spec
before it is changed, and each change is its own commit with that spec and its faults.

## The threat model

What this server must hold against, with what each actor can do:

- **A hostile player, buyer, giver or bettor**: anything a browser can send, in any order, as often
  as the limiter lets them, from several tabs and several wallets of their own; transactions sent
  from their own wallet by hand, under ids the server issued or made up, sped up, cancelled and
  replaced at their nonce.
- **A hostile member of the staff**, of each role: every admin route their role opens, and every
  one it does not, asked anyway.
- **A leaked server key** (`NURA_REFEREE_KEY`: the vault's referee, the shop's seller, the markets'
  operator): every signature that key can make and every call it can send, without the server.
- **A node that lies or stalls**: answers that are late, missing, or wrong about a record.
- **A crash at every step** between a write on the chain and the database's record of it.
- **Two servers on one database** by mistake.
- **Replayed and reordered requests**: the same body twice, an old body after a newer one, two at
  once.

The question for every path: can any of them move NURA that is not theirs, get something they did
not pay for, keep somebody from what is theirs, or make the database say something NuraChain does
not?

## What was read

The shop (`domains/shop/orders.ts`, `chain/shop.ts`), donations (`domains/donate/`, `chain/tips.ts`),
markets and claims (`domains/market/`, `chain/markets.ts`), the vault's stakes (`domains/stake/`,
`chain/vault.ts`), the reconciliation (`domains/reconcile/`), and the admin's money calls.

## Findings

### 1. The shop delivered a sale it never quoted

**What.** The shop's worker delivered a look whenever the contract held a sale under the order's
id, whoever had bought it and at whatever price (`settle` in `domains/shop/orders.ts`: a sale with a
buyer was delivered). The contract takes a sale under any id the seller's key signed a quote for,
so with a leaked seller key anybody could make an order through the api, sign a quote of their own
for it at one wei, buy it and be delivered the look. Only the reconciliation noticed afterwards (a
sale it calls `other`).

**Reproduced** in `shop-order.db.spec.ts` (*gives nothing for a sale the shop holds under an order
at another price or to another wallet*): the fake shop holding a sale of the order at 1 wei, the
sweep answered `paid: 1` and the buyer owned the look.

**Changed.** A sale is delivered only when its buyer and its price are the order's own quote. Any
other is a quote nobody here signed: nothing is delivered, the order is failed with the word
`mismatch` and said as a fault once (not at every pass), and the reconciliation, which keeps a
failed order with a sale it never quoted for a person, lists it. The markets' worker and the
donations' worker already did this (`mismatch` on both).

**Held** by that spec, both ways (another price, another wallet), and by six faults put in one at a
time, each caught: the price not asked, the wallet not asked, the wallet compared in its own case, a
mismatch delivered after all, the fault said at every pass, the order left as it was.

### 2. A lock found open on the chain was begun whatever it held

**What.** When a paid table's lock has no hash written down, the stake worker asks the vault first,
so that a lock whose hash was lost is begun and never sent twice. It began any game the vault held
open under the escrow's id, whoever's stakes, at whatever stake and fee. The vault opens a game only
for its referee, so only a leaked referee key could open one there, and only with stakes that key's
holder had signatures for (their own wallets): the server would then deal a game whose players'
stakes were never locked, and its payout would fail on secrets that open nobody's commitments.

**Reproduced** in `stake.db.spec.ts` (*fails a lock it finds open on the chain with …*): the vault
holding the escrow's id open with the players in another order, a player fewer, another stake or
another fee, the sweep began the game every time.

**Changed.** A game found open is begun only when it is the lock prepared: its players in seat order,
the stake and the fee (`isLockOf` in `domains/stake/service.ts`). Any other fails the lock as
`mismatch`, un-readies everybody and deals nothing, and the reconciliation keeps a failed escrow the
vault holds open for a person. The specs' fake vault now holds a lock's stakes from the moment it
accepts the call, as the chain does once it mines, which the lost-hash case needed to be true.

**Held** by those four cases and the lost hash still begun, and by seven faults put in one at a time,
each caught: the players not asked, asked in any order, not counted, asked in their own case; the
stake not asked; the fee not asked; a mismatch begun anyway.

## Looked at and found sound

- **Markets**: a position is confirmed only when the contract holds it under its ticket with the
  bettor, outcome and amount prepared (`settlePosition`), else `mismatch`; a claim is composed only
  for the caller's own positions, and read back only from the markets contract's own `Claimed`
  logs.
- **Donations**: a gift is believed only when the gifts contract holds it under its giver and id
  with the player and the amount prepared; a call made by hand under another gift's id is `mismatch`
  and believed of nobody (the donate pass holds it on a live node).
- **Two at once.** A bettor's positions are written one after another under
  `pg_advisory_xact_lock(hashtext('market:bettor'), hashtext(bettor))`, so two sent together cannot
  both pass the limits of a position, a market and a day; the pool's limit is asked again by the
  contract (`PoolLimit`), which refuses the place that would pass it, so two bettors together cost
  one of them a refused transaction and nobody any NURA. A shop order is one open order a recipient
  and look, under a lock per recipient. A deposit and a withdrawal are the vault's alone: the server
  sends neither.
- **The same thing twice.** A ticket is bound to the chain, the contract and its id, a quote to its
  order, a gift to its giver and id, a stake's signature to its game, nonce and fee: each contract
  refuses a second use. On the server every finish is guarded by the record's state (an order paid
  once, a position confirmed once, an escrow settled once, a market settled or called off once), so
  a worker that runs a step twice, or two passes that cross, write it once; a `sent` nudge is only a
  hint, and the chain's answer is what moves a record.
- **Who may.** Every money route reads and moves only the caller's own records (an order by its
  buyer, a donation by its giver, a position and a claim by its bettor); a market answers as one that
  is not there to anybody who may not watch its game and holds nothing in it; and every admin money
  route answers a caller whose role does not open Money, or the wallet calls, in the bytes of a page
  that is not there (`app.spec.ts`, `stake.db.spec.ts`). Settling, cancelling, refunding and paying
  are the workers', and no route reaches them.
- **A dependency away.** With NuraChain out of reach every worker waits and carries on from where it
  stopped (`chain-down` says so after two minutes); with the database away `/api/healthz` answers 503
  and the workers' passes fail and are tried again. Nothing is written as done on the strength of an
  answer that did not come.
- **A budget for each account.** None of its own: what bounds an account's money writes is the
  per-address limiter every route sits behind (`API_RATE_MAX`), one open order a recipient and look,
  a bettor's limits by amount, and every prepared record running out on its own clock (a quote and a
  gift in thirty minutes, a ticket in two). A budget per account would stop nobody those bounds do
  not, since a new wallet is a new account.
- **Key material.** `key-material.spec.ts` reads the repository for thirty-two bytes written as hex:
  the shipped code holds none but the development fixtures, the QA passes none but hardhat's
  published accounts, no spec or document names any other key, and `.env.example` writes every
  secret empty. The keys it allows are derived in the spec from hardhat's published mnemonic, not
  listed.
