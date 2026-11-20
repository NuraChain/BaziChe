# Album notification fan-out

The [album send service](../../backend/src/services.ts) persists two to ten independent encrypted
messages in a database transaction. It used to upsert the same notification row for every file and
recipient to increment its count. The album now supplies one count equal to the number of committed
files in a single upsert. The recipient list and mute and block predicates are evaluated once for
the album. Each eligible recipient gets one refresh and push wake.

The probe called the real service on disposable PostgreSQL 18.3 using generated devices, sealed
files, a private group, one ordinary recipient and one muted recipient. It alternated baseline and
candidate on the same database for three trials per build, with four warmup and twelve measured
requests at each album size per trial. The timings include the transaction and the notification.

| Files | Notification upserts | Total SQL statements | p50 before → after (ms) | p95 before → after (ms) |
|---:|---:|---:|---:|---:|
| 2 | 2 → 1 | 29 → 28 | 10.78–12.79 → 10.39–11.54 | 12.10–19.09 → 12.49–13.65 |
| 10 | 10 → 1 | 117 → 108 | 39.29–44.38 → 33.55–41.29 | 42.70–50.52 → 36.53–44.25 |

Ranges show the lowest and highest percentile across the three trials. The improvement in query
count is deterministic. The samples are local service timings and overlap. Both builds preserved
message order, the deduped count after new, unread and read notices, the mute filter, the recipient
of the refresh and the behavior of the existing notification read watermark. The album now has a
single publication point for a mute, block, mark or dismiss that happens during fan-out.

The [album transaction](../../backend/src/domains/chat/service.ts) still validates and writes each
file independently, and gives each its own database timestamp to keep the thread in order. Its
query cost needs separate evidence before changing those writes. Rollback consists of reverting
the album fan-out and the notification upsert count parameter. The change needs no migration.
