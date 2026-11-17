# Rewards: the daily check-in, the streak and the quests

What was built from the plan in `reward.md`, and the decisions taken on the way. The owner's
decisions of 2026-11-13 are that file's section 8; the ones below are numbered RW-D1 onward. The
code is `backend/src/domains/reward/`, the admin's side `backend/src/domains/admin/rewards.ts`, and
what to do in operation is the Rewards section of `docs/operations/runbooks.md`.

## What a player gets

- A **daily check-in** on a 30-position ladder (50,000 NURA over 30 days), with a pool look on
  positions 7, 14, 21 and 28 and, on 30, a 20,000 NURA bonus and the cycle's exclusive look.
- **Three daily quests** (1,000 NURA each) and **three weekly quests** (3,000 each), and a weekly
  chest (1,000 NURA and a pool look) once three weekly quests of that week are claimed.
- At most **200,000 NURA per player per 30-day cycle**, whatever the amounts are set to.

The amounts, the pool, the exclusive look and the switch are one setting, `reward-config`, JSON
`{ on, amounts, pool, exclusive }`, read by one parser (`rewardConfigOf`). It reads each part on its
own with a default: switched off unless it says `on: true`, the default amounts unless it holds a
set whose most per cycle (`mostPerCycle`) is 200,000 or less, only looks that are looks (never a
`bundle.*`). The admin write refuses a set over the cap (`staff-reward-amounts`) rather than storing
one the parser would ignore. The cycle budget is its own setting, `reward-budget`, in whole NURA.

## Days, cycles and the ladder (RW-D1)

A **reward day** starts at 20:30 UTC, midnight in Tehran (`REWARD_DAY_START_UTC_MINUTES`), counted
as an absolute number from 2024-01-01 20:30 UTC (`rewardDayOf`). A **cycle** is 30 reward days from
the same epoch; cycle days 1-28 are quest weeks 1-4, and 29-30 have daily quests only.

The **ladder position is the player's, and separate from the absolute day.** `reward_streaks` keeps
the position the last check-in paid (`streak`, 1-30), the run of days in a row that led to it
(`run`, which passes 30), the absolute day of that check-in (`last_day`) and the longest run
(`best`). A check-in on the next day steps the position (30 wraps to 1), on the same day does
nothing, and after a gap starts again at 1. So a player who starts on cycle day 12 is on position 1,
not 12. Any 30 positions in a row sum to 50,000, so a run that wraps cannot pay more than the
ladder. A check makes the position follow from the run, so the two cannot drift apart.

## One grant function (RW-D2)

Every NURA a player earns is a row in `reward_grants`, the one ledger, written by one private
`grant()` in `reward/service.ts`. Every caller has already locked the player's `users` row
(`FOR NO KEY UPDATE`, so the match recorder's key-share locks never wait on it). Under that lock
`grant()`:

1. finds the row by `(user_id, source, source_key)`, unique, so a retry or two requests at once
   write one row;
2. sums the player's grants in the cycle and locks the cycle's one `reward_cycle_totals` row;
3. pays the least of what was asked, what the cap leaves, and what the **budget opened so far**
   leaves (`grantAward`): by the end of cycle day `d`, `budget × d / 30` in total, with what a day
   left unused carried on;
4. writes the row with `wanted` (before clipping), `amount` (after) and `day`, the absolute reward
   day.

**A grant is booked to the cycle of the day it is granted on**, not of the day its quest was done.
A weekly quest done on cycle day 28 and claimed on day 31 counts against the new cycle's cap and
budget. The claim window is 7 days back from today for both periods.

**A claim clipped to 0 is still written**, at 0, and is not offered again (rules 4 and 5 in
`reward.md`). Without the row a player at the cap would see the same claim forever, and one at
the budget could claim it again the next day out of a later day's share. The page says why
(`reward-cap`, `reward-budget`). A look is given in any case. A look the player already owns gives
nothing in its place (`delivered: false`), never NURA, which would pass the cap.

`reward_grants.day` is nullable (null on rows written before it existed) and indexed, so the
admin's daily log is one indexed read per day.

## Who may earn NURA (RW-D3)

One function, `eligibilityOf`, in this order: not suspended, not frozen, not a minor, established
(`established_players`, the invite domain's definition), with a wallet. Anyone else can still check
in, keep a streak, win the looks and progress quests. Their check-in's NURA is written at 0 with
the reason, and a quest claim is refused with it, so a quest stays claimable within its window if
they become eligible. Quest progress comes only from matches this server arbitrated, in the
recorder's transaction, through `countsForQuests` (`reward.md` section 5). Quests are drawn only
from games that are available, in a fixed order, so everybody gets the same draw. A claim checks
the catalogue, not today's draw, so a quest whose game was switched off after it was done can
still be claimed.

## The switch (RW-D4)

The feature ships **off**. Off means: the check-in, quest claims and claim-all refuse `reward-off`;
the state route refuses `reward-off`; a finished match writes no quest progress; no streak reminder
is sent. **Withdrawing NURA already earned still works**: it is the player's. The browser learns
the switch from the signed-in account (`rewards: true` while on), because the state route refuses.
Only the owner switches it (`wallet` ability), as a `reward-config` staff action with a reason and
the before and after, written in the same transaction as the change.

## Freezing (RW-D5)

The staff (`rewards` ability, an admin's) can freeze one player's rewards with a reason. It is a
row in `reward_freezes` rather than a column on `users`, so freezing touches no existing row and
thawing is a delete. Frozen means `reward-frozen` from `eligibilityOf`: no NURA earned, no quest
claimed, and no withdrawal (checked under the same row lock the freeze takes). Freezing and thawing
are `reward-freeze` staff actions in the same transaction. A payout already queued is not taken
back.

## The payout (RW-D6)

There is no contract. Earned NURA sits in the ledger until the player withdraws. `withdraw` moves
the whole unpaid balance (at least 1,000 NURA) into one `queued` payout, one open payout per player
by a partial unique index, with the wallet address copied in at that moment and never read again.
The rewards worker (`main.ts`, every 3 seconds) sends plain transfers from the rewards wallet
(`NURA_REWARDS_KEY`):

- **The bytes and the hash are saved before anything is sent.** The worker signs, stores the raw
  transaction, its nonce and its hash, commits, and only then broadcasts. A crash at any line leaves
  either nothing sent, or a hash the next pass looks up before doing anything else. A rebroadcast
  the node refuses as already known is not a fault.
- **Mined** on a successful receipt; a **revert** is retried up to 5 attempts, then `failed`, and
  the NURA is back in the player's balance.
- **Replaced** (another transaction used its nonce) only when a mined block used that nonce, no
  receipt has its hash, and it is more than 10 minutes old: a node that lags must not cause a
  second payment.
- **A gas reserve of 1,000 NURA.** A payout is sent only if the wallet still holds, after it and
  its gas, everything already sent and not mined plus the reserve. One it cannot afford stays
  queued without using an attempt, and later payouts wait behind it in order.
- The reconciliation compares each player's ledger with what was paid (`reward-ledger`) and flags a
  wallet below what the queue needs, with gas and the reserve (`reward-balance`).

Without `NURA_REWARDS_KEY` a withdrawal is refused (`reward-wallet`) and nothing else changes.

## The streak reminder (RW-D7)

`reward-streak` is sent at most once a reward day per player (dedupe key `reward-streak:<day>`),
through the notify path, so a player who muted gift notices is not told. It goes only to a player
whose check-in today would keep a live streak of 3 or more (the streak the page shows: the ladder
position), never to a frozen or suspended one, and only while rewards are on. It is sent from 20:00
to 23:45 of the reward day, Tehran's evening: earlier it mostly reaches people who would check in
anyway, and later there is no time left to act on it. The notify path has no quiet hours to respect;
this window is never at night in Tehran.

Only a player whose last check-in was yesterday can keep a streak today, so the set is fixed when
the day starts. The worker walks it once a day in user order, 200 rows a read, on the index
`reward_streaks (last_day, user_id)`. Outside the window, with rewards off, or once the walk
reached the end, a pass reads nothing more than the switch. A restart walks the day again, and
the dedupe key makes every second notice a no-op.

## Operations

The ops monitor's sample reads the switch, NURA granted today (on the `day` index), the payouts
waiting and failed in the last day, and the rewards wallet's balance (one bounded call to the
chain). They are exported in `GET /api/metrics` (`baziche_rewards_*`, `baziche_reward_payouts*`).
They are not yet drawn on Admin › Overview, whose wire shape this work did not change.

## Not built yet

- **The engagement layer**: everything that would bring a player back beyond the ladder, the
  quests and one reminder a day. There is no design for it yet.
- **Reminder retraction**: a reminder stays in the bell after the player checks in that day.
- **A test payout on a real test wallet**, and the two-requests-at-once checks against a database
  that `reward.md` section 7 asks for, have not been run. No database spec exists, by the house
  rule.
- **The overview**: rewards figures on Admin › Overview, and a warning there when the wallet is
  below what is still owed. Today the reconcile flag and the metrics carry it.
