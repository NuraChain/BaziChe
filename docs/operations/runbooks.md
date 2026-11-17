# Runbooks: what the server says, and what to do about it

The server watches itself and the work it is behind on, and says when something crosses a line a
person should act on. Each alert below is what it means, what to look at, and what to do. The
numbers are the ones `backend/src/ops/measures.ts` judges against; why each is what it is, is in
`docs/design/2026-10-28-operations-design.md` (3.3).

## Where an alert is said

- **The server's log** (`.logs/`): one `alert raised` line at `warn` or `error` when it crosses,
  with `alert`, what it is `about` (a route family, a queue, a worker), its `value` and its
  `limit`, and one `alert cleared` line at the same level when it is over. Nothing is repeated
  while it stands, so a filter on the level sees both ends.
- **Admin › Overview**, under "Needs you", for whoever's role opens it: the server's alerts to an
  admin and the owner, the money's to a role that opens Money. Each row leads to the panel it is
  about.
- **`GET /api/metrics`**, for a monitor outside (Prometheus or anything that reads its text
  format), with `Authorization: Bearer` and `METRICS_TOKEN`: `baziche_alert{alert="…",level="…"}`
  is 1 while an alert stands, with `about` where it has one.

The monitor keeps what it has seen in memory, so a restart forgets it; the first sample after a
start, thirty seconds in, raises again whatever still holds.

## The server's alerts

### `sockets-full`

**Means** somebody's realtime connection was turned away in the last ten minutes because this
process holds its ceiling, 4,000 sockets.

**Look at** Admin › Overview › This server: sockets open, and the hour's sockets by close code and
by why an upgrade was refused (`ceiling`).

**Do** check that one server serves this database: a second process on the same database splits
the players and each turns people away on its own (the server says `another server is using this
database` in its log when it finds one). Raise the ceiling only after a load run on this machine,
because a socket costs memory and every move costs every watcher.

### `sockets-behind`

**Means** ten or more sockets were closed in ten minutes for falling 256 frames or 256 KiB behind
(close code 4413). One now and then is a phone on a bad line; ten is the server, or a crowd.

**Look at** the watchers' delay and the event loop beside it (This server), and whether one game
has thousands watching.

**Do** if the event loop is busy, find what is busy (the last failures, the hour's requests by
address); if one game draws a crowd, nothing is wrong with the players' own games, whose frames go
first.

### `watch-slow`

**Means** a spectator was handed moves a second or more after they were made, at the 95th
percentile of the last five minutes, over at least 50 frames. Measured on this machine: 13 ms with
twenty games watched, 225 ms with 2,998 people watching one game.

**Look at** the event loop's busy share and longest wait, and how many watch each live game
(Admin › Online now names who sits where).

**Do** as for `sockets-behind`. A board a second behind its players is a fact a spectator sees,
not an outage.

### `errors` (by route family)

**Means** ten or more answers of 500 or over from one family (`/api/tables`, `/api/shop`, the
pages…) in ten minutes, or 5% or more of at least 20 requests. A 5xx is always the server's.

**Look at** This server › The last failures (method, path and status, the exact time under a
pointer), and the server's `error` lines at those times. Then the database pool (connections open,
idle and waiting): a pool with requests waiting is a database slow or down.

**Do** follow the error lines. A deploy that brought them is rolled back
(`docs/operations/rollout.md`); a database that is down is the database's runbook below.

### `backlog` (positions, claims, orders, gifts)

**Means** the oldest of that queue has waited ten minutes or more: a market position handed in and
not yet read off NuraChain, a claim handed in and not read, a shop order on its way, or a gift on
its way. A transaction the chain has taken is read back within one pass, two or three seconds, so
ten minutes is a chain that is not mining or a worker that is not moving.

**Look at** whether `chain-down` stands beside it (NuraChain out of reach); the worker's own `warn`
lines in the log, which name the record and the error; Admin › Overview › Work waiting, each
queue's count and its oldest.

**Do** if NuraChain is reachable and mining and the worker says nothing, restart the server: the
workers read every unfinished record again at start and carry on, and nothing they finish is
finished twice (each finish is guarded by the record's state).

## The money's alerts

### `payments-stuck`

**Means** a paid game whose lock or payout has been on its way ten minutes or more, by the rule the
vault's panel shows.

**Look at** Admin › Money (each stuck game, since when), the stake worker's `warn` lines, and the
referee's balance: the server's key pays NuraChain's gas for every lock and payout.

**Do** fund the referee if it is short (any wallet can send it NURA); check the vault is not paused
(Money says so, and the owner unpauses from there). If the server can never pay a game, its players
are not stuck with it: the vault lets anybody return every stake of a game three days after it was
opened (`reclaim`, which the wallet page offers its players), and the server, finding them taken
back, pays nothing.

### `markets-late`

**Means** a market whose game is over and whose close has passed has waited ten minutes or more to
be settled or called off.

**Look at** the market worker's `warn` lines and the referee's gas (the server's key settles
markets as their operator).

**Do** fund the key if it is short. A market the server never settles is not stuck for its bettors:
a week after its close anybody may `expire` it on the contract, which returns every stake.

### `locks-failed`

**Means** three or more stakes failed to lock in the last hour. One is a player who took their NURA
out between Ready and the lock; three is a paused vault, a referee short of gas, or a fee changed
under Readies already signed.

**Look at** Money (paused? the fee), the referee's balance.

**Do** unpause, fund, or leave the fee be while tables wait: a Ready names the fee it was signed
for, and a changed fee makes it unusable, so the players sign again.

### `workers-failing` (stakes, markets, shop, gifts)

**Means** a record whose step has failed at every pass for two minutes. An `error` for the stakes
and the markets, a `warn` for the shop and the gifts.

**Look at** that worker's `warn` lines: they name the record and the error.

**Do** follow the error. A refusal the chain explains (a paused contract, gas) is fixed there; a
record the server cannot move by itself is a disagreement (`checks-open`) for a person.

### `chain-down`

**Means** NuraChain could not be reached at two reconciliation passes in a row, two minutes in which
nothing settles.

**Look at** `NURA_RPC_URL` from this machine: `curl -s -X POST -H 'content-type: application/json'
--data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$NURA_RPC_URL"` answers
`{"jsonrpc":"2.0","id":1,"result":"0x3fc"}` (1020) when the node is there.

**Do** wait out a node's outage: every worker carries on from where it stopped once it answers, and
nothing a player signed runs out unseen (a stake's signature, a quote, a ticket each carry their own
deadline, and the contract refuses a late one). Point `NURA_RPC_URL` at another node of NuraChain
only if the outage is that node's.

### `checks-open`

**Means** the database and NuraChain disagree about a money record, and the reconciliation could
not put it right itself (it puts right only what one of the workers' own guarded writes can).

**Look at** Admin › Money › Checks against NuraChain (`/admin/money/checks`): each disagreement says
what each side holds, its record and since when.

**Do** decide from what NuraChain holds, which is where the money is. Mend the database's side by
hand where the chain is right, or act on the chain (a refund, a reclaim) where the database is, and
close the check with a reason: a closed check stays closed while both sides say what they said, and
the log keeps who closed it and why.

## Rewards

The daily check-in, the quests and their NURA (`docs/design/2026-11-16-rewards-design.md`). Earned
NURA is a row in `reward_grants`; it leaves only when the player withdraws it, as a payout the
rewards worker sends from the rewards wallet. The whole system ships switched off.

**Where to look:** Admin › Rewards (the switch, the amounts, the looks, the budget, freezing), and
`GET /api/metrics`: `baziche_rewards_on`, `baziche_rewards_granted_today_nura`,
`baziche_reward_payouts{state="waiting"|"failed"}` (failed: in the last day),
`baziche_reward_payouts_oldest_seconds` and `baziche_rewards_wallet_nura` (absent with no wallet,
or when the chain did not answer the sample). A wallet too low for the queue is a `reward-balance`
disagreement, so it stands as `checks-open`.

### Funding the rewards wallet

The rewards wallet is its own wallet, never the referee's: `NURA_REWARDS_KEY` holds its key, and
without it withdrawals are refused (`reward-wallet`) and nothing else changes.

1. Make a new wallet for it and send it **one cycle's budget plus 1,000 NURA**: 25,001,000 NURA at
   the default budget. The 1,000 is the gas reserve. A payout is a plain transfer (21,000 gas at
   47 gwei, about 0.001 NURA), and the worker never sends one that would leave the wallet holding
   less than what is already sent and not mined, plus that payout and its gas, plus the reserve.
   A payout it cannot afford stays queued, without using an attempt, and those behind it wait in
   order.
2. Before a real key, try a test wallet holding a few NURA: set its key, restart, withdraw once
   from an established test account, and see the payout mined on the explorer.
3. Top it up before each new cycle starts (every 30 reward days, counted from 2024-01-01 20:30
   UTC): the wallet should hold what is still owed (the queue, and what players have earned and
   not withdrawn) plus the reserve.

### The cycle budget and its release

All players together can be granted at most the cycle budget (default 25,000,000 NURA, the owner's
to change in Admin › Rewards), and it opens day by day: by the end of cycle day `d`, at most
`budget × d / 30` in total, with what a day leaves unused carried to the next. One player can be
granted at most 200,000 NURA a cycle, which no setting changes. A claim the budget or the cap
clips is still written, at what fit (0 included), and is not offered again; the player's page says
the day's pool is spent. A look is still given. 25,000,000 pays 125 players in full, so the pool
will clip once more play: that is the budget working, not a fault. Raise the budget only with the
wallet funded for it.

### The payout queue stalls

**Means** `baziche_reward_payouts{state="waiting"}` grows or `…oldest_seconds` passes ten
minutes, or payouts fail.

**Look at** the worker's `reward payout step failed` lines (they name the payout and the error),
whether `chain-down` or `checks-open` (`reward-balance`) stands, and the wallet's balance.

**Do**
- **Wallet short:** fund it (above). The waiting payouts go on their own at the next pass.
- **Chain unreachable:** as `chain-down`. Nothing is lost: a payout's signed bytes and hash are
  saved before it is sent, and the worker asks the chain for that hash before anything else.
- **A payout sent and never mined:** leave it. The worker sends the same bytes again, and treats
  it as replaced (a new attempt, up to 5) only once a mined block used its nonce, no receipt has
  its hash, and the worker has seen it that way for ten minutes (a worker restart starts that wait
  again).
- **Failed for good** (5 attempts): the NURA is back in the player's balance; they withdraw again.
- Never edit a payout row with a hash by hand without first looking that hash up on the explorer:
  a transfer that mined is paid.

### Freezing a player

For a farm, a stolen account or anything the staff want to look into: Admin › Rewards, the person's
handle, Freeze, with a reason (`POST /api/admin/rewards/people/:handle/freeze`,
`{ "frozen": true, "reason": "…" }`; the `rewards` ability, an admin's). A frozen player earns no
NURA: a check-in still keeps the streak and gives its look, but its NURA is written at 0
(`reward-frozen`) and is not paid later; quest claims and withdrawals are refused `reward-frozen`,
and a quest left unclaimed can still be claimed within its window once thawed. A payout already
queued stays queued and is not sent while the player is frozen, suspended or a minor; it goes out on
the first sweep after a thaw. One already sent cannot be called back. Thawing is the same call with `"frozen": false`. Both are staff
actions (`reward-freeze`) with who, when and why.

### Switching rewards on and off

Owner only (the `wallet` ability): Admin › Rewards, the switch, with a reason
(`POST /api/admin/rewards/switch`, `{ "on": true, "reason": "…" }`), a `reward-config` staff action
with the before and after. Off: the check-in, quest claims and claim-all refuse `reward-off`, the
rewards page says so, finished matches write no quest progress, and no streak reminder is sent.
Withdrawing NURA already earned still works, since it is the player's. Switch on only once the
wallet is funded and a test payout mined (above). The account's `rewards` flag, which shows the
page, changes for a player when their page next loads the session.

The streak reminder (`reward-streak`) goes out from 20:00 to 23:45 Tehran time, once a reward day,
to a player whose check-in today would keep a streak of 3 or more, never to a frozen or suspended
one, and not to one who muted gift notices.

### Before the first deploy of the rewards branch

On a database that has never had reward rows, nothing. Otherwise, with `NURA_REWARDS_KEY` empty
and the switch off, in `psql` before the new build starts:

1. **The old `RewardPayoutRecovery` migration.** An earlier build of it multiplied every amount in
   `reward_grants` and `reward_cycle_totals` by 10^18. If
   `select name from schema_migrations where name like 'RewardPayoutRecovery%'` finds it, look for
   inflated rows. An honest grant is at most 2×10^23 wei (200,000 NURA) and an inflated one at
   least 10^36, so:

   ```sql
   select count(*) from reward_grants where amount > 1e30 or wanted > 1e30;
   select id, state, amount, tx_hash from reward_payouts where amount > 1e30;
   ```

   If grants are inflated, put them right in one transaction and count the cycle totals again:

   ```sql
   begin;
   update reward_grants set amount = amount / 1000000000000000000 where amount > 1e30;
   update reward_grants set wanted = wanted / 1000000000000000000 where wanted > 1e30;
   update reward_cycle_totals t
      set granted = coalesce((select sum(g.amount) from reward_grants g where g.cycle = t.cycle), 0);
   commit;
   ```

   A payout over 10^30 was queued from an inflated balance and could never be afforded; look its
   hash up (it should have none) before marking it failed by hand.
2. **The streak table.** Nothing to run. The start adds `reward_streaks.run` (default 0) and turns
   `last_day` from a day of the cycle into the absolute reward day; the type change re-adds the
   column at 0 and keeps the old values in `kept_1_reward_streaks__last_day`. Those old streaks read
   as broken and start again at day 1 on the next check-in. Nobody loses NURA by it.
3. Start the new build and read the log for `the entities still differ`. Then switch on (above).

## When no alert says it

### A server key has leaked

The server signs with one key, `NURA_REFEREE_KEY`: it is the vault's referee, the shop's seller and
the markets contract's operator. What it can do without anybody else: open a paid game only with
stakes its players signed and pay a locked pot only to that game's players; sign shop quotes at a
price of its choosing, which a buyer pays from their own wallet (a sale the server never quoted
delivers nothing: the shop's worker says `mismatch` and the reconciliation lists it); sign market
tickets and settle markets. It holds nobody's NURA.

1. From the admin wallet, move each role to a new key in one call each: `setReferee(new)` on
   ArcadeVault, `setSeller(new)` on ArcadeShop, `setOperator(new)` on ArcadeMarkets. Whatever the
   old key signed stops being good at once.
2. In the meantime, or instead, `pause()` each: the vault stops new deposits and new games (games
   in play can still be paid, refunded and reclaimed, and every free balance withdrawn); the shop
   stops `buy`; the gifts contract stops `tip`; the markets contract stops new positions (claims,
   settling and calling off carry on).
3. A market the old key settled its own way is overturned by the owner within its dispute window
   (`overturn(key)`, every stake and the fee back; the deploy module's default window is fifteen
   minutes): the reconciliation's
   disagreement, and the market worker's log, are how one is noticed.
4. Write the new key's secret as `NURA_REFEREE_KEY` and restart the server.

The calls are the admin's: send them from the admin wallet with whatever calls a contract (the
SmartContract project's `npx hardhat console --network nurachain` with the admin key in its
keystore, or the explorer's page for a verified contract). `docs/operations/mainnet.md` has why the
admin and the server must not be one key.

### A paid game the server never pays

Three days after the game was opened, anybody may call `reclaim(id)` on the vault: every stake goes
back to its player. The wallet page offers it to the game's players. The server, finding the stakes
taken back, pays nothing.

### A market that never settles, or one settled wrongly

The worker settles a market once its game is over and its close has passed, from the result; calls
it off for a game with no winner, a draw it did not offer, or a game that ended before the close;
and marks one nobody placed in as empty. Anybody may `expire` one a week after its close, which
returns every stake. A market settled wrongly is overturned by the owner within its dispute window
(`overturn`, above); a winner cannot claim until the window has passed.

### The database is down, slow or full

Requests wait for a connection (the pool, `DATABASE_POOL_MAX`) and give up after five seconds; a
query is stopped after thirty. `/api/healthz` answers 503 with `"database": false`, and the log
says `database unreachable`, while the database cannot be reached: it is the address for a
supervisor's or a proxy's health check. A database that is full is grown or
cleaned; one that is lost is restored from the last dump (`docs/operations/rollout.md`), and the
reconciliation then compares every money record against NuraChain, which still holds every stake,
sale, gift and position: what the dump does not know is a disagreement for a person to mend.

### The server runs out of memory

Admin › Overview › This server shows its memory. The supervisor restarts it; the browsers come back
by themselves on their own backoff (measured: every socket greeted again within 4.4 s at the 95th
percentile after a restart under 3,000 sockets). A process that grows while nothing grows on the
overview is a leak to report with the time it started.
