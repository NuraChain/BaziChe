# The realtime socket, audited and loaded

The production brief's third phase (PB3): audit the realtime path, load it reproducibly toward
three thousand clients (ramps of 100, 500, 1,000, 2,000 and 3,000; games with spectators; a large
audience; a reconnection storm; slow clients; a soak), say the numbers as measured, and fix what
they show. This is the ledger: what the socket does, how it was measured, what each run found, what
changed, and what is not tested and why. Every number here was measured on one machine, a Windows 11
desktop that runs the clients, the server and Postgres together; none is a promise about another.

## What the socket does (read in the code, 2026-10-28)

| Item | What the code does | Where |
|---|---|---|
| Admission | A socket is admitted on its session cookie and an origin that is ours (`isOurs`); an unsigned socket is closed 4401 after 5 s, and at most four frames are buffered before it is known (a fifth is 4400) | `realtime/admit.ts`, `gateway.ts` (`AUTH_DEADLINE_MS`, `PRE_AUTH_FRAMES`) |
| Handshakes | 300 a minute an address, read from the right of `X-Forwarded-For` behind the proxy, an IPv6 address by its /64, the table of addresses capped | `realtime/handshake-limit.ts`, `limits.ts` |
| Sockets | 16 an account (the newest refused 4429, never the oldest evicted); `SOCKETS_MOST` a process, past which the upgrade is answered 503 | `limits.ts`, `hub.bind`, `gateway.ts` (`maxConnections`) |
| Liveness | the server pings every 15 s and waits 10 s for the pong; the browser probes a socket it holds after 10 s of silence, and asks at once when the tab is seen again, when the network comes back and when an ack is late | `gateway.ts` (`HEARTBEAT_MS`, `PONG_TIMEOUT_MS`), `realtime.store.ts` |
| Inbound | every frame parsed totally and strictly (an unknown key is 4400); each kind held to a floor (`sync` 5 s, `presence` 2 s, `typing` 3 s, `see` 1 s: the eleventh inside its floor in a minute is 4400) or to a budget in ten seconds (`voice` 30, `signal` 120, `sound` 250, `play` 40, `ping` 10: past it 4429), never to neither; 4 KB a frame, a signal excepted | `frames.ts`, `gateway.ts` |
| Outbound | one first-in, first-out outbox a socket; each frame stamped with the socket's ordinal `n` as it is decided; a socket 256 frames or 256 KiB behind is closed 4413, never quietly lossy; sound the one lossy send (dropped while the socket has anything waiting) | `hub.ts` (`emit`, `OUTBOX_FRAMES`, `OUTBOX_BYTES`, `sounded`) |
| Sessions | every live session asked again at each sweep; a socket whose session has ended is closed 4401 | `hub.sweep` |
| Presence | told to somebody's own sockets, their friends' and any socket whose page shows them (`see`), the policy asked of each | `hub.ts` (`audienceOf`, `entriesFor`) |
| Memory | every registry let go when somebody's last socket goes (presence after its linger, calls, looks at tables, edges, whom a page showed) | `hub.release`, `hub.sweep` |
| Scale-out | none: presence, calls, pushes and the doorbells are one process's memory, and one server per database is the design (`README.md`); a server that finds another on its database says so | `jobs.otherServers` |

## How it was measured

`tools/qa/crowd-pass.mjs` (its notes are in `tools/qa/CLAUDE.md`, *The networking passes*): the
built server in production on this machine, a database nobody else uses, the limiter raised. Every
client is an account of its own signed in from an address of its own (`X-Forwarded-For`, which a
production server trusts behind its proxy), so neither the handshake ceiling nor the sign-in budget
of one address stands in for a crowd. The clients live in four processes of their own, so the
generator is never the limit, and each reports its own event loop (its longest wait was never over
40 ms). Every frame's ordinal is checked for a gap or a repeat; every `watch` frame is stamped on the
clock every process on the machine shares, and a move is timed from the moment the pass asked for it
to each watcher's frame. The server's memory is read by its pid, and its own health from the
admin's overview: how much of the last full minute its event loop was busy, the longest it waited
past its own tick, the pool, the sockets and the hour's failures.

## What each run found

**The first run** (the build of `bff8a06f`, `SOCKETS_MOST` 2,000), a ramp only:

| Sockets | hello p95 | presence frames that level | event loop |
|---|---|---|---|
| 100 | 105 ms | 5,050 | idle |
| 500 | 492 ms | 118,744 | 15% busy |
| 1,000 | 1,257 ms | 371,250 | 15% busy |
| 2,000 | 2,274 ms | | 48% busy, a 269 ms stall |
| 3,000 | | | 996 refused at the ceiling |

Two faults. Four of two thousand sockets were closed 4401 for no reason: the session sweep read the
live sessions, awaited the database, and closed every socket whose session was not in the answer,
including sockets that had connected while it waited. Fixed in `6513cbfe` (a socket bound during the
await keeps its session until the next sweep asks about it). And presence grew with the square of
the sockets: every arrival, departure and change of state went to every socket the policy let see
it, and strangers see strangers, so the thousandth socket was told about nine hundred and ninety-nine
people and nine hundred and ninety-nine were told about it.

**The presence interest model** (`3472b6c5`): somebody's presence goes to their own sockets, their
friends' and any socket whose page names them in a `see` frame; the browser learns whom it shows
from the presence reads inside its renders (`.claude/rules/chat-and-keys.md`, *Presence is told to
the sockets that care*). The second run, the same ramp:

| Sockets | hello p95 | presence frames that level | event loop |
|---|---|---|---|
| 100 | 51 ms | 100 | idle |
| 500 | 51 ms | 400 | idle |
| 1,000 | 41 ms | 500 | idle |
| 2,000 | 44 ms | 1,000 | 9% busy, a 24 ms stall |

One snapshot a new socket, and nothing else. 2,000 was then a ceiling far under what one process
held, so `SOCKETS_MOST` went to 4,000: a third over the brief's three thousand.

**The third run** (the whole pass, to 3,000) was clean to 3,000 sockets and for twenty watched games,
and failed three parts, none of them the server's. 1,135 of 2,998 table reads sent in one instant
failed before they reached it, so those watchers were never counted as looking and missed every
move; and a storm in which the clients closed their own sockets and opened new ones at once came
back 1,001 short. The machine's ephemeral range is 1024 to 15000 (13,977 ports), the clients and the
server share it, and a port stays taken for two minutes after its connection closes, held by
whichever side closed first: 3,000 open sockets, 6,000 sign-ins, 3,000 reads and 3,000 sockets in
`TIME_WAIT` beside 3,000 new ones do not fit. A burst of 1,500 requests from one process with the
ports free was answered whole. So the pass now opens a table's page thirty-two at a time a process
over connections kept alive, which is people arriving over two seconds, and its storm is the server
going away, which is what a deploy does to every player at once and leaves the clients' ports free;
and every failure keeps its cause, so a port this machine lacks and a server that said no are never
counted as one thing again.

**The fourth run**, the whole pass, clean, 23 checks:

| Part | What was measured |
|---|---|
| Ramp | hello p95 86, 90, 63, 58 and 62 ms at 100, 500, 1,000, 2,000 and 3,000 sockets; every socket open after 15 s; the server 252 MB with none and 258 MB with 3,000; the event loop 15% busy, its longest stall 25 ms |
| 20 games, 10 watching each | 600 moves, 6,000 frames: from the move's request to the watcher's frame p50 10 ms, p95 13, p99 16, at most 23; none missing or twice |
| One game, 2,998 watching | every watcher's page opened (2,998 answered in 1.9 s); 30 moves, 89,940 frames, each 875 bytes: p50 117 ms, p95 225, p99 261, at most 307; to the last watcher of each move p50 220, p95 280, p99 307; none missing or twice |
| 50 sockets that stop reading | each let go 25 s after it stopped (the server's ping and its pong's deadline), the others p50 102 ms, p95 178, p99 223, none missing |
| The server killed and started again under 3,000 sockets | gone 265 ms after the kill, answering 3.4 s after it; every socket greeted again from the kill p50 4.27 s, p95 4.39, p99 7.28, at most 7.50, 2,895 at their second try and 105 at their third (the browser's own backoff, 1, 2 and 4 s with a tenth either side); none lost a frame |
| Soak, 120 s of the twenty games | p50 78 ms, p95 109, p99 139; the server's memory rising with its heap and falling at each collection, 314 MB at the start and 287 MB at the end |

**The ceiling** (the fifth run, a ramp to 4,000 and past it), clean, 10 checks: hello p95 69, 70, 74
and 76 ms at 1,000, 2,000, 3,000 and 4,000 sockets; the server 317 MB with none and 337 MB with
4,000, about five kilobytes a socket; the event loop 23% busy, its longest stall 32 ms; and of fifty
more past the ceiling none was let in (each answered 503) while all 4,000 stayed open.

## What limited it, and what was left

- **Presence** limited it, and is fixed: quadratic before, one snapshot a socket now.
- **The session sweep** dropped sockets that connected while it waited, and is fixed.
- **`SOCKETS_MOST`** was 2,000; it is 4,000, and a newcomer past it is turned away with 503 while
  nobody already held is dropped.
- **A crowd on one game** is the slowest thing measured: 2,998 watchers had a move by p95 225 ms, the
  last of them by p95 280 ms. Each watcher's frame is serialised for its own socket, because its
  ordinal is inside it; serialising the frame once and stamping each copy is the change that would
  cut that, and it was not made: the fan-out never held the event loop past 54 ms, and a quarter of a
  second for the last of three thousand people watching one game is not a delay anybody waits on.
- **The server's restart** is most of a storm's length: 3.4 s before it answered, then the browser's
  backoff. A socket that missed the first rung waited for the next.

## What is not tested, and why

- **More than one process.** The design is one server per database; `cross-pass.mjs` holds what
  holds across two and what does not.
- **A real network between the clients and the server.** Every client here is on loopback, so the
  numbers are the server's and the machine's, not a line's. The latency pass measures one spectator
  behind lines of 150 and 400 ms; a crowd on real radios is not measured.
- **TLS and nginx in front.** The crowd speaks plain HTTP to the process. Every player is two
  connections for the proxy, and nginx's default `worker_connections` (512, or 768 in Debian's
  configuration) carries a few hundred players a worker; `README.md` says to raise it.
- **A smaller machine.** A VPS with one or two cores has a fraction of this one; the ceiling is the
  same number there, and how near to it that machine stays healthy is not measured here.
- **Browsers.** The crowd's clients are Node sockets that speak the wire as a browser does. What a
  page spends drawing a move is the browser's, not the server's.
