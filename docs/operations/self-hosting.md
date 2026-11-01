# Running Baziche on a server

The way from a clean clone to a server people can reach. Once it runs, [rollout.md](rollout.md) says
how to update it, roll it back and keep its database safe, and [runbooks.md](runbooks.md) what to do
about each alert it raises.

## What it needs

- **Node.js 24.11 or newer.**
- **PostgreSQL** with the `citext` and `pgcrypto` extensions available (most distributions ship them
  in their contrib package); the server creates both in its database. It is developed on
  PostgreSQL 18.
- **A proxy in front for TLS**, such as nginx. The server speaks plain HTTP, and in production it
  trusts `X-Forwarded-For`, so nothing but the proxy may reach its port: a port anybody else can
  reach lets a caller choose their own address.

**Run one process for each database.** One process serves the api, the realtime connection and the
pages. Who is online, quick play's picture of who is waiting, voice calls and every live update are
kept by the process that holds a player's connection, so players on two servers cannot find, hear or
reach each other, and each server would stand up the other's waiting players. A server that finds
another one using its database says so in its log.

## From a clone to a running server

1. As an ordinary account, not root (`sudo adduser nura`, say), clone the repository and run
   `npm ci` at its root. The server runs as whoever owns the clone.

2. Write the root `.env`. `npm run setup` writes one for this machine: it asks which database to use
   (Enter takes `baziche` on the local Postgres, as the user `postgres`), asks for that user's
   password when Postgres wants one, creates the database when it does not exist, and writes every
   name `.env.example` has, with a session secret made there, `HOST=127.0.0.1`, and the example's
   values for the rest. Copying `.env.example` by hand works too. Either way, every name must stay
   written, and three are yours to check:

   - `DATABASE_URL`: the database, empty the first time;
   - `SESSION_SECRET`: a long random string, such as the output of `openssl rand -hex 32`;
   - `PUBLIC_ORIGIN`: the address people use, such as `https://play.example.com`. It is the site
     in every sign-in message, the realtime origin check, the check every write is held to, and the
     cookie's site.

   Two more come with the project's own values in the example:

   - `ADMIN_WALLET_ADDRESS`: the wallet that opens `/admin` as its owner. Write your own.
   - The NuraChain block, `NURA_CHAIN_ID` to `NURA_MARKETS_ADDRESS`: the public NuraChain
     deployment. With it, the server verifies smart-contract wallets, reads people's on-chain
     profiles and NFTs, and offers donations, which it confirms on NuraChain. Paid tables, the shop
     and markets also need `NURA_REFEREE_KEY`, the key of the address those contracts name as their
     referee, seller and operator, so without it they stay off; a deployment of the contracts of your
     own ([NuraChain/SmartContract](https://github.com/NuraChain/SmartContract)) names a key of your
     own. Write the block empty and the server reads no chain at all.

   The server refuses to start with a `SESSION_SECRET` shorter than 32 characters, or a
   `PUBLIC_ORIGIN` that carries a path or an ending slash, or is plain http anywhere but this
   machine, and says which. A name taken out of the file stops it too, and it names the name. An
   optional feature (push notifications, the chain, metrics) stays off while its values are written
   empty. It listens on `HOST` at `PORT` (4900): `127.0.0.1` on the machine the proxy runs on, so
   nothing reaches it any other way. It runs as production whenever it is not started by
   `npm run dev`.

3. `npm run build`

4. `npm start`, kept running by whatever supervises processes on the machine. The logs are in
   `.logs/`. The first start builds the schema on an empty database. After an update that changes
   the entities, `npm run schema:sync` makes the database match them exactly, so a column an entity
   no longer has is dropped with everything in it: take a dump first ([rollout.md](rollout.md)).

5. Point the proxy at `http://127.0.0.1:4900` (or the `PORT` you wrote), upgrading the WebSocket
   on `/ws`:

   ```nginx
   map $http_upgrade $connection_upgrade { default upgrade; '' close; }

   server {
       server_name play.example.com;
       client_max_body_size 8m;

       location / {
           proxy_pass http://127.0.0.1:4900;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection $connection_upgrade;
       }
   }
   ```

   `client_max_body_size` is there for voice messages, whose files are up to 6 MiB: nginx refuses
   a body over 1 MB unless told otherwise, and a voice message of more than a few minutes would
   never arrive.

6. Check it: `curl -s http://127.0.0.1:4900/api/healthz` answers
   `{"status":"ok","database":true}`.

## Many players

Every player holds one realtime connection, which is two for the proxy (the player's, and its own to
the server), so nginx's default `worker_connections` (512, or 768 in Debian's `nginx.conf`) carries
only a few hundred players for each worker. For thousands, raise it in the `events` block
(`worker_connections 8192;`) with the files a worker may hold open (`worker_rlimit_nofile 16384;` at
the top level). The server itself takes up to 4,000 realtime connections and turns the next one
away; how it was measured is in
[the socket audit](../design/2026-10-28-socket-audit.md).

## Watching it

The server watches itself and says in its log when something crosses a line a person should act
on: one `alert raised` line at warn or error, and one `alert cleared` line when it is over. Each
alert, and what to do about it, is in [runbooks.md](runbooks.md). To watch it from outside as well,
point Prometheus, or anything that reads its text format, at `GET /api/metrics` with
`Authorization: Bearer` and the token written in `METRICS_TOKEN` (32 characters or more); with the
name written empty the endpoint is off.

## In a container

The repository's `Dockerfile` builds the client and the server in one stage and runs them in a
second, slim Node 24 image with production dependencies only, as the `node` user. Its header has the
commands:

```sh
docker build --build-arg PUBLIC_ORIGIN=https://play.example.com -t baziche .
docker run --rm --env-file .env baziche node .dist-backend/db/sync-cli.js
docker run -d --name baziche --restart unless-stopped --env-file .env -p 127.0.0.1:4900:4900 \
    -v baziche-logs:/app/.logs baziche
```

The second makes the database match the entities, as `npm run schema:sync` does, for after an update
that changes them (take a dump first). A container's `127.0.0.1` is its own, so inside one the server binds `0.0.0.0`:
write `HOST=0.0.0.0` in the `.env` the container is given, since it wins over the image's, and point
`DATABASE_URL` at a Postgres the container can reach. Publish the port to the proxy alone, as above.
`PUBLIC_ORIGIN` is a build argument as well as a name in the `.env`, because the client's link
preview is written against it when it is built.

## Updating

`git pull`, `npm ci`, `npm run build`, `npm run setup` (it adds any name the update put in
`.env.example`, a feature's empty, and changes nothing else), `pg_dump` the database,
`npm run schema:sync`, then restart the server. [rollout.md](rollout.md) has the same steps as
commands, with how to see what an update changes first and how to go back.

A running server serves the pages of the build it started on, and a build in its folder deletes the
files those pages name, so between the build and the restart most pages a browser has not opened
before would fail. The server notices when a build is finished under it, says so in its log and
stops with exit code 75, for whatever supervises it to start it again on the new build; started by
hand, start it again.

## Backups

The database is the one thing here that cannot be built again: every account, friendship, table,
game, sealed message and uploaded picture lives in it. The build, the games, their rules and the
achievements come back from the repository. `pg_dump` it on a schedule and keep the copies
somewhere else; [rollout.md](rollout.md) says how to restore one. Keep the `.env` beside the dumps as
well: under a new `SESSION_SECRET` no message sent before the change can be reported any more.

A production database holds nothing made up. The server writes the games, their rules and the
achievements on every start; every person, table, message and score is made by the people using it.
The test accounts the project uses are written only in development.

## Once it runs

- [runbooks.md](runbooks.md): every alert the server raises, what it means and what to do, and
  what to do when a server key leaks, a paid game is never paid, or the database goes;
- [rollout.md](rollout.md): updating without losing anything, rolling back, backups and restoring;
- [mainnet.md](mainnet.md): before real money, the steps that are the owner's (a key of the
  server's own, the contracts' admin behind a multisig, where markets are offered, an audit);
- [compliance.md](compliance.md): what the product enforces for paid play, markets, donations and
  the shop, and the questions for a lawyer before any of it is opened anywhere.
