# Group-call notification ordering

The call service commits the transition to live or ended before the notification work in
[`afterVoiceChat`](../../backend/src/services.ts). The start and end requests can overlap.
On PostgreSQL, pausing the start request before it wrote notifications, ending that call, and
resuming the start created one invite and sent one refresh for an already ended call. The atomic
delete from checkpoint 2 correctly returned an empty list when it ran before that insert.

The group-call producer now passes its call ID to
[`tellAll`](../../backend/src/domains/notify/service.ts). The existing insert reads the live call
under a PostgreSQL `FOR SHARE` row lock. If fan-out acquires the lock first, the end update waits
for notification publication to commit and the end handler deletes those rows. If the end update
acquires the lock first, the fan-out waits, reevaluates the live predicate and inserts nothing.
The lock check is part of the same database statement as the insert.

## Verification

The probe called the real group-call `ring` and `end` ports against a dedicated PostgreSQL 18.3
database. Test barriers ordered real database statements. PostgreSQL reported the blocked
sessions through `pg_blocking_pids`.

| Scenario | Result after the change |
|---|---|
| End completes while start fan-out is waiting to issue SQL | Zero obsolete rows and zero notification refreshes |
| End updates the call before committing, then fan-out starts | Fan-out waits for the end commit and skips the invite |
| Fan-out writes first and pauses before commit | End waits for publication, then deletes the invite |
| The group starts a fresh call and ends it normally | One invite reaches the other member and is removed on end |
| Two ordinary chat publications use the same dedupe key | One row retains a count of two |

The baseline and candidate results are in
`.playwright-mcp/product-review/notification-call-lifecycle/`. The isolated backend build and
test typecheck passed, along with the 190 notification normalization, reference, call schema
and realtime tests.

## Rollback and follow-up

Revert the call ID argument in `backend/src/services.ts` and the dependent input and SQL guard in
`backend/src/domains/notify/service.ts`, then rebuild. The schema is compatible with either
version. Suggested commit message is `fix(notify): guard group-call invites with call state`.

Two follow-up database checks remain separate from this race. Measure call-end lock waits with
large groups before changing publication strategy. The chat album path currently runs one
`tellAll` upsert per item to increment its unread count. Measure real album sizes and query cost
before choosing a batch design that preserves those counts and the read watermark.
