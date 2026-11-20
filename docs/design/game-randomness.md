# Game randomness

## Repository audit

| Area | Existing implementation | Finding | Implementation |
| --- | --- | --- | --- |
| Ludo | Server seat draw and D6 on each roll. | The adapter drew before checking whether the player could roll. | Draw only after engine validation. |
| Backgammon | Server D6 for each opening throw and two D6 for a normal roll. Opening ties follow the game rules. | Draws were unbiased but lacked explicit audit metadata. | Record the bounded draws in action order. |
| Chess | Server D2 assigns White. | No explicit RNG metadata for the opening. | Audit colour selection with the opening action. |
| Poker | Every draw sampled from the canonical deck minus all dealt cards, including folded hands. | Uniform sampling without replacement. The ordering of future cards was decided across multiple actions. | Shuffle once per hand and consume the private stock in order. |
| Hokm | Fisher–Yates for the opening. Two-player stock was sorted and then sampled. Three- and four-player hands reshuffled the remaining cards when trump was called. | Draws were uniform. There were two sources of ordering within a hand and no shuffle audit. | Shuffle the format-specific deck once per hand and persist the private remainder. |
| Tournaments | A separate Fisher–Yates implementation with Node random integers. | The algorithm was correct, with duplicated shuffle code. | Use the shared shuffle and keep the assigned seeds with the entrants. |
| System players | Seeded simulations and policy choices inside the AI worker. The seat filler picks a bot from eligible rows, and generates its name and style separately. | Simulation draws never reach the match ledger or mutate the authoritative board. Opponent selection and AI strategy affect play but are separate from dice and deck entropy. | Keep simulations reproducible and route every submitted action through the regular match transaction. |
| Browser | Seeded animation and realtime timing, local visual effects, and a verifier for finished paid matches. | No authoritative dice or card selection travels from the browser. HTTP fallback reuses the WebSocket key, but lacked a bounded wait for the response. | Retain authoritative event playback and recover timed-out commands with the same request key. |
| Infrastructure | Wallet and session tokens, escrow secrets, group links, invite codes, table codes, identity slugs and miscellaneous diagnostic IDs. | These values do not enter the match RNG. Table codes also act as join locators and previously used floating-point randomness. | Use a secure integer source for table codes. |

The authority path is the authenticated HTTP API or admitted WebSocket, then the match service, then the engine. Manual starts, tournament starts and the escrow worker open games under the table lock. Player and bot actions, walkouts, staff voids and the timeout worker hold the match row lock. The action ledger and board update share a PostgreSQL transaction. Seat-specific engine projections serve the board and action feed, including delayed spectators. Bots receive the same private-information view as their seat.

## Implementation sequence

1. Add a shared bounded-integer and Fisher–Yates implementation. Exercise deterministic range and permutation tests, then run distribution tests against Node's CSPRNG.
2. Add a versioned RNG transcript to the existing action ledger. Update all gameplay paths and put seed lookup and command deduplication under the existing locks.
3. Update Poker and Hokm to persist and consume shuffled private decks for new matches. Preserve the old deck paths for active legacy games and historical paid proof replay.
4. Require a revision for play commands, return the original committed action on retry and recover browser timeouts through the existing snapshot and action feed.
5. Verify deck composition, private projections, compatibility, concurrency and restart behavior. Run the application tests and build, then exercise multiplayer play through Playwright.

## Randomness and card lifecycle

The pure engine boundary supplies a bounded die and, for newly opened matches, a shuffle. The free
match service supplies Node's `crypto.randomInt(0, n)` and adds one for an n-sided die. It validates
the range before drawing. Backgammon uses two successive draws for an ordinary roll and uses its
existing tie rules during opening throws. Ludo checks membership, turn and roll state before
drawing. None of the current formats defines weighted dice.
[Node 24 crypto.randomInt](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptorandomintmin-max-callback)

Fisher–Yates copies the input and swaps each position `i` against an independent uniform index
in `[0, i]`. The sequence of index choices has a one-to-one correspondence with the permutations
of a deck of distinct cards. Hokm preserves its 51-card three-seat deck and its 52-card two- and
four-seat decks. Trump selection still precedes distributing the remaining hands in three- and
four-seat play. At two seats the engine consumes two cards per draw and discards according to the
existing keep/pass rules. Poker consumes the 52-card stock in order for hole and community cards.
Both engines get a fresh stock when a new hand starts. The engine projections and private event
filters still govern HTTP, WebSocket, spectators and AI seat views.

## Persistence and command safety

The `matches.randomness_protocol` and `match_actions.randomness` entity columns are nullable.
The startup schema mechanism adds them to existing databases. New matches identify their protocol
as `server-v2` or `stake-v2`. Unversioned matches continue with the legacy card lifecycle and RNG
protocol. Existing action rows and deck state require no rewrite. A random action records the
algorithm, protocol, randomness rules version, revision and ordered dice faces or shuffle indices
in the same row as the action and resulting state. Deck size and the versioned game rules identify
the shuffle input. Match, game, actor, command key, action ID, timestamp and state are available from
the existing ledger and match row. The transcript column is excluded from ordinary queries and
live responses. Shuffle data is as sensitive as the private stock.

PostgreSQL serializes a match's actions with its row lock. The transaction updates the board and
inserts the action ledger entry. The unique command key is scoped to the match and player. A retry
receives the committed `actionRev` and the original projected events even when the board has moved
on. Play commands require the revision the caller saw. Both transports use the same service.
The WebSocket publishes after the transaction. The browser reuses the key on HTTP fallback or
when retrying an uncertain outcome at the same revision. The persisted event feed supplies missed
frames on reconnect. The existing deployment topology uses one app and realtime process per
database. The row lock also protects outcomes across workers. Connected clients on different
processes would need shared fan-out for immediate broadcasts.

| Implementation | Code |
| --- | --- |
| Bounded draws, shuffle and audit | `match/randomness.ts`, `match/randomness-server.ts` |
| Versioned paid derivation and browser replay | `match/fair.ts`, `frontend/src/lib/proof.ts` |
| Opening, actions, walkouts and timeout workers | `match/service.ts` and the game adapters under `match/engines` |
| Schema changes | `match.entity.ts` and `match-action.entity.ts` |
| Command and proof wire changes | `backend/src/schemas.ts`, `realtime/frames.ts`, `realtime/gateway.ts` |
| Pending and retry behavior | `frontend/src/stores/match.store.ts` |

## Paid verification and its limits

Paid matches keep their existing wallet-signed stake commitments and settlement lifecycle.
Version 2 hashes an unambiguous, seat-ordered encoding of the revealed secrets and signatures.
It derives the match UUID from the game and the signed commitment/nonce tuples. That removes a
server-selected match ID as an extra source of variation after the players sign. The existing
HMAC-SHA-256 sampler includes the protocol, game, match ID, action revision, draw index and rejection
attempt in its versioned input. It rejects a 32-bit word at or above the largest multiple of the bound
before mapping the value to the range. Legacy paid proofs retain their original byte encoding,
sampler inputs and dealing order.

The proof endpoint requires a finished match and a participant. Verification checks the wallet
commitments, derives the seed and match identifier, and compares the recorded action and RNG
transcripts to engine replay through the terminal revision. A staff void remains an explicit
terminal ledger entry. The verifier checks the played prefix through the revision immediately
before the void. The existing browser signature verifier recovers ordinary wallet signers
locally. Its verification of smart-contract wallets is limited. The paid proof and existing
chain settlement reveal the information needed to reconstruct past paid hands after completion.

The version 2 encoding uses UTF-8 JSON arrays with no insignificant whitespace. All input hex
strings are lowercase and seats are ordered by seat number. The seed is Keccak-256 of
`["baziche","stake-v2",secrets,signatures]`. The match UUID is the first 16 bytes of Keccak-256 of
`["baziche","stake-v2-match-id",game,[[commitment,nonce],...]]`, with the UUID version set to 8
and the RFC variant bits set. Each HMAC input is
`["baziche","stake-v2",game,matchId,revision,drawIndex,rejectionAttempt]`. The draw index starts
at zero for each revision. The rejection attempt starts at zero for each bounded draw and the first
four HMAC digest bytes are read in big-endian order. Paid deck replay treats the HMAC output as a
pseudorandom source of bounded indices.

Free and free tournament matches have a private audit record. Independent replay applies to
paid matches with a valid proof. The paid sampler is a versioned HMAC construction, with no
claim of NIST DRBG conformance. SP 800-90A defines DRBG state machines, 90B addresses entropy
sources, and 90C addresses complete constructions. A separate competitive commitment protocol
would require a reviewed, reproducible DRBG with official vectors and a protocol for locking
contributions. The current paid proof checks conformance to signed inputs and the actions
presented. The operator still controls pairing, service availability and pre-game cancellation.
A beacon could limit server control if its future round were fixed before play. It would add
an external dependency and opening latency. A VRF would additionally need an independently
trusted key and publication scheme. Standard actions use local cryptography with no chain
request per die or card.
[NIST SP 800-90A](https://csrc.nist.gov/pubs/sp/800/90/a/r1/final),
[NIST SP 800-90B](https://csrc.nist.gov/pubs/sp/800/90/b/final),
[NIST SP 800-90C](https://csrc.nist.gov/pubs/sp/800/90/c/final)

## Deployment and recovery

- Deploy the backend and browser bundle together with the normal schema versioning procedure.
  Back up the database first. Leave escrow material, match state and the action ledger in place
  during rollback. Use a rollback build that understands both protocols while a version 2 match
  is live. An older binary would interpret new card stock using the previous rules.
- There are no new environment variables, external randomness services or dependencies. Keep the
  existing application and database credentials restricted. Paid escrow secrets are in restricted
  database rows. Protect the PostgreSQL volume and backups with encryption at rest. Database and
  host administrators can access private state and can alter records. The ledger is append-only
  in application flows and has no external tamper-evident anchor.
- Monitor failed match transitions and timeout sweep reports. `threw:randomness` identifies secure
  source or escrow material failures in the sweeper. An entropy error aborts the transaction. A
  paid match with missing or mismatched material likewise stops. Recover from the persisted
  escrow data and the existing action revision. A free match may draw again after a rolled-back
  transaction whose result was never published. A committed command returns its saved result.
- A random command adds one JSON value to its existing ledger insert. A 52-card shuffle records
  51 bounded indices and takes linear time and space. A local Node 25.9 spot check averaged about
  1.5 microseconds for a tracked 52-card shuffle; it excluded PostgreSQL and network latency.
  Deployment throughput is governed by the database and existing realtime topology.

## Verification

The full typecheck and production build, including bundle budgets, passed. Both normal and
shuffled suites passed with 2,414 backend tests and 2,426 frontend tests. Sixteen backend tests
were skipped by the default suite configuration.

The new tests check all six permutations of three cards with exhaustive injected choices, range
validation, source failures, 60,000 draws each for D2, D6, D8, D10, D12 and D20, and 30,000
three-card shuffles. A separate local sample of 60,000 D6 rolls recorded counts
`[9900, 10060, 9975, 10040, 9971, 10054]`, with Pearson's statistic of 1.96 on five degrees of
freedom. These are distribution checks. The bounded sampler and the permutation argument explain
why the mapping is unbiased.

The engine tests also exercise Poker from two to nine seats, all Hokm formats, the full two-seat
Hokm draw phase, private projections and preservation of the existing paid transcript format.
The version 2 browser verifier tests reject changed draws, wrong match identifiers, gaps and
truncated proofs. Playwright MCP exercised the real Ludo roll button, checked that its announced
face matched the WebSocket acknowledgement and recorded action, and reloaded the browser. The
disposable PostgreSQL probe exercised
unauthorized and stale commands, a repeated Poker flop action submitted to two workers,
spectator views and retrying a committed Ludo roll after restarting the server.
An isolated paid escrow fixture checked fail-closed behavior when contribution data was missing,
blocked proof reads during live play, and matched the committed roll to the participant's
transcript after a staff void. This fixture exercised the database and the match service. It used
no live chain or funded wallet.

A database created by the pre-change build was upgraded by the new build while a Poker match
was in progress. The original state and hole cards survived intact. The match then advanced to
the flop using the legacy draw path, with the new ledger recording the legacy protocol for
the new action.
