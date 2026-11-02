# Updating, rolling back, and keeping the database safe

[self-hosting.md](self-hosting.md) sets a server up. This is what to do with one that is running:
update it without losing anything, go back when an update goes wrong, and keep copies of the one
thing that cannot be built again, the database.

## What a restart costs

One process serves everything, so an update is a restart. While it is down nobody can play or
write; when it is back every browser reconnects by itself on its own backoff (measured: under 3,000
connections, every one greeted again within 4.4 s at the 95th percentile). What lives only in the
process's memory starts again: who is online, quick play's waits (a waiting player whose browser
comes back keeps their chair), voice calls (joined again from the table), the monitor's measures and
alerts (the first sample, thirty seconds in, raises again what still holds), and parties being
formed. Games in progress are in the database and carry on; a turn's clock kept running meanwhile.
The money workers read every unfinished record again at start and carry on from where they were,
and nothing they finish is finished twice.

So: update when few are playing, and say so first with an announcement (Admin › Announcement, a
line at the top of every page for as long as you choose).

## Updating

```sh
cd ~/arcade                                    # wherever the clone is
pg_dump --format=custom --file="$HOME/dumps/baziche-$(date +%Y%m%d-%H%M).dump" "$DATABASE_URL"
git fetch
git log --oneline HEAD..origin/main            # what is coming
git diff --stat HEAD origin/main -- backend/src/entities   # whether the database's shape changes
git pull
npm ci
npm run build
npm run setup                                  # adds any name the update put in .env.example
# restart the service with whatever supervises it: it migrates the database before it serves
curl -s http://127.0.0.1:4900/api/healthz      # {"status":"ok","database":true}
```

Every start brings the database to its version by itself (`backend/src/db/migrate.ts`): each
migration the update brought (`backend/src/db/migrations/`) runs once, in order, in a transaction of
its own, and the first that fails is rolled back and stops the start, with the reason in the log and
nothing half done. The server then refuses to start rather than serve a database it does not match.
Two servers on one database migrate once. The dump still comes first, every time: a migration is
code, and code can be wrong. `DATABASE_URL` is the one in the server's `.env`.

### The first start of a database from before versions

A database built before migrations existed is adopted at its first start: when it already matches
the entities, or only lacks what can be added without losing anything, it is brought to them and
versioned from then on. When matching them would drop a column or a table with what is in it, the
start stops and says which: take a dump, run `npm run schema:sync` once (it drops them), and start
again. That happens once, and never after.

### Changing an entity

Change the entity, then write its migration against the development database and read it:

```sh
npm run migration:new -- AddChannelTopic     # writes backend/src/db/migrations/<time>-AddChannelTopic.ts
```

It refuses while a migration is still pending there, and refuses one that would lose data unless
`--allow-loss` says that was meant. Start the server to apply it, and commit it with the entity. A
start that finds the entities and the database still apart says so in a warning naming the
statements: an entity changed with no migration for it. A CHECK whose rule changed needs no
migration: every start compares the rules and rewrites them when they moved.

`npm run migrate` does what a start does, without starting; `npm run schema:sync` is still there for
a development database to be reset to the entities, and for the one-time adoption above.

After the restart: Admin › Overview should say nothing needs you, and the server's log should hold
no `error` line from the start.

## Rolling back

- **The update did not change the entities** (the `git diff` above was empty): go back to the
  commit that was running, build it and restart. Nothing in the database needs to move.

  ```sh
  git checkout <the commit that was running>
  npm ci && npm run build
  # restart
  ```

- **It did change them**: the old code expects the old shape, which the start has already migrated. Restore the dump taken before the update into a new database (below), point
  `DATABASE_URL` at it, and start the old build there. Everything written since the dump is lost,
  so when the update has run for a while, mending forward with a fix is usually the better way.

A money record written after the dump and lost with a rollback is still on NuraChain: the
reconciliation compares each one, and what it cannot put right it lists for a person (Admin › Money
› Checks against NuraChain).

## Backups

Every account, friendship, table, game, sealed message, report, staff action and money record is in
the database; the build, the games, their rules and the achievements come back from the repository.
Dump it on a schedule, keep the copies on another machine, and keep the `.env` with them (under a new
`SESSION_SECRET` no message sent before the change can be reported any more).

```sh
# a dump, compressed, in the format pg_restore reads
pg_dump --format=custom --file="$HOME/dumps/baziche-$(date +%Y%m%d-%H%M).dump" "$DATABASE_URL"
```

A daily dump with a week of them kept is a floor; a server that takes real money wants them more
often, and copied off the machine as soon as they are made.

## Restoring

```sh
createdb baziche_restored
pg_restore --no-owner --dbname=baziche_restored "$HOME/dumps/baziche-<when>.dump"
```

Then write `postgres://…/baziche_restored` as `DATABASE_URL`, start the server, and watch Admin ›
Money › Checks against NuraChain for the next few minutes: the reconciliation compares every money
record that can still change with what NuraChain holds, and anything the dump did not know about
is listed there.

A backup nobody has restored is a hope. Restore one into a database nobody uses from time to time,
start a server on it, and sign in.
