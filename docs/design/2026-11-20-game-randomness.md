# Game randomness: what draws, where, and what it promises

Every dice roll and every card dealt in this product is drawn on the server, inside the transaction
that writes the result, by one of two generators. This is the audit of that arrangement: what each
generator is, which files may use one, and what can honestly be claimed about a match afterwards.

## Where a number comes from

| Draw | Source | Written down in |
|---|---|---|
| A free table's die, a seat drawn first, the code on a table, an invite code, a tournament's seeds | `crypto.randomInt`, which rejects and redraws rather than taking a remainder, so no face or letter is favoured | `lib/crypto.ts`, `domains/tournament/engine/game.ts` |
| A match played for NURA | HMAC-SHA256 over the match seed, keyed by the revision the play makes and the draw's index within it, read as a 32-bit number and rejection-sampled the same way | `domains/match/fair.ts` |

Both are CSPRNG-backed. `Math.random` decides nothing a player is affected by: it suggests a handle
or a group slug, picks which idle system player takes a chair, and jitters a visual effect. Those are
listed at the bottom and a spec fails if one of the files above joins them.

## Why an engine cannot cheat

An engine has no randomness of its own to subvert. `Draws` is handed IN to `create` and `apply`, and
the engine takes its number at the moment it applies, so "the client cannot choose a die" is a
property of the shape rather than a review comment. `ludo-purity.spec.ts` reads the engine directories
as text and fails on `node:`, `typeorm`, `Math.random` or `Date.now`; `randomness.spec.ts` holds the
service layer - where a die is actually produced - to the same rule.

A dice result has nowhere to arrive from a client in the first place: no route and no input shape
declares a die or a roll, and `ludo-dice.spec.ts` fails on the first one that does.

## The deck

Hokm shuffles with Durstenfeld's Fisher-Yates, drawing `deal(index + 1)` at each step from the last
card to the second, so each of the `n!` orders is equally likely given a level die. The Hâkem's five
and the rest of the hand are taken from the same shuffle, so a hand is a function of one deal rather
than two. Poker draws a card at a time from what is left, which is the same guarantee without a
permutation. `randomness.spec.ts` builds a deal from numbers a spec can replay and checks that the
four hands hold all fifty-two cards exactly once, that the ranges asked for are the ones a
Fisher-Yates step takes, and that the same draws make the same hands.

Card secrecy is a separate matter from card fairness: `view` composes the board per seat, so a Hokm
hand or a poker hole card is never built into a payload its seat may not have, and `log` does the
same for events.

## What a match played for NURA can prove

Each seat's consent carries a 32-byte secret the server minted and committed on chain with
`commitOf`, and the wallet signature over that stake. The match seed is the keccak of every secret and
then every signature, in seat order. Because the commitment is on chain before anybody signs, neither
the house nor the players can pick their contribution after seeing the other's - the classic
last-revealer problem, answered by the chain rather than by trust.

From that seed every draw is reproducible: `revision.index.round` in, one 32-bit word out, rejection
sampled. `fair.spec.ts` checks the derivation against Node's own `createHmac` as an independent
oracle, that a redraw happens instead of a biased remainder, and that every engine opens at revision
one.

## What it does not prove, and is not claimed

- **A free table cannot be audited by a player.** The server draws, records and pays nothing on it;
  a player cannot see that it did not draw twice and keep the one it liked. That is deliberate - a
  commitment and reveal on every casual roll buys a claim nobody needs and costs a column, a reveal
  step and an expiry sweep - and it is why no surface of this product says "provably fair".
  `ludo-dice.spec.ts` fails the word appearing in the wire, the API or the match service.
- **The generator is not a NIST SP 800-90A DRBG with published vectors.** It is an HMAC in counter
  mode over a per-draw label, which is the same construction for this purpose; it is checked against
  an independent implementation of that construction rather than against the standard's test vectors.
- **Statistical tests show a defect, not a proof.** The chi-square run in `randomness.spec.ts` would
  catch a face favoured by a fraction of a percent; it cannot show a generator is unpredictable.
- **One process per database.** The draws are made under the match's lock in the writing transaction,
  so two processes cannot spend the same revision twice; there is no distributed RNG state to agree on.

## Where `Math.random` remains, and why that is allowed

| File | What it decides |
|---|---|
| `domains/identity/service.ts`, `domains/group/service.ts`, `domains/channel/service.ts` | the number appended to a handle or slug that was taken |
| `domains/system/fill.ts` | which idle system player takes a chair, and how well it plays |
| `frontend/src/game/vfx/*`, `frontend/src/game/sound.ts` | jitter in an effect or a sound's pitch |

None of these reaches a score, a card, a die or a payout. The tests in `randomness.spec.ts` name the
files that are held to the higher rule, so the boundary is written down rather than remembered.
