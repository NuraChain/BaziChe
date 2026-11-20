# Notification regression

[`tools/review/notifications.mjs`](../../tools/review/notifications.mjs) runs the notification
retraction and group-call lifecycle regressions against a disposable PostgreSQL database.
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
scoping, repeated retraction and ordinary message coalescing. The fixture database remains
available for inspection after the run.

Verified on PostgreSQL 18.3. The current build passed. The build before atomic retraction failed
at the concurrent insertion assertion, and the build before the lifecycle guard failed at the
obsolete invite assertion. A rerun against the populated fixture database was refused.
