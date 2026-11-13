# Rewards: daily check-in, streak, quests

A plan for coding agents. Each task below is one unit of work with its files, its dependencies and
its acceptance checks. Do them in order unless a task says it can run in parallel.

## 1. What is being built

A player earns NURA and skins (the shop's "looks") by coming back every day and by playing:

- **Daily check-in** with a 30-day streak ladder. A missed day sends the streak back to day 1.
- **Daily quests**: 3 a day, rotated every day across the games.
- **Weekly quests**: 3 a week, rotated every week, plus a chest for finishing all 3.
- **A 30-day bonus** with an exclusive skin for an unbroken 30-day streak.
- **Hard cap**: one player can earn at most **200,000 NURA per 30-day cycle**, whatever happens.
- **Global budget**: all players together can earn at most **25,000,000 NURA per 30-day cycle**.

## 2. The numbers

All amounts are whole NURA and are the defaults; the owner can change them in the admin (R8). The
defaults must sum to exactly 200,000, and a spec holds that sum (R1).

| Source | Rule | Per cycle |
|---|---|---|
| Check-in ladder | 30 days, table below | 50,000 |
| 30-day bonus | paid with the day-30 check-in | 20,000 |
| Daily quests | 3 quests x 1,000 NURA x 30 days | 90,000 |
| Weekly quests | (3 quests x 3,000 + chest 1,000) x 4 weeks | 40,000 |
| **Total** | | **200,000** |

Check-in ladder (NURA per day):

| Days | Each day | Last day of the week | Week total |
|---|---|---|---|
| 1-7 | 1,000 (days 1-6) | day 7: 3,000 + skin | 9,000 |
| 8-14 | 1,200 (days 8-13) | day 14: 4,000 + skin | 11,200 |
| 15-21 | 1,500 (days 15-20) | day 21: 5,000 + skin | 14,000 |
| 22-28 | 1,800 (days 22-27) | day 28: 3,000 + skin | 13,800 |
| 29 | 2,000 | | 2,000 |
| 30 | 0 on the ladder; pays the 20,000 bonus + the exclusive skin | | 0 |

Skins: days 7, 14, 21, 28 and each weekly chest give one look from an owner-chosen reward pool; day
30 gives the cycle's exclusive look. A look the player already owns gives nothing in its place
(same as `invite_rewards.delivered = false`); never substitute NURA, or the cap breaks.

## 3. Rules that every task must respect

1. **Reward day.** A day starts at 20:30 UTC (midnight in Tehran). Keep it one constant,
   `REWARD_DAY_START_UTC_MINUTES`, in `backend/src/domains/reward/rules.ts`. Never use the server's
   local time or the browser's clock to decide a day.
2. **Cycle.** Cycles are global and 30 reward days long, counted from a fixed epoch constant.
   Cycle day 1-28 fall in quest weeks 1-4 (7 days each); days 29-30 have daily quests only. Call it
   a "reward cycle" everywhere: `seasons` already means something else in this codebase.
3. **Streak.** Per player. Checking in on consecutive reward days moves the ladder 1 -> 30, then
   wraps to 1. A missed reward day resets it to 1. Any 30 consecutive ladder days sum to 50,000, so
   wrapping cannot beat the budget.
4. **Global budget.** All grants of a cycle together never pass 25,000,000 NURA
   (`REWARD_CYCLE_BUDGET`, owner-settable). It is released day by day so the first days cannot
   drain it: by the end of cycle day `d`, at most `budget * d / 30` may have been granted in
   total, and what a day leaves unused carries to the next. A grant that would pass it is clipped
   like the player cap (below), in the same transaction, against one locked counter row per cycle.
   When it clips, the UI says the day's pool is spent and when more opens; skins are still given.
   Note: 25,000,000 covers 125 players at the full 200,000, so the pool will clip once the active
   base grows; the admin shows how much of it is used (R8).
5. **Cap.** Every NURA grant is a row in one ledger (`reward_grants`). Before inserting, sum the
   player's grants in the current cycle inside the same transaction, with the player's row locked,
   and clip the new grant so the sum never passes the cap. A clipped-to-zero grant is still
   recorded (amount 0) so the claim is not offered again.
6. **Once.** Every claim is made idempotent by a unique index, the way `invite_rewards_once` does
   it: a retry or two requests at once find the row and write nothing.
7. **Who may earn NURA.** Only an established player (`established_players`) with a wallet, who
   is not a minor (`users.is_minor`, as the shop and paid tables refuse) and not suspended. Anyone
   else can still check in, keep a streak, progress quests and win skins; their NURA claims are
   refused with a reason the UI explains. This is the main defence against farms of fresh accounts.
8. **Server decides everything.** Quest progress comes only from matches this server arbitrated,
   inside the transaction that records the match (`Recorder.finish`). The client never reports
   progress.
9. **No new contract.** NURA is the chain's native coin and the vault has no "deposit for".
   Rewards are paid from the rewards wallet the owner provides (its key in the environment,
   `NURA_REWARDS_KEY`) by a plain transfer to the player's wallet (R6). Earned NURA first accrues
   off-chain in the ledger; the player withdraws it. Every grant and every payout is logged and
   shown in the admin, grouped by day (R8).
10. **House style.** Read `.github/CONTRIBUTING.md` first. Follow the existing patterns: entities
   with `@Check` constraints and partial unique indexes, a migration per schema change
   (`npm run migration:new`), refusal codes in a `refusals.ts`, contract-checked routes in
   `backend/src/api.ts`, 10 locales (en, fa, ar, es, fr, hi, pt, ru, tr, zh), comments that say why.
   Specs are logic-only: no database specs and no UI-drawing specs (upstream removed both kinds).
   Commit messages follow `type(scope): sentence`; never add co-author lines; never push without
   being asked.

## 4. Facts already checked in the codebase (use these; do not guess)

- **Where a match ends:** `createRecorder(...).finish(tx, match, engine, state, ending)` in
  `backend/src/domains/match/record.ts`. Per player it has a `Verdict`
  (`backend/src/domains/match/judge.ts`): `result` is `won | lost | drawn | abandoned | void`,
  and `credit` is true only for a win that was not handed over by a forfeit. A quest "win" is
  `verdict.credit === true`. A match "counts as played" when `result` is `won` (with credit),
  `lost` or `drawn`. `void` and `abandoned` never count.
- **Per-match counters:** `engine.tally(events)` gives each seat a `Tally` (name -> count) for
  this match alone; the recorder already computes it as `bySeat`. The names that exist, and the
  only ones a quest may use:
  - ludo: `rolls`, `sixes`, `captures`, `home`, `enters`
  - hokm: `hands`, `tricks`, `kots`, `trumps`
  - backgammon: `games`, `gammons`, `backgammons`, `hits`, `borneOff`
  - poker: `hands`, `pots`, `showdowns`, `knockouts`
  - chess: `moves`, `captures`, `checks`, `checkmates`, `castles`, `promotions`,
    `enPassants`, `draws`

  These are the names `backend/src/domains/achieve/families.ts` uses. A spec must hold the quest
  catalogue to names the achievement families of that game use, by importing them, not by
  copying this list.
- **Where rewards hook in:** at the end of `finish`, beside `achieve.record(tx, player.userId,
  matchId, game)`, inside the same transaction, for the `counted` players only. Pass the
  recorder a reward dependency the way it is passed `achieve`.
- **Tournament match:** the match's table has `tables.tournament_id` not null.
- **Friend:** a row in `friendships` between the two players.
- **Established:** `established_players` has a row for the user. It is filled by
  `establish(matchId)` in `backend/src/domains/invite/service.ts` (account 7 days old, 5 games
  played out with somebody established or on the staff: `ESTABLISHED_DAYS`, `ESTABLISHED_GAMES`
  in `invite/policy.ts`). Reuse it; do not write a second definition.
- **The wallet a player is paid to:** the one every money path uses,
  `select w.address from wallets w where w.user_id = :id order by w.last_used_at desc nulls last
  limit 1` (see `shop/orders.ts`, `stake/service.ts`). Copy the address into the payout row when
  it is queued; never re-read it when sending.
- **Giving a look:** insert into `owned_items` with `via: 'reward'`, `orderId: null`,
  `giverId: null`, `ON CONFLICT DO NOTHING`, and read back whether a row was written
  (`invite/service.ts`, the insert with `via: 'reward'`, is the pattern). Bundles (`bundle.*`)
  are never owned.
- **Telling the browser:** the hub already has a per-person nudge,
  `nudge(n, 'me', now, topic)` (`backend/src/realtime/hub.ts`). Use scope `me` with topic
  `rewards`; do not add a new scope. The browser listens with `useRealtime().onNudge`.
- **Settings:** `settings` is a closed key set (`settings_key_known`); `stake/rate.ts` shows how
  one is read and written.
- **Admin:** abilities are in `ABILITIES` (`backend/src/domains/admin/roles.ts`); add
  `rewards: 'admin'`, and gate every edit of amounts, pool and budget with the existing
  `wallet: 'owner'` ability. Add `'rewards'` to `ADMIN_SECTIONS`
  (`frontend/src/lib/admin-sections.ts`). Staff actions are a closed set too: add
  `reward-config` and `reward-freeze` to `ACTION_KINDS`, to the check in
  `staff-action.entity.ts`, and to `frontend/src/lib/staff-words.ts`.
- **A new notification kind touches all of:** `notification.entity.ts` (type and check),
  `backend/src/domains/notify/notices.ts`, `backend/src/schemas.ts`,
  `frontend/src/lib/notice-words.ts`, `frontend/src/lib/notifications.ts`,
  `frontend/public/push-worker.js`.
- **Chain client to copy:** `backend/src/chain/sponsor.ts` (settings, `configured`, bounded
  client, nonce manager); its key is read in `backend/src/env.ts` as
  `optional('NURA_SPONSOR_KEY', { secret: true })`. Name the new one `NURA_REWARDS_KEY`.
  Gas floor: `gasFloorOf(chainId)` in `chain/vault.ts`.
- **Browser patterns to copy:** optimistic changes with `frontend/src/lib/guess.ts` (used in
  `calls.store.ts`); navigation entries and their red dots in
  `frontend/src/components/app/nav-items.ts` and `nav-counts.ts`; words go in a new
  `frontend/src/locales/<lang>/rewards.ts` registered in each language's `index.ts`.
- **There are no bots.** Every seat is a person, so "a different human" means a different
  `user_id`.

## 5. Anti-abuse rules for quest progress

A finished match counts toward quests only when all of these hold. Put them in one pure function
(`countsForQuests`) with a spec.

- The player's verdict is `won` with credit, `lost` or `drawn` (section 4).
- At least one other seat is a different `user_id`.
- It lasted a minimum number of the player's own turns (per game, a constant table).
- The same opponent counts at most 3 times per reward day for one player (win-trading).
- "Win" quests need the win to be against at least one established player.

## 6. Tasks

### R1. Rules module (pure, no I/O)

- **Files:** new `backend/src/domains/reward/rules.ts`, `backend/tests/reward-rules.spec.ts`.
- **Do:** export the default amounts from section 2, the ladder as a 30-entry array, the cap, and
  pure functions: `rewardDayOf(date)`, `cycleOf(day)` (cycle index, day-in-cycle 1-30, week 1-4 or
  null), `nextStreak(lastDay, today, streak)` (same day -> unchanged and not claimable; next day ->
  +1 wrapping 30 -> 1; gap -> 1), `clip(alreadyGranted, wanted, cap)`, `budgetOpen(budget, cycleDay)` (rule 4).
- **Accept:** spec proves the defaults sum to exactly 200,000; any 30 consecutive ladder days sum
  to 50,000; day boundaries at 20:29/20:30 UTC; streak wrap and reset; clip never passes the cap; the budget released by day 30 is the whole budget and never more.

### R2. Quest catalogue and rotation (pure)

- **Files:** new `backend/src/domains/reward/quests.ts`, `backend/tests/reward-quests.spec.ts`.
- **Do:** define quest templates as data: `{ id, period: 'daily' | 'weekly', game: GameId | 'any',
  metric, target, title/blurb keys }`. Metrics, all derivable in `Recorder.finish`:
  The metrics are a closed set, each defined by section 4: `played`, `won`,
  `played-with-friend`, `tournament-played`, `distinct-games` (weekly only: how many different
  games were played), and `{ tally: name }` with a name from section 4's list for that game.
  Nothing else. Size targets so a daily quest takes about 30 minutes of play and a weekly one
  about 3 hours; say in a comment how each target was sized.
  At least 6 daily and 4 weekly templates per game (hokm, backgammon, poker, ludo, chess) plus 6
  "any game" ones.
- **Rotation:** `questsFor(cycleIndex, dayOrWeek, period)` is deterministic and the same for
  everybody. Daily = 1 "any game" quest + 2 game-specific quests from two different games. Rotate
  the games round-robin so every game appears equally often over 5 days. No template repeats on
  consecutive days (or weeks). Only games whose `games.status` is available are drawn.
- **Accept:** spec proves determinism, the 1+2 shape, no consecutive repeat, even game coverage
  over a cycle, and that every template's metric and game exist.

### R3. Schema (depends on R1, R2)

- **Files:** new entities in `backend/src/entities/` + `index.ts`, one migration, update the
  `settings_key_known` check.
- **Tables:**
  - `reward_streaks` (user_id PK, streak int 0-30, last_day int, best int).
  - `reward_checkins` (user_id, day; PK both) - one row per claimed day, with ladder position.
  - `reward_quest_progress` (user_id, period, period_key, quest_id; PK all four; progress int,
    done_at, claimed_at). `period_key` is the reward day or `cycle:week`.
  - `reward_quest_opponents` (user_id, day, opponent_id, count) for the 3-per-day rule.
  - `reward_grants` - the ledger: id, user_id, cycle int, source in ('checkin', 'bonus', 'daily',
    'weekly', 'chest'), source_key (unique with user_id + source), amount numeric(40,0) in wei,
    wanted (before clipping), item_id nullable, delivered boolean nullable, created_at. Index
    (user_id, cycle).
  - `reward_payouts` - id, user_id, wallet address, amount, state in ('queued', 'sent', 'mined',
    'failed'), tx hash, attempts, timestamps. Partial unique index: one non-final payout per user.
  - `settings` gains keys `reward-config` (JSON of amounts, pool, exclusive look, on/off switch)
    and `reward-budget` (max NURA all players together may be granted per cycle, default
    25,000,000).
  - `reward_cycle_totals` (cycle PK, granted numeric) - the one row a grant locks for rule 4.
- **Accept:** `npm run migrate` applies on a fresh database; the schema snapshot/drift checks pass
  (`backend/src/db/drift.ts`, `schema.ts`); checks reject bad states.

### R4. Reward service: check-in and grants (depends on R3)

- **Files:** new `backend/src/domains/reward/service.ts`, `refusals.ts`; wire into
  `backend/src/services.ts` / `ports.ts`.
- **Do:** `state(userId)` returns the streak, today's claimability, the full ladder with what was
  claimed, today's and this week's quests with progress, the cycle total granted, the withdrawable
  balance and the eligibility reason. `checkIn(userId)` runs in one transaction: lock the streak
  row, apply `nextStreak`, insert `reward_checkins`, grant NURA through one private `grant()`
  that applies rule 4 (global budget), rule 5 (cap) and rule 7 (eligibility); on days 7/14/21/28
  give a pool look, on day 30 the bonus and the exclusive look (insert `owned_items` with
  `via: 'reward'`, `ON CONFLICT DO NOTHING`, record `delivered`).
- **Accept:** logic that can be pure is pure and has specs (which look is picked, what a day pays).
  Two concurrent check-ins produce one row. A non-established player gets the streak and skins and
  a `not-established` refusal for the NURA part.

### R5. Quest progress and claims (depends on R4)

- **Files:** `backend/src/domains/match/record.ts` (call into the reward service inside
  `finish`'s transaction, beside the `achieve` call), `backend/src/domains/reward/progress.ts`,
  `backend/tests/reward-progress.spec.ts`.
- **Do:** from the finished match build per-player facts, run `countsForQuests` (section 5), then
  advance every active daily and weekly quest whose game and metric match, with an upsert that
  never passes the target. `claimQuest(userId, period, questId)` grants through `grant()`; when
  the 3rd weekly quest is claimed, the chest (NURA + pool look) is granted with it.
- **Performance:** at most 2 extra statements per player per finished match. No per-quest loops of
  queries.
- **Accept:** spec covers every rule in section 5 and every metric; a quest cannot be claimed
  before it is done, nor twice; progress made on the last day cannot be claimed after 7 days.

### R6. NURA payout (depends on R4; can run in parallel with R5)

- **Files:** new `backend/src/chain/rewards.ts` (model it on `chain/sponsor.ts`: bounded client,
  `nonceManager`, gas floor from `vault.ts`), `backend/src/env.ts` (`NURA_REWARDS_KEY`), a sweep in
  `backend/src/main.ts` like the others, `backend/tests/fake-chain.ts`, reconcile kinds in
  `backend/src/domains/reconcile/`.
- **Do:** `withdraw(userId)` moves the player's whole unpaid ledger balance into one `queued`
  payout (minimum 1,000 NURA; one open payout per player). The sweep sends native NURA from the
  rewards wallet to the player's wallet, stores the hash before waiting, marks `mined` on receipt
  and retries `failed` with a bounded count. It must be safe to crash at any line: a payout with a
  hash is never sent again without first checking the chain for that hash.
- **Reconcile:** a verdict that compares sum(grants) - sum(mined payouts) per user to what is
  shown, and flags a rewards wallet balance too low for the queue.
- **Accept:** specs with the fake chain for send, crash-after-send, revert and retry; the
  rewards wallet being unconfigured turns withdrawals off with a clear refusal and nothing else.

### R7. API and realtime (depends on R4, R5, R6)

- **Files:** `backend/src/api.ts`, `backend/src/schemas.ts`, rate limits in
  `backend/src/http/rate-limit.ts`.
- **Routes:** `GET /rewards` (state), `POST /rewards/check-in`, `POST /rewards/quests/:period/:id/claim`,
  `POST /rewards/withdraw`, `GET /rewards/history` (a page at a time).
- **Do:** nudge the player's sockets (scope `me`, topic `rewards`; section 4) when quest
  progress changes or a payout is mined. Add notification kinds `reward-ready` (a quest is done)
  and `reward-streak` (one push a day at most, only if today is unclaimed and the streak is >= 3);
  extend the kind checks, the notice words and `frontend/public/push-worker.js` texts.
- **Accept:** `npm run check` passes the contract check; refusal codes are covered by the refusals
  spec.

### R8. Admin (depends on R7; parallel with R9)

- **Files:** `backend/src/domains/admin/rewards.ts`, a new admin page
  `frontend/src/pages/admin/rewards.page.azeroth`, route + ability in `frontend/src/routes.ts`
  and `backend/src/domains/admin/roles.ts`, admin labels in all 10 languages.
- **Do:** owner-only: switch the whole system on/off, edit amounts (the form refuses a set whose
  maximum per cycle is above the cap), choose the reward pool looks and the exclusive look, set the
  cycle budget. Staff: a **daily log** - one row per reward day with NURA granted by source
  (check-in, bonus, daily quests, weekly quests, chest), skins given, players who claimed, NURA
  paid out and how much of the cycle budget is used; opening a day lists its grants and payouts
  one by one (player, source, quest, amount, wanted-before-clipping, tx hash, state), a page at a
  time. Also: top earners, the payout queue with failed ones first, the rewards wallet's address
  and balance, and freezing one player's rewards with a reason (recorded in `staff_actions`).
- **Accept:** every change is a staff action with who and when; a non-owner gets the refusal; the
  daily log's sums equal the ledger's for that day (one query each, on indexes: add
  `reward_grants (created_day)` or equivalent in R3).

### R9. Player UI (depends on R7)

- **Files:** new `frontend/src/stores/rewards.store.ts`, `frontend/src/pages/app/rewards.page.azeroth`,
  components under `frontend/src/components/rewards/`, a route in `frontend/src/routes.ts`
  (lazy, through `chunk()`), an entry on the home page and in the app shell's navigation, strings in
  `frontend/src/locales/*/` for all 10 languages.
- **Screens:**
  1. Check-in card: 30 tiles in 4 rows of 7 plus 2, today's highlighted, skin days marked, one
     primary "Claim" button, the streak count with a flame, time left until the next reward day.
  2. Daily quests: 3 rows, each with the game's icon, a progress bar, the reward and a Claim button;
     a countdown to the rotation.
  3. Weekly quests: the same, with the chest and its 3-step progress.
  4. Balance: earned this cycle out of 200,000, withdrawable amount, Withdraw button, history.
  5. Not eligible for NURA: a clear line saying why and what to do (play with established players).
- **Do:** optimistic claims with the store's existing guess pattern; a red dot on the navigation
  entry when something is claimable; a short celebration when a skin is given (reuse the equip
  burst from `frontend/src/game/looks/`). RTL must be right for fa and ar. Respect
  `prefers-reduced-motion`.
- **Budget:** the rewards page is its own lazy chunk; initial JS must stay inside
  `tools/budgets.mjs` (63 KB). Run `npm run build` and read the budget lines.
- **Accept:** store logic has a spec with the fake API (`frontend/tests/fake-api.ts`); the page
  works at 360 px wide; `npm run build` passes its budgets.

### R10. Rollout (last)

- **Do:** ship with the switch off. Add a section to `docs/operations/runbooks.md`: funding the
  rewards wallet, the daily budget, what to do when the queue stalls, how to freeze a player. Add
  rewards figures to the ops monitor (`backend/src/ops/`): NURA granted today, queue length, wallet
  balance. Write the design record `docs/design/<date>-rewards-design.md` from this file with the
  decisions actually taken.
- **Accept:** `npm run check` and `npm run build` pass; with the switch off no route grants
  anything.

## 7. Order, and how to run the tasks

```
R1 -> R2 -> R3 -> R4 -> R5 --\
                    \-> R6 ---+-> R7 -> R8 (parallel with R9) -> R10
```

Run **one task at a time**. A task is done only when:

1. its acceptance checks pass, and the agent pasted the command output that shows it;
2. `npm run check` passes, and `npm run build` for a task that touched the frontend;
3. the agent listed what it could not verify;
4. somebody reviewed the diff before the next task starts (`/code-review` at least).

Extra gates, because these parts cannot be left to one agent alone:

- **R6 (payout) moves real NURA.** It needs a review by a stronger model or a person, looking
  for: a payout sent twice, a crash between sending and saving the hash, an address read at send
  time instead of from the payout row, and the gas reserve. It is tried on a test wallet holding
  a few NURA before `NURA_REWARDS_KEY` is set to the real one. The switch (R8) stays off until
  then.
- **R4 and R5 make claims about two requests at once** that no spec here can prove (the repo
  keeps no database specs). The agent must run the migration, then the same claim twice in
  parallel against a local database by hand, and paste the result.
- **R9 (UI)** is checked by a person on a phone, in fa (right-to-left) and en, before it is
  called done. The agent cannot see it.
- An agent that finds a fact in section 4 to be wrong stops and says so; it does not work around
  it.

## 8. Decisions (confirmed by the owner, 2026-11-13)

1. **Payout path:** no new contract. Paid from the owner-provided rewards wallet straight to the
   player's wallet; every grant and payout is logged in the admin by day.
2. **Reward day boundary:** midnight Tehran (20:30 UTC).
3. **Missed day:** the streak resets to day 1; no "freeze".
4. **Skins:** existing shop looks from an owner-chosen pool, plus one exclusive look per cycle.
5. **Who earns NURA:** established players only.
6. **Global budget:** 25,000,000 NURA per cycle for all players together, released day by day.

7. **Rewards wallet funding:** 25,000,000 NURA for rewards plus 1,000 NURA for gas. A payout is a
   plain transfer (21,000 gas at the chain's 47 gwei floor, about 0.001 NURA), so 1,000 NURA pays
   for roughly a million payouts. The wallet holds one cycle's budget: it must be topped up before
   each new cycle, and the sweep must never send a payout that would leave less than the gas
   reserve (R6). The admin and the ops monitor warn when the balance is below what is still owed.
