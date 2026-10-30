# Nura Arcade

A place to play Ludo, Hokm, Backgammon, Poker and Chess with friends, or with anyone looking for a
game. Make friends, start groups and chat privately, in English or Persian.

## Running it on your own machine

It needs Node 24.11 or newer and PostgreSQL. At the root of the repository:

1. `npm ci`
2. `npm run dev`, then open http://localhost:3100. The first time it asks which database to use
   (Enter takes `postgres://postgres@127.0.0.1:5432/baziche`; put the password in the url if
   Postgres wants one), makes that database if Postgres has none of that name, and writes the root
   `.env` for this machine. `npm run setup` does the same on its own.
3. Or the way a server runs it: `npm run build`, then `npm start`, and open http://localhost:4900.
   A first start on an empty database builds it.

The same `.env` serves both. Playing for NURA, the shop and markets stay off until the server is
given a NuraChain key, and each says so where it would be. When an update adds a name to
`.env.example`, `npm run dev` and `npm start` say which, and `npm run setup` adds it to `.env`,
empty, changing nothing else.

## Running it on a server

It needs Node 24.11 or newer, PostgreSQL with the `citext` and `pgcrypto` extensions available,
and nginx (or another proxy) in front for TLS. One process serves the api, the realtime
connection and the pages. Run one such process for each database: who is online, quick play's
picture of who is waiting, voice calls and every live update are kept by the process that holds a
player's connection, so players on two servers cannot find, hear or reach each other, and each
server would stand up the other's waiting players. A server that finds another one using its
database says so in its log.

1. As an ordinary account, not root (`sudo adduser nura`, say), clone the repository and run
   `npm ci` at its root. The service runs as whoever owns the clone.
2. Copy `.env.example` to `.env`. Every name in it must stay written; fill in these three:
   - `DATABASE_URL` pointing at an empty database;
   - `SESSION_SECRET`: a long random string, such as the output of `openssl rand -hex 32`;
   - `PUBLIC_ORIGIN`: the address people use, such as `https://play.example.com` (it is the site
     in every sign-in message, the realtime origin check and the cookie's site).

   The server refuses to start with a `SESSION_SECRET` shorter than 32 characters, or a
   `PUBLIC_ORIGIN` that carries a path or an ending slash, or is plain http anywhere but this
   machine, and says which. The optional features (push notifications,
   the chain, the admin) stay off while their values are empty, and a name taken out of the file
   stops the server, which names it. It listens on `HOST` at `PORT` (4900) for the proxy: write
   `127.0.0.1` on the machine the proxy runs on, so nothing reaches the server any other way (the
   example's `0.0.0.0` is for a container, whose own `127.0.0.1` nothing outside it reaches). The
   server runs as production whenever it is not started by `npm run dev`.
3. `npm run build`
4. The first start builds an empty database from the entities. After every update that changes
   them, `npm run schema:sync` makes the database match the entities exactly, so a column an
   entity no longer has is dropped with everything in it: take a dump first (below).
5. `npm start` runs the server; keep it running with whatever supervises processes on the
   machine. The logs are in `.logs/`.
6. Point the proxy at `http://127.0.0.1:4900` (or the `PORT` you wrote), upgrading the WebSocket
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

   `client_max_body_size` is there for voice messages, whose files are up to 6 MiB: nginx refuses a
   body over 1 MB unless told otherwise, and a voice message of more than a few minutes would never
   arrive.

   Every player holds one realtime connection, which is two for the proxy (the player's, and its
   own to the server), so nginx's default `worker_connections` (512, or 768 in Debian's
   `nginx.conf`) carries only a few hundred players for each worker. For thousands, raise it in the
   `events` block (`worker_connections 8192;`) with the files a worker may hold open
   (`worker_rlimit_nofile 16384;` at the top level). The server itself takes up to 4,000 realtime
   connections and turns the next one away.

   The server watches itself and says in its log when something crosses a line a person should
   act on: one `alert raised` line at warn or error, and one `alert cleared` line when it is over.
   To watch it from outside as well, point Prometheus, or anything that reads its text format, at
   `GET /api/metrics` with `Authorization: Bearer` and the token written in `METRICS_TOKEN` (32
   characters or more); with the name written empty the endpoint is off.

To update: `git pull`, `npm ci`, `npm run build`, `npm run setup` (it adds any name the update put
in `.env.example`, a feature's empty), `pg_dump` the database, `npm run schema:sync`, then restart
the server. A running server serves the pages of the build it started on, and a build in its folder
deletes the files those pages name, so from the build until the restart most pages a browser has
not opened before fail. The server notices when a build is finished under it, says so in its log
and stops with exit code 75, for whatever supervises it to start it again on the new build; started
by hand, start it again.

Back up the database, because it is the only thing here that cannot be built again: every
account, friendship, table, game, sealed message and uploaded picture lives in it. The build, the
games, their rules and the achievements come back from the repository. `pg_dump` it on a schedule
and keep the copies somewhere else; to restore, create an empty database, load the dump with
`psql`, and start the service. Keep the `.env` beside the dumps as well: under a new
`SESSION_SECRET` no message sent before the change can be reported any more.

A production database holds nothing made up. The server writes the games, their rules and the
achievements on every start; every person, table, message and score is made by the people using
it. The test accounts the project uses are written only in development.

Once it runs:

- `docs/operations/runbooks.md`: every alert the server raises, what it means and what to do, and
  what to do when a server key leaks, a paid game is never paid, or the database goes;
- `docs/operations/rollout.md`: updating without losing anything, rolling back, backups and
  restoring;
- `docs/operations/mainnet.md`: before real money, the steps that are the owner's (a key of the
  server's own, the contracts' admin behind a multisig, the markets contract, an audit);
- `docs/operations/compliance.md`: what the product enforces for paid play, markets, donations and
  the shop, and the questions for a lawyer before any of it is opened anywhere.

Licensed under the [MIT License](license).
