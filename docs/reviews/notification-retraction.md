# Checkpoint 2 · Group-call notification retraction

When a group call ends, the application refreshes the notification list for each user returned by
[`retractAll`](../../backend/src/domains/notify/service.ts). The service previously selected
recipients and then issued a separate delete. A concurrent change between those statements could
cause users to miss a refresh or receive a duplicate one.

The service now uses TypeORM's delete query builder with `RETURNING user_id`. PostgreSQL returns the
recipients of rows deleted by that statement. The existing kind and dedupe-key predicates apply to
both read and unread rows. The per-recipient dedupe constraint keeps recipients unique, and a repeat
on the same key with no matching rows returns an empty list.

## Verification

The integration probe ran both compiled services on a dedicated database in PostgreSQL 18.3 with
TypeORM 1.1.2. It checked read and unread rows, unread counts, kind and key filtering, and repeated
retractions. A query-runner barrier fixed the order of each race while allowing real database
inserts, deletes and concurrent calls to complete.

| Interleaving | Rows removed by the retraction | Recipients returned before | Recipients returned after |
|---|---:|---:|---:|
| An insert completes immediately before the retraction DELETE | 2 | 1 | 2 |
| The user dismisses one row immediately before the retraction DELETE | 1 | 2 | 1 |
| Two retractions overlap on the same two rows | 2 total | 4 total | 2 total |

Six interleaved trials used the same fixture of 8,000 background notifications. Each trial took 240
warm measurements per case, excluding fixture inserts. Values are ranges of trial percentiles.

| Case | Statements before → after | p50 before → after (ms) | p95 before → after (ms) |
|---|---|---|---|
| Four matching recipients | 2 → 1 | 0.633–0.774 → 0.414–0.459 | 0.904–1.227 → 0.612–0.839 |
| Missing key | 1 → 1 | 0.216–0.238 → 0.171–0.225 | 0.323–0.338 → 0.292–0.309 |

Raw trials are in `.playwright-mcp/product-review/notification-retraction/`. The absent-key plans
used an index scan on the synthetic dataset. The 8,000 background rows share one recipient, so
further index decisions require a fixture with representative recipient and key distribution.
The stable gain is one database statement per retraction with matching rows.

The isolated backend build and backend test typecheck passed. The notification row normalization,
reference parity, call schema, realtime frame and realtime hub suites passed 190 tests.

## Rollback and follow-up

Revert the `retractAll` method in `backend/src/domains/notify/service.ts` and rebuild. This is a
code-only change and rollback. Suggested commit message is
`fix(notify): return recipients from atomic notification retraction`.

A fan-out committed after the retraction statement is a distinct call lifecycle race. Start and
end currently publish notifications through separate post-commit courtesies in
[`afterVoiceChat`](../../backend/src/services.ts). Verify that ordering through the call ports
before making a separate lifecycle change.
