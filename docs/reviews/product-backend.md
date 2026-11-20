# Baziche backend review

## Scope and baseline

Reviewed the server's route composition, all 25 domain directories, entity and migration registration,
realtime gateway, scheduled work and chain adapters. The first TypeORM checkpoint covers member match
reads. The next checkpoint covers notification retractions and the ordering of group-call publication and closure.

The workspace started clean on local `main`, 14 commits ahead of `origin/main`. Node 25.9.0 compiled
the backend to an isolated output directory. The initial engine seam, Ludo dice and decorator metadata
test selection passed 33 tests. The local benchmark uses synthetic accounts and a disposable PostgreSQL
database. The workspace has no lint script and uses the TypeScript and test gates.

## Server structure

- [`api.ts`](../../backend/src/api.ts), [`schemas.ts`](../../backend/src/schemas.ts) and
  [`ports.ts`](../../backend/src/ports.ts) define typed HTTP routes, request and response validation and
  service interfaces. The frontend imports these types. [`services.ts`](../../backend/src/services.ts)
  composes the TypeORM-backed implementations. Repository factories take a `DataSource` or transaction
  `EntityManager`; the project uses functional injection and has no NestJS dependency.
- [`data-source.ts`](../../backend/src/data-source.ts) registers entities with installed TypeORM 1.1.2 for
  PostgreSQL. The pool uses a configurable cap, a 5 s connection timeout, a 30 s idle timeout and a 30 s
  statement timeout. [`one-at-a-time.ts`](../../backend/src/lib/one-at-a-time.ts) serializes queries on
  each connection. Parallel work should use independent runners unless it needs one consistent
  transaction snapshot.
- [`entities/index.ts`](../../backend/src/entities/index.ts) registers the decorated classes.
  Foreign keys, uniqueness and checks protect relationships and business invariants. Database
  cascade rules are explicit where needed. The entity scan found no TypeORM lifecycle or subscriber
  hooks. The first checkpoint leaves repository writes and lifecycle semantics intact.
- [`db/migrate.ts`](../../backend/src/db/migrate.ts), [`db/schema.ts`](../../backend/src/db/schema.ts)
  and [`db/migrations`](../../backend/src/db/migrations) coordinate drift detection, schema versioning,
  check constraints, expression and partial indexes and the ordered explicit migrations. The runtime
  DataSource has `synchronize: false`. The migration DataSource uses its own pool and timeouts.
- [`main.ts`](../../backend/src/main.ts) starts HTTP, realtime and bounded job cycles. It runs match,
  table, tournament and call sweeps, system seats, suspension expiry, stake and commerce recovery,
  reward payout and reminders, NFT reconciliation and health sampling. The workers and database are
  shut down through the server's shutdown path.
- [`realtime/gateway.ts`](../../backend/src/realtime/gateway.ts) and [`realtime/hub.ts`](../../backend/src/realtime/hub.ts)
  handle session admission, subscriptions, game writes and viewer-specific pushes, voice-room
  membership and presence. HTTP and WebSocket paths use the same game service. Push catch-up reads
  the snapshot plus ordered revisions, and private engines project a view for the reader's seat.
- [`match/engine.ts`](../../backend/src/domains/match/engine.ts) and
  [`match/service.ts`](../../backend/src/domains/match/service.ts) register all five implemented
  engines. Ludo, Hokm, Backgammon, Poker and Chess share table lifecycle and revision storage.
  The game engine owns each action's legality, state transition, turn, log and visibility.
- [`chain`](../../backend/src/chain) composes NURA vault, tips, shop, market, sponsorship, rewards
  and NFT calls. Database jobs reconcile receipt status and compare on-chain facts with local rows.

## Service inventory

Priority indicates where to verify correctness or measure load first. An open performance question
in this table requires workload evidence before a production change.

| Service | Responsibilities | TypeORM and persistence | Performance or reliability concern | Priority |
|---|---|---|---|---|
| Achievements | Ladders, stats, leaderboard and profile progression | Bounded reads and grouped queries in `achieve/service.ts` | Compare leaderboard window plans and count estimates with representative history | P2 |
| Admin | Staff, people, reports, notices, games, invites, seasons, shops, rewards, minters and live views | Per-domain repositories and query builders, transactional audit writes | Review high-cardinality filters and paging under staff workloads | P2 |
| AI | System-player decisions and move scheduling | Queue/source finds eligible revisions, worker threads run game searches | Monitor queue age, retry/backoff and database polling under a high system-seat share | P2 |
| Calls | Call invitations, per-user state, room activation and stale-call cleanup | Repository projections and scoped transactions | Batch fan-out queries should be measured by group size | P2 |
| Catalogue | Current games and supported formats | Reference repository and format projection | Inspect cacheability with staff changes and availability rules | P3 |
| Channels | Membership and visible channel feeds | Query builders and targeted SQL for permission and write operations | Measure large member fan-out and cursor latency | P2 |
| Chat | Conversations, messages, receipts, attachment metadata and encrypted epochs | Keyset paging, bound SQL fragments, transactional writes and a scoped query runner for epochs | Measure message/conversation reads and lock time on concurrent epoch changes | P1 |
| Devices | Registration, peer keys and account recovery | Repository writes and parameterized challenge/device queries | Keep challenge consumption atomic and benchmark recovery separately from public paths | P1 |
| Donations | Tips lifecycle, status and chain recovery | Projected reads plus transactional transitions and receipt jobs | Monitor pending receipt age and retry isolation | P1 |
| Groups | Group discovery, roles, membership, invites and joining | Repositories, table-specific SQL, scoped writes | Verify aggregates, transaction duration and large membership work | P2 |
| Identity | Wallet/guest sign-in, profiles, sessions and sponsorship | Repositories, DB-time nonce/session predicates and sponsorship locks | Keep sign-in p95 separate from chain and Postgres latency | P1 |
| Invites | Referrals and site invitations with operator policy | Keysets, repositories and transactional claims | Verify lock duration and scans in redemption history | P2 |
| Markets | Position reads, place/settle/claim orchestration and recovery | Typed projections and transactional transitions around independent chain work | Monitor stale settlement and receipt retries | P1 |
| Match | Start, action ledger, deadlines, results, participant and spectator projections | Repeatable-read snapshots, revision and action keys, row-locked writes | Participant reads contain a redundant membership query. Verify long-ledger reads and write-side lock waits independently | P1 |
| NFT | Owned assets, mint state and chain mirror | Targeted reads and status upserts | Monitor due/retry batches and ownership freshness | P2 |
| Notifications | Fan-out, unread state, muting and browser push | Keyset paging, conditional publication and dedupe upsert | Fixed divergent retraction recipients and stale invites around group-call end. See the concurrency checks below. | P1 |
| Party | Ephemeral parties and invitations | In-process state | Keep expiration and single-process behavior explicit if hosting expands | P2 |
| Reconciliation | Detect and record discrepancies between chain and DB | Repositories and transactional incident writes | Track review backlog and RPC latency before tuning | P1 |
| Rewards | Quests, streaks, XP, grants, balances and payout attempts | Unique grant source keys, transactional state, retry state machines | Keep money correctness tests around retry, receipt and freeze edges | P1 |
| Shop | Inventory, equipped looks, quotes, orders and receipt recovery | Repo projection, batched looks, order transactions, chain confirmation | Verify query cost around inventory and jobs in separate work | P2 |
| Social | Friendships, blocks, muting, profile search and discovery | Repositories and parameterized SQL for visibility and bilateral relations | Measure search selectivity and blocked-list overhead | P1 |
| Stakes | Table consent, escrow seats, ledger state, settlement and recovery | Transactional row updates, case-specific projections and scoped receipt jobs | Measure lock wait and receipt age while preserving money transitions | P1 |
| System | System accounts, pool and automated seating | Bounded queries, advisory locks and joins | Measure concurrent fills with real-format seat limits | P2 |
| Tables | Matchmaking, visibility, seat claims, ready up, spectators and cleanup | Repositories and correlated projections, advisory locks, partial uniqueness and skip-locked claims | Confirm list query costs with populated table and match history before reshaping projections | P1 |
| Tournaments | Enrollment, bracket advancement, station matches and operator controls | Transaction-scoped repositories, foreign keys and claim/finish locks | Verify concurrency around enrollment, late start and result advancement | P1 |

## Defensive checks and open questions

- HTTP uses a session guard and an origin guard for writes. Secure cookies set `HttpOnly`, `Secure`
  and `SameSite=Lax` with the `__Host-` name. The gateway checks origin, rate budget and cookie
  presence before checking the session. Production forwarded-header handling depends on a trusted
  reverse proxy and a backend port reachable only from that proxy, as described in
  [self-hosting](../operations/self-hosting.md).
- The API validates requests at its schema boundary and maps normal business refusals to HTTP and
  WebSocket codes. The monitor's metrics route accepts a configured bearer credential and sends
  `Cache-Control: no-store`. Health and background-job evidence can be collected without a
  value-bearing chain transaction. [HTTP auth](../../backend/src/http/auth.ts),
  [metrics](../../backend/src/http/metrics.ts)
- The game path checks membership, locks the match row for writes, rejects stale revisions and
  deduplicates accepted actions. The match revision, state and action ledger are written in the same
  transaction. Live spectator and participant projections apply their own visibility gates. The
  private Poker bench checks that each member receives their own cards and that event logs omit
  hidden cards.
- Payment, stake and reward updates depend on transaction-local repositories, constrained state
  transitions and reconciliation of chain receipts. Keep payment and randomness-proof regression
  coverage when changing those paths. This review did not run value-bearing chain transactions.
- Match and notification histories are worth measuring separately under long retained histories.
  The match delta query respects the requested lower revision and the board's upper revision,
  and retrieves the complete missing range. Measure bytes and p95 for mature histories before any
  pagination or retention changes because the frontend relies on contiguous revisions.
- The hand-built `match_actions_feed` index orders by match and descending revision. The unique
  `match_actions_rev` also covers match and revision. Compare scan counts, plans and write cost
  before considering any index change.
- The health monitor, queue age and job timing can distinguish slow queries from pool contention
  and external RPC errors. This checkpoint does not establish production query prevalence, a
  production load profile or deployment-level authorization policy.

## Checkpoint 1 · Match service

[Participant reads](../../backend/src/domains/match/service.ts#L398) loaded the match, looked up
the caller's seat, then queried the complete roster. The new first query joins the member row and
projects its seat with the hydrated Match entity. PostgreSQL enforces one member row per person
and match through `match_players_one_per_person`. The roster remains a separate query in the
same repeatable-read transaction. A nonmember fails the indexed join before the service projects
any match state or reads the roster.

### Measurement

The probe used installed TypeORM 1.1.2 and PostgreSQL 18.3, with 500 synthetic nine-seat Poker
matches, 4,500 membership rows and 1,000 action rows. It compiled baseline and candidate into
separate ignored directories, called the service directly over loopback, warmed each case 80
times, then measured 400 calls per case. Three trials per build were interleaved on the same
seeded database. TypeORM's query logger counted SQL statements, and
`EXPLAIN (ANALYZE, BUFFERS)` showed scans of the match primary key and
`match_players_one_per_person` in the candidate. The service probe includes roster and
transaction time in each request.

| Scenario | SELECTs before → after | p50 before → after (ms) | p95 before → after (ms) |
|---|---:|---|---|
| Participant requests current match | 3 → 2 | 0.84–0.97 → 0.70–0.76 | 1.19–1.37 → 0.95–1.14 |
| Participant requests match plus action delta | 4 → 3 | 1.13–1.31 → 0.99–1.07 | 1.53–1.80 → 1.34–1.54 |
| Nonmember requests an existing match | 2 → 1 | 0.49–0.59 → 0.35–0.38 | 0.75–0.87 → 0.53–0.61 |
| User requests a nonexistent match | 1 → 1 | 0.28–0.35 → 0.31–0.35 | 0.47–0.57 → 0.48–0.57 |

The ranges are the minimum and maximum per-trial percentiles. Raw trial output is in
`.playwright-mcp/product-review/pg-*.json`. The stable change is one fewer query where a match
exists. The nonexistent-match control retained one query and showed overlapping timings.

The service probe verified viewer seats 0 and 8, roster order, match state, participant-specific
private cards, public event logs, revision bounds, a missing row, a malformed ID and rejection of
an existing match requested by a nonmember. The same fixture and assertions passed on both
builds. Timings are for direct service execution against warm synthetic data on a shared
workstation. Production latency and throughput still need representative traffic data.

### Verification and rollback

- Isolated TypeScript backend build and `npm run check:tests -w backend` passed.
- `npm test -w backend` reported 2,378 passes and 16 skips. Eleven assertions in `identity.spec.ts`
  and `reward-payout.spec.ts` failed because the sandbox refused connections to the local fake
  chain (`EACCES`). All 43 tests in those two files passed when rerun with local loopback access.
- No schema, indexes, write transactions, route contracts or service dependency changes.
  Revert the member-read query in `backend/src/domains/match/service.ts` and rebuild to roll back.
  The rollback needs no data migration.
- Suggested commit message is `perf(match): combine participant and seat reads`.
- Production effect still depends on the rate of participant views and catch-up requests and on
  real PostgreSQL pressure. Measure endpoint p95 and connection occupancy on representative traffic.

### Status

- [x] Identify the participant match read's separate membership and roster reads.
- [x] Check that `match_players_one_per_person` enforces one member row per person and match.
- [x] Measure the current implementation using actual PostgreSQL and TypeORM.
- [x] Narrow the change to member reads and rerun the same fixture with an indexed membership
  join projecting the matched seat. Keep the roster and match on one database snapshot.
- [x] Verify behavior, types, affected tests and rollback guidance.
- [x] Reviewed and committed the member-read change before continuing to notifications.

## Notification concurrency

Two real PostgreSQL regressions drove separate changes. Retractions now return the user IDs from the delete itself. Group-call invitation fan-out locks a live call for reading during publication, so an end that wins the race suppresses publication and an end that follows publication removes the invites. The ordinary message code path retains its existing behavior. The regression uses a disposable local database, exercises both orderings and fails on the original versions. [Retraction measurements](notification-retraction.md) · [Call lifecycle](notification-call-lifecycle.md) · [How to run the database regression](notification-regression.md)

The chat follow-up found that a ten-file album published ten notification upserts. The service now publishes once for all committed message IDs, preserving per-file counts. The measured send cost fell from 117 to 108 statements. A separate ordering fix consults the recipient's read watermark during publication. A delayed fan-out skips messages already read and preserves newer activity when older deliveries arrive out of order. Regression cases use actual sealed text and album messages on PostgreSQL. [Album benchmark](album-notification.md) · [Concurrency checks](notification-regression.md)
