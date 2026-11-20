# Notification regression

[`tools/review/notifications.mjs`](../../tools/review/notifications.mjs) runs the notification
retraction, group-call lifecycle and chat delivery regressions against a disposable PostgreSQL database.
It builds the fixtures in an empty database on loopback and exits if it finds any existing
application tables. The default test suite stays independent of PostgreSQL.

Compile the backend into a separate directory and create a fresh database on your local test
instance. Use a role that can create the extensions and schema in that database.

```powershell
npm exec -w backend -- tsc -p tsconfig.json --outDir ../node_modules/.cache/review-notifications
createdb -h 127.0.0.1 -p 55491 -U postgres baziche_notification_test
$env:PGUSER = 'postgres'
$env:QA_NOTIFY_PORT = '55491'
$env:QA_NOTIFY_DATABASE = 'baziche_notification_test'
$env:QA_NOTIFY_BUILD = 'node_modules/.cache/review-notifications'
node tools/review/notifications.mjs
```

The regression checks exact retraction recipients for concurrent insert, dismissal and overlapping
deletes. It exercises the real call start and end ports and verifies both commit orders with
PostgreSQL lock observations. It also checks normal delivery, read and unread behavior, filter
scoping and repeated retraction. The fixture database remains available for inspection after
the run.

The chat cases generate a device, a signed epoch, sealed text and encrypted album items. They
fetch already committed messages through the chat port and mark the conversation read before
resuming delayed fan-out. A delayed send used to create an unread notice in both cases.
Publication now uses the messages' database timestamps and the recipient's locked read watermark.
Both SQL write orders are covered. The tests also verify the album file count, deduplication
across a read notice, mute filtering, and delivery of an older message after a newer one.
The [album benchmark](album-notification.md) measures the single upsert that fans out the batch.

Verified on PostgreSQL 18.3. The current build passed. The build before atomic retraction failed
at the concurrent insertion assertion, and the build before the lifecycle guard failed at the
obsolete invite assertion. The build before the chat watermark guard failed at the late notification
assertion. A rerun against the populated fixture database was refused.
