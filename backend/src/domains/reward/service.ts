import { HttpError } from '@azerothjs/http';
import { In, IsNull, Not, type DataSource, type EntityManager } from 'typeorm';

import type { RewardWallet } from '../../chain/rewards.ts';
import { Game } from '../../entities/game.entity.ts';
import { MatchPlayer } from '../../entities/match-player.entity.ts';
import { OwnedItem } from '../../entities/owned-item.entity.ts';
import { RewardCheckin } from '../../entities/reward-checkin.entity.ts';
import { RewardCycleTotal } from '../../entities/reward-cycle-total.entity.ts';
import { RewardGrant } from '../../entities/reward-grant.entity.ts';
import { RewardQuestProgress } from '../../entities/reward-quest-progress.entity.ts';
import { RewardStreak } from '../../entities/reward-streak.entity.ts';
import { Setting } from '../../entities/setting.entity.ts';
import { ShopItem } from '../../entities/shop-item.entity.ts';
import { User } from '../../entities/user.entity.ts';
import { cursorOf, keyOf, keysetAfter, olderThan, type Keyed } from '../../lib/keyset.ts';
import {
    REWARD_CAP,
    REWARD_DAY_MS,
    REWARD_EPOCH_MS,
    budgetOf,
    cycleOf,
    eligibilityOf,
    grantAward,
    ladderView,
    nuraOf,
    pickLook,
    planCheckIn,
    questClaimGate,
    rewardConfigOf,
    rewardDayOf,
    rewardForDay,
    weiOf,
    type EligibilityFacts,
    type RewardConfig
} from './rules.ts';
import { countsForQuests, deltasForQuests, inQuestOrder, MIN_QUEST_TURNS, wantsDistinctGame, weeklyChestReady, type QuestProgressHook, type RewardFinishEffects } from './progress.ts';
import { drawnGames, questsFor, questView, templateOf, type QuestTemplate } from './quests.ts';
import { createRewardPayoutService, type RewardPayoutSweep } from './payout.ts';
import { REWARD_REFUSALS, type RewardRefusal } from './refusals.ts';
import { isSystem } from '../system/sql.ts';

const HISTORY_PAGE = 25;

const REFUSAL_WORDS: Partial<Record<RewardRefusal, string>> = {
    'not-established': 'Only an established player may earn NURA rewards.',
    'reward-no-wallet': 'Link a wallet to earn NURA rewards.',
    'reward-minor': 'Only adults can earn NURA rewards.',
    'reward-suspended': 'A suspended account cannot earn NURA rewards.',
    'reward-frozen': 'The staff froze the rewards of this account.'
};

/** The switch is off: everything but withdrawing what was already earned answers as if rewards were not here. */
const switchedOff = () => rewardRefusal('reward-off', 'Rewards are not running here.');

const rewardRefusal = (word: RewardRefusal, message: string) =>
    new HttpError(REWARD_REFUSALS[word], message, { code: word });

type GrantSource = RewardGrant['source'];

interface GrantAsk
{
    source: GrantSource;
    sourceKey: string;
    wanted: number;
    today: number;
    itemId?: string | null;

    /** Why this player may not earn NURA: the row is still written, with nothing in it, and the look still given. */
    withheld?: RewardRefusal;
}

interface Granted
{
    amount: number;
    written: boolean;
    delivered: boolean | null;
    clipped?: RewardRefusal;
}

const NOT_WRITTEN: Granted = { amount: 0, written: false, delivered: null };

interface ClaimedQuest
{
    period: 'daily' | 'weekly';
    id: string;
    amount: number;
    reason?: RewardRefusal;
}

interface HistoryRow extends Keyed
{
    source: GrantSource;
    amount: string;
    at: Date;
    note: string;
}

const todayOf = () => rewardDayOf(new Date());

const weekKeyOf = (cycle: number, week: number) => `cycle:${ cycle }:week:${ week }`;

const cycleWeekOf = (periodKey: string) =>
{
    const parts = /^cycle:(\d+):week:(\d+)$/.exec(periodKey);

    return parts === null ? null : { cycle: Number(parts[1]), week: Number(parts[2]) };
};

export const periodKeysInClaimWindow = (period: 'daily' | 'weekly', today: number) =>
{
    const keys = new Set<string>();

    for (let day = Math.max(1, today - 7); day <= today; day += 1)
    {
        if (period === 'daily')
        {
            keys.add(String(day));
        }
        else
        {
            const cycle = cycleOf(day);
            if (cycle.week !== null)
            {
                keys.add(weekKeyOf(cycle.cycle, cycle.week));
            }
        }
    }

    return [...keys];
};

const claimableRow = (row: RewardQuestProgress) => row.claimedAt === null && row.doneAt !== null && row.progress >= row.target;

const historyKind = (source: GrantSource) => source === 'checkin' ? 'check-in' as const : source === 'bonus' ? 'bonus' as const : 'quest' as const;

export function createRewardService(db: DataSource, wallet?: RewardWallet, hooks: { mined?(userId: string): void } = {})
{
    const payouts = wallet === undefined ? null : createRewardPayoutService(db, wallet, hooks);

    /**
     * The first lock of every claim. NO KEY UPDATE, not UPDATE: every insert that references the
     * player takes a key-share lock on this row, and the match recorder must not wait on a claim.
     */
    const lockPlayer = async (tx: EntityManager, userId: string) =>
    {
        const user = await tx.getRepository(User).createQueryBuilder('user')
            .select('user.id')
            .setLock('for_no_key_update')
            .where('user.id = :userId', { userId })
            .getOne();

        if (user === null)
        {
            throw new HttpError(404, 'No such player.', { code: 'reward-missing' });
        }
    };

    /** Rule 7 and the staff's freeze, the one place they are decided. Raw SQL: the newest wallet is a correlated subquery a repository cannot say. */
    const factsOf = async (from: EntityManager, userId: string) =>
    {
        const [facts] = await from.query(
            `select ${ isSystem('u.id') } as system,
                    u.is_minor as minor,
                    u.is_suspended as suspended,
                    exists (select 1 from reward_freezes f where f.user_id = u.id) as frozen,
                    exists (select 1 from established_players e where e.user_id = u.id) as established,
                    (select w.address from wallets w where w.user_id = u.id order by w.last_used_at desc nulls last limit 1) as wallet
             from users u
             where u.id = $1`,
            [userId]
        ) as EligibilityFacts[];

        return facts;
    };

    const eligibility = async (from: EntityManager, userId: string) =>
    {
        const facts = await factsOf(from, userId);

        return facts === undefined ? 'not-established' as const : eligibilityOf(facts);
    };

    /** A frozen player's claim is refused whole; anyone else rule 7 refuses claims at 0 NURA, the reason given. */
    const claimGate = async (tx: EntityManager, userId: string) =>
    {
        const gate = questClaimGate(await factsOf(tx, userId));

        if ('refused' in gate)
        {
            throw rewardRefusal(gate.refused, REFUSAL_WORDS[gate.refused] ?? 'This player may not earn NURA rewards.');
        }

        return gate.withheld;
    };

    const settingOf = async (from: EntityManager, key: 'reward-config' | 'reward-budget') =>
        (await from.getRepository(Setting).findOneBy({ key }))?.value ?? null;

    const configOf = async (from: EntityManager) => rewardConfigOf(await settingOf(from, 'reward-config'));

    /** The config, when the switch is on; refused as `reward-off` when it is not. */
    const runningConfig = async (from: EntityManager) =>
    {
        const config = await configOf(from);

        if (!config.on)
        {
            throw switchedOff();
        }

        return config;
    };

    const gamesOpen = async (from: EntityManager) =>
        drawnGames((await from.getRepository(Game).find({ select: { id: true }, where: { status: 'available' } })).map((game) => game.id));

    /** The configured looks that are still in the shop. */
    const looksOf = async (tx: EntityManager, config: RewardConfig) =>
    {
        const wanted = [...config.pool, ...(config.exclusive === null ? [] : [config.exclusive])];
        const known = wanted.length === 0
            ? new Set<string>()
            : new Set((await tx.getRepository(ShopItem).find({ select: { id: true }, where: { id: In(wanted) } })).map((item) => item.id));

        return {
            pool: config.pool.filter((id) => known.has(id)),
            exclusive: config.exclusive !== null && known.has(config.exclusive) ? config.exclusive : null
        };
    };

    const giveLook = async (tx: EntityManager, userId: string, itemId: string) =>
    {
        const owned = await tx.getRepository(OwnedItem).createQueryBuilder()
            .insert()
            .values({ userId, itemId, via: 'reward', orderId: null, giverId: null })
            .orIgnore()
            .returning(['itemId'])
            .execute();

        return (owned.raw as unknown[]).length > 0;
    };

    /**
     * Every NURA a player earns is written here, inside the caller's transaction and after the
     * caller locked the player's row (`lockPlayer`), which is what keeps the cap's sum from racing.
     * Booked to the cycle of the day it is granted on, clipped to the cap (rule 5) and to the
     * budget opened so far (rule 4), and once per (player, source, key) (rule 6).
     */
    const grant = async (tx: EntityManager, userId: string, ask: GrantAsk): Promise<Granted> =>
    {
        const grants = tx.getRepository(RewardGrant);

        if (await grants.existsBy({ userId, source: ask.source, sourceKey: ask.sourceKey }))
        {
            return NOT_WRITTEN;
        }

        const { cycle, day: cycleDay } = cycleOf(ask.today);
        const wanted = weiOf(ask.wanted);
        let award: { amount: bigint; clipped?: RewardRefusal } = { amount: 0n };
        let total: RewardCycleTotal | null = null;

        if (ask.withheld !== undefined)
        {
            award = { amount: 0n, clipped: ask.withheld };
        }
        else if (wanted > 0n)
        {
            const [mine] = await tx.query(
                'select coalesce(sum(amount), 0)::text as total from reward_grants where user_id = $1 and cycle = $2',
                [userId, cycle]
            ) as [{ total: string }];

            await tx.getRepository(RewardCycleTotal).createQueryBuilder()
                .insert()
                .values({ cycle, granted: '0' })
                .orIgnore()
                .execute();

            total = await tx.getRepository(RewardCycleTotal).createQueryBuilder('total')
                .setLock('pessimistic_write')
                .where('total.cycle = :cycle', { cycle })
                .getOneOrFail();

            award = grantAward({
                wanted,
                playerGranted: BigInt(mine.total),
                cap: weiOf(REWARD_CAP),
                cycleGranted: BigInt(total.granted),
                budget: budgetOf(await settingOf(tx, 'reward-budget')),
                cycleDay
            });
        }

        const itemId = ask.itemId ?? null;
        const inserted = await grants.createQueryBuilder()
            .insert()
            .into(RewardGrant)
            .values({
                userId,
                cycle,
                day: ask.today,
                source: ask.source,
                sourceKey: ask.sourceKey,
                amount: award.amount.toString(),
                wanted: wanted.toString(),
                itemId,
                delivered: null
            })
            .orIgnore()
            .returning(['id'])
            .execute();

        const [row] = inserted.raw as { id: string }[];

        if (row === undefined)
        {
            return NOT_WRITTEN;
        }

        if (total !== null && award.amount > 0n)
        {
            await tx.getRepository(RewardCycleTotal).update({ cycle }, { granted: (BigInt(total.granted) + award.amount).toString() });
        }

        let delivered: boolean | null = null;

        if (itemId !== null)
        {
            delivered = await giveLook(tx, userId, itemId);
            await grants.update({ id: row.id }, { delivered });
        }

        return {
            amount: nuraOf(award.amount),
            written: true,
            delivered,
            ...(award.clipped === undefined ? {} : { clipped: award.clipped })
        };
    };

    const onFinish: NonNullable<QuestProgressHook['onFinish']> = async (tx, match, game, players) =>
    {
        const effects: RewardFinishEffects = { changed: [], ready: [] };

        if (players.length === 0)
        {
            return effects;
        }

        // One statement per match, not per player: the switch and the games quests are drawn from.
        const [{ config, games: open }] = await tx.query(
            `select (select s.value from settings s where s.key = 'reward-config') as config,
                    array(select g.id::text from games g where g.status = 'available') as games`
        ) as [{ config: string | null; games: string[] }];

        if (!rewardConfigOf(config).on)
        {
            return effects;
        }

        const games = drawnGames(open);
        const today = todayOf();
        const cycle = cycleOf(today);
        const weekKey = cycle.week === null ? null : weekKeyOf(cycle.cycle, cycle.week);
        const weekly = cycle.week === null || weekKey === null ? [] : questsFor(cycle.cycle, cycle.week, 'weekly', games);
        const active = [
            ...questsFor(cycle.cycle, cycle.day, 'daily', games).map((quest) => ({ quest, periodKey: String(today) })),
            ...weekly.map((quest) => ({ quest, periodKey: weekKey ?? '' }))
        ];

        // In user order, not seat order: two matches between the same players finishing together
        // with seats swapped would otherwise take each other's rows in opposite order and deadlock.
        const byUser = [...players].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

        for (const player of byUser)
        {
            const opponents =[...new Set(player.opponentIds.filter((id) => id !== player.userId))];
            const validResult = ['won', 'lost', 'drawn'].includes(player.result) && (player.result !== 'won' || player.credit === true);
            const mayCountOpponent = validResult && player.ownTurns >= MIN_QUEST_TURNS[game] && opponents.length > 0;

            // One statement reads the social/established facts and atomically advances each opponent's daily counter.
            const [facts] = await tx.query(
                `with opponents as (
                     select distinct unnest($2::uuid[]) as opponent_id
                 ), known as (
                     select o.opponent_id,
                            exists (select 1 from friendships f where f.user_id = $1 and f.friend_id = o.opponent_id) as friend,
                            exists (select 1 from established_players e where e.user_id = o.opponent_id) as established,
                            coalesce(c.count, 0)::int as previous
                     from opponents o
                     left join reward_quest_opponents c on c.user_id = $1 and c.day = $3 and c.opponent_id = o.opponent_id
                 ), bumped as (
                     insert into reward_quest_opponents (user_id, day, opponent_id, count)
                     select $1, $3, k.opponent_id, least(k.previous + 1, 4)::smallint
                     from known k
                     where $4::boolean
                     on conflict (user_id, day, opponent_id) do update
                     set count = least(reward_quest_opponents.count + 1, 4)::smallint
                     returning opponent_id, count
                 )
                 select coalesce(jsonb_agg(jsonb_build_object(
                            'id', k.opponent_id,
                            'friend', k.friend,
                            'established', k.established,
                            'count', case when $4::boolean then coalesce(b.count, k.previous) else k.previous end
                        )), '[]'::jsonb) as opponents,
                        exists (select 1 from tables t where t.id = $5 and t.tournament_id is not null) as tournament
                 from known k
                 left join bumped b on b.opponent_id = k.opponent_id`,
                [player.userId, opponents, today, mayCountOpponent, match.tableId]
            ) as [{ opponents: { id: string; friend: boolean; established: boolean; count: number }[]; tournament: boolean }];

            const opponentCounts = Object.fromEntries(facts.opponents.map((opponent) => [opponent.id, Number(opponent.count)]));
            const friendOpponentIds = facts.opponents.filter((opponent) => opponent.friend).map((opponent) => opponent.id);
            const establishedOpponents = facts.opponents.filter((opponent) => opponent.established).map((opponent) => opponent.id);
            const input = {
                game,
                result: player.result,
                credit: player.credit,
                ownTurns: player.ownTurns,
                playerId: player.userId,
                opponentIds: opponents,
                sameOpponentCounts: opponentCounts,
                friendOpponentIds,
                establishedOpponents,
                tournament: facts.tournament,
                tally: player.tally
            };
            let counts = countsForQuests(input);

            // The game is marked only by a match that counted, so one that did not leaves it for one that does.
            if (weekKey !== null && wantsDistinctGame(weekly, counts))
            {
                const marked = await tx.query(
                    `insert into reward_quest_games (user_id, period_key, game) values ($1, $2, $3)
                     on conflict do nothing
                     returning game`,
                    [player.userId, weekKey, game]
                ) as unknown[];

                if (marked.length > 0)
                {
                    counts = countsForQuests({ ...input, distinctGames: 1 });
                }
            }

            const matchingQuests = active.filter(({ quest }) => quest.game === 'any' || quest.game === game);
            const deltaById = new Map(deltasForQuests(matchingQuests.map(({ quest }) => quest), game, counts).map((delta) => [delta.quest_id, delta]));
            const deltas = inQuestOrder(active.flatMap(({ quest, periodKey }) =>
            {
                const delta = deltaById.get(quest.id);
                return delta === undefined ? [] : [{ ...delta, period_key: periodKey }];
            }));

            if (deltas.length > 0)
            {
                // A single multi-row upsert keeps a match to few reward statements per player. Its rows
                // are locked in the order claim-all locks them, or the two deadlock.
                const advanced = await tx.query(
                    `with incoming as (
                         select * from jsonb_to_recordset($1::jsonb) as x(period varchar, period_key varchar, quest_id varchar, progress integer, target integer)
                     )
                     insert into reward_quest_progress (user_id, period, period_key, quest_id, progress, target, done_at)
                     select $2, period, period_key, quest_id, least(progress, target), target,
                            case when progress >= target then now() else null end
                     from incoming
                     order by period collate "C", period_key collate "C", quest_id collate "C"
                     on conflict (user_id, period, period_key, quest_id) do update set
                        progress = least(reward_quest_progress.target, reward_quest_progress.progress + excluded.progress),
                        done_at = case
                            when reward_quest_progress.progress + excluded.progress >= reward_quest_progress.target
                                then coalesce(reward_quest_progress.done_at, now())
                            else reward_quest_progress.done_at
                        end
                     where reward_quest_progress.claimed_at is null
                       and reward_quest_progress.progress < reward_quest_progress.target
                     returning period_key, quest_id, done_at = now() as just_done`,
                    [JSON.stringify(deltas), player.userId]
                ) as { period_key: string; quest_id: string; just_done: boolean }[];

                if (advanced.length > 0)
                {
                    effects.changed.push(player.userId);
                    for (const row of advanced)
                    {
                        if (row.just_done)
                        {
                            effects.ready.push({ userId: player.userId, periodKey: row.period_key, questId: row.quest_id });
                        }
                    }
                }
            }
        }

        return effects;
    };

    const state = async (userId: string) =>
    {
        const [config, games] = await Promise.all([runningConfig(db.manager), gamesOpen(db.manager)]);
        const today = todayOf();
        const cycle = cycleOf(today);
        const weekKey = cycle.week === null ? null : weekKeyOf(cycle.cycle, cycle.week);
        const dailyTemplates = questsFor(cycle.cycle, cycle.day, 'daily', games);
        const weeklyTemplates = cycle.week === null ? [] : questsFor(cycle.cycle, cycle.week, 'weekly', games);

        const [streakRow, reason, granted, progressRows, chestClaimed, withdrawable] = await Promise.all([
            db.getRepository(RewardStreak).findOne({ where: { userId } }),
            eligibility(db.manager, userId),
            db.query(
                'select coalesce(sum(amount), 0)::text as total from reward_grants where user_id = $1 and cycle = $2',
                [userId, cycle.cycle]
            ) as Promise<[{ total: string }]>,
            db.getRepository(RewardQuestProgress).find({
                where: [
                    { userId, period: 'daily', periodKey: String(today) },
                    ...(weekKey === null ? [] : [{ userId, period: 'weekly' as const, periodKey: weekKey }])
                ]
            }),
            weekKey === null ? Promise.resolve(false) : db.getRepository(RewardGrant).existsBy({ userId, source: 'chest', sourceKey: weekKey }),
            payouts === null ? Promise.resolve('0') : payouts.withdrawable(userId)
        ]);

        const view = ladderView(streakRow, today);
        const progressByKey = new Map(progressRows.map((row) => [`${ row.period }:${ row.questId }`, row]));

        /** The period's draw, then any quest of it with progress that a game switched off since took out of the draw: it is still claimable. */
        const questsOf = (period: 'daily' | 'weekly', drawn: readonly QuestTemplate[]) =>
        {
            const ids = new Set(drawn.map((quest) => quest.id));
            const left = progressRows.flatMap((row) =>
            {
                const quest = row.period === period && !ids.has(row.questId) ? templateOf(period, row.questId) : null;

                return quest === null ? [] : [quest];
            });

            return [...drawn, ...left].map((quest) => questView(quest, progressByKey.get(`${ period }:${ quest.id }`), config.amounts[period]));
        };

        return {
            streak: view.streak,
            lastDay: streakRow?.lastDay ?? 0,
            best: streakRow?.best ?? 0,
            claimable: view.claimable,
            today,
            position: view.position,
            ladder: config.amounts.ladder.map((_, index) =>
            {
                const { amount, look, bonus } = rewardForDay(index + 1, config.amounts);

                return {
                    day: index + 1,
                    amount,
                    claimed: index + 1 <= view.claimed,
                    ...(look === undefined ? {} : { look }),
                    ...(bonus === 0 ? {} : { bonus })
                };
            }),
            cycleGranted: nuraOf(granted[0].total),
            withdrawable: nuraOf(withdrawable),
            daily: questsOf('daily', dailyTemplates),
            weekly: questsOf('weekly', weeklyTemplates),
            chest: config.amounts.chest,
            chestClaimed,
            ...(reason === undefined ? {} : { reason })
        };
    };

    /** Grants the chest of a week whose three quests are all claimed now; nothing when it is not ready or already granted. */
    const openChest = async (tx: EntityManager, userId: string, periodKey: string, today: number, config: RewardConfig, withheld: RewardRefusal | undefined): Promise<ClaimedQuest | null> =>
    {
        if (cycleWeekOf(periodKey) === null)
        {
            return null;
        }

        const claimed = await tx.getRepository(RewardQuestProgress).find({
            select: { questId: true },
            where: { userId, period: 'weekly', periodKey, claimedAt: Not(IsNull()) }
        });

        if (!weeklyChestReady(claimed.map((quest) => quest.questId)))
        {
            return null;
        }

        const looks = await looksOf(tx, config);
        const paid = await grant(tx, userId, {
            source: 'chest',
            sourceKey: periodKey,
            wanted: config.amounts.chest,
            today,
            itemId: pickLook(looks.pool, `${ userId }:${ periodKey }`),
            ...(withheld === undefined ? {} : { withheld })
        });

        return paid.written
            ? { period: 'weekly', id: `chest:${ periodKey }`, amount: paid.amount, ...(paid.clipped === undefined ? {} : { reason: paid.clipped }) }
            : null;
    };

    /** Claims locked, done, unclaimed quest rows: each through `grant()`, and the week's chest with the last of its three. */
    const claimRows = async (tx: EntityManager, userId: string, today: number, rows: readonly RewardQuestProgress[], config: RewardConfig, withheld: RewardRefusal | undefined) =>
    {
        const claimed: ClaimedQuest[] = [];

        for (const row of rows)
        {
            if (!claimableRow(row) || templateOf(row.period, row.questId) === null)
            {
                continue;
            }

            const paid = await grant(tx, userId, {
                source: row.period,
                sourceKey: `${ row.periodKey }:${ row.questId }`,
                wanted: config.amounts[row.period],
                today,
                ...(withheld === undefined ? {} : { withheld })
            });

            await tx.getRepository(RewardQuestProgress).update(
                { userId, period: row.period, periodKey: row.periodKey, questId: row.questId, claimedAt: IsNull() },
                { claimedAt: new Date() }
            );

            claimed.push({ period: row.period, id: row.questId, amount: paid.amount, ...(paid.clipped === undefined ? {} : { reason: paid.clipped }) });

            if (row.period === 'weekly')
            {
                const chest = await openChest(tx, userId, row.periodKey, today, config, withheld);

                if (chest !== null)
                {
                    claimed.push(chest);
                }
            }
        }

        return claimed;
    };

    /** The order `inQuestOrder` gives and the match finish's upsert locks in; any other order can deadlock with it. */
    const QUEST_ORDER = {
        '"progress"."period" collate "C"': 'ASC' as const,
        '"progress"."period_key" collate "C"': 'ASC' as const,
        '"progress"."quest_id" collate "C"': 'ASC' as const
    };

    const lockedProgress = (tx: EntityManager, userId: string) => tx.getRepository(RewardQuestProgress).createQueryBuilder('progress')
        .setLock('pessimistic_write')
        .where('progress.userId = :userId', { userId });

    const claimQuest = async (userId: string, period: 'daily' | 'weekly', questId: string) => db.transaction(async (tx) =>
    {
        const config = await runningConfig(tx);

        await lockPlayer(tx, userId);
        const withheld = await claimGate(tx, userId);

        const today = todayOf();
        const rows = templateOf(period, questId) === null ? [] : await lockedProgress(tx, userId)
            .andWhere('progress.period = :period and progress.questId = :questId', { period, questId })
            .andWhere('progress.periodKey in (:...periodKeys)', { periodKeys: periodKeysInClaimWindow(period, today) })
            .orderBy(QUEST_ORDER)
            .getMany();

        const row = rows.find(claimableRow) ?? rows[0];

        if (row === undefined || row.doneAt === null || row.progress < row.target)
        {
            return { claimed: false, period, id: questId, amount: 0, reason: 'not-ready' };
        }

        if (row.claimedAt !== null)
        {
            return { claimed: false, period, id: questId, amount: 0, reason: 'reward-claimed' };
        }

        const claimed = await claimRows(tx, userId, today, [row], config, withheld);
        const reason = claimed.find((one) => one.reason !== undefined)?.reason;

        return {
            claimed: true,
            period,
            id: questId,
            amount: claimed.reduce((sum, one) => sum + one.amount, 0),
            ...(reason === undefined ? {} : { reason })
        };
    });

    const claimAll = async (userId: string) => db.transaction(async (tx) =>
    {
        const config = await runningConfig(tx);

        await lockPlayer(tx, userId);
        const withheld = await claimGate(tx, userId);

        const today = todayOf();
        const rows = await lockedProgress(tx, userId)
            .andWhere('progress.doneAt IS NOT NULL')
            .andWhere('progress.claimedAt IS NULL')
            .andWhere('progress.periodKey in (:...periodKeys)', { periodKeys: [...periodKeysInClaimWindow('daily', today), ...periodKeysInClaimWindow('weekly', today)] })
            .orderBy(QUEST_ORDER)
            .getMany();

        const claimed = await claimRows(tx, userId, today, rows, config, withheld);

        return { claimed, total: claimed.reduce((sum, one) => sum + one.amount, 0) };
    });

    const activity = async (userId: string) =>
    {
        const today = todayOf();
        const start = new Date(REWARD_EPOCH_MS + (today - 1) * REWARD_DAY_MS);
        const end = new Date(start.getTime() + REWARD_DAY_MS);

        const matchesPlayed = await db.getRepository(MatchPlayer).createQueryBuilder('mp')
            .innerJoin('mp.match', 'm')
            .where('mp.userId = :userId', { userId })
            .andWhere('m.finishedAt >= :start', { start })
            .andWhere('m.finishedAt < :end', { end })
            .andWhere('mp.result IN (:...results)', { results: ['won', 'drawn', 'lost'] })
            .getCount();

        const dailyPeriodKeys = periodKeysInClaimWindow('daily', today);
        const dailyDone = await db.getRepository(RewardQuestProgress).createQueryBuilder('p')
            .where('p.userId = :userId', { userId })
            .andWhere('p.period = :period', { period: 'daily' })
            .andWhere('p.periodKey in (:...keys)', { keys: dailyPeriodKeys })
            .andWhere('p.doneAt IS NOT NULL')
            .getCount();
        const dailyClaimed = await db.getRepository(RewardQuestProgress).createQueryBuilder('p')
            .where('p.userId = :userId', { userId })
            .andWhere('p.period = :period', { period: 'daily' })
            .andWhere('p.periodKey in (:...keys)', { keys: dailyPeriodKeys })
            .andWhere('p.claimedAt IS NOT NULL')
            .getCount();

        const cycleInfo = cycleOf(today);
        let weeklyDone = 0;
        let weeklyClaimed = 0;
        if (cycleInfo.week !== null)
        {
            const weeklyPeriodKeys = periodKeysInClaimWindow('weekly', today);
            weeklyDone = await db.getRepository(RewardQuestProgress).createQueryBuilder('p')
                .where('p.userId = :userId', { userId })
                .andWhere('p.period = :period', { period: 'weekly' })
                .andWhere('p.periodKey in (:...keys)', { keys: weeklyPeriodKeys })
                .andWhere('p.doneAt IS NOT NULL')
                .getCount();
            weeklyClaimed = await db.getRepository(RewardQuestProgress).createQueryBuilder('p')
                .where('p.userId = :userId', { userId })
                .andWhere('p.period = :period', { period: 'weekly' })
                .andWhere('p.periodKey in (:...keys)', { keys: weeklyPeriodKeys })
                .andWhere('p.claimedAt IS NOT NULL')
                .getCount();
        }

        const activityScore = Math.min(100, (matchesPlayed * 20) + (dailyDone * 15) + (weeklyDone * 10));
        const activityLevel = (activityScore >= 60 ? 'gold' : activityScore >= 30 ? 'silver' : 'bronze') as 'gold' | 'silver' | 'bronze';

        return {
            today,
            matchesPlayed,
            daily: { done: dailyDone, claimed: dailyClaimed },
            weekly: { done: weeklyDone, claimed: weeklyClaimed },
            activityScore,
            activityLevel,
            firstMatchOfDay: matchesPlayed >= 1 && dailyDone === 0
        };
    };

    /**
     * Today's check-in: the streak moves and the looks are given whoever the player is; the NURA
     * part is 0 for a player rule 7 refuses, with the reason. The day pays its ladder position, and
     * position 30 the bonus as a ledger row of its own.
     */
    const checkIn = async (userId: string) => db.transaction(async (tx) =>
    {
        const config = await runningConfig(tx);

        await lockPlayer(tx, userId);

        const today = todayOf();
        const streakRow = await tx.getRepository(RewardStreak).createQueryBuilder('streak')
            .setLock('pessimistic_write')
            .where('streak.userId = :userId', { userId })
            .getOne();

        const plan = planCheckIn(streakRow, today, config.amounts);
        const refused = { claimed: false as const, day: today, position: plan.position, amount: 0, reason: 'reward-claimed' as const };

        if (!plan.claimable)
        {
            return refused;
        }

        const inserted = await tx.getRepository(RewardCheckin).createQueryBuilder()
            .insert()
            .into(RewardCheckin)
            .values({ userId, day: today, position: plan.position })
            .orIgnore()
            .returning(['day'])
            .execute();

        if ((inserted.raw as unknown[]).length === 0)
        {
            return refused;
        }

        await tx.getRepository(RewardStreak).createQueryBuilder()
            .insert()
            .into(RewardStreak)
            .values({ userId, streak: plan.position, run: plan.run, lastDay: today, best: plan.best })
            .orUpdate(['streak', 'run', 'last_day', 'best'], ['user_id'])
            .execute();

        const withheld = await eligibility(tx, userId);
        const looks = plan.pay.look === undefined ? null : await looksOf(tx, config);
        const sourceKey = `day:${ today }`;

        const ladder = await grant(tx, userId, {
            source: 'checkin',
            sourceKey,
            wanted: plan.pay.amount,
            today,
            itemId: plan.pay.look === 'weekly' && looks !== null ? pickLook(looks.pool, `${ userId }:${ today }`) : null,
            ...(withheld === undefined ? {} : { withheld })
        });

        const bonus = plan.pay.look === 'exclusive'
            ? await grant(tx, userId, {
                source: 'bonus',
                sourceKey,
                wanted: plan.pay.bonus,
                today,
                itemId: looks?.exclusive ?? null,
                ...(withheld === undefined ? {} : { withheld })
            })
            : NOT_WRITTEN;

        const reason = withheld ?? ladder.clipped ?? bonus.clipped;

        return {
            claimed: true as const,
            day: today,
            position: plan.position,
            amount: ladder.amount + bonus.amount,
            delivered: ladder.delivered ?? bonus.delivered,
            ...(plan.pay.look === undefined ? {} : { look: plan.pay.look }),
            ...(reason === undefined ? {} : { reason })
        };
    });

    /** The player's ledger, newest first, a page at a time, in whole NURA. */
    const history = async (userId: string, cursor: string | null) =>
    {
        const after = keysetAfter(cursor);
        const query = db.getRepository(RewardGrant).createQueryBuilder('g')
            .select('g.id', 'id')
            .addSelect('g.source', 'source')
            .addSelect('g.amount::text', 'amount')
            .addSelect('g.created_at', 'at')
            .addSelect('g.source_key', 'note')
            .addSelect(keyOf('g.created_at'), 'at_key')
            .where('g.user_id = :userId', { userId });

        if (after !== null)
        {
            query.andWhere(olderThan('g.created_at', 'g.id'), after);
        }

        const rows = await query
            .orderBy('g.created_at', 'DESC')
            .addOrderBy('g.id', 'DESC')
            .limit(HISTORY_PAGE + 1)
            .getRawMany<HistoryRow>();

        return {
            items: rows.slice(0, HISTORY_PAGE).map((row) => ({
                id: row.id,
                kind: historyKind(row.source),
                at: new Date(row.at).toISOString(),
                amount: nuraOf(row.amount),
                note: row.note
            })),
            hasMore: rows.length > HISTORY_PAGE,
            ...cursorOf(rows, HISTORY_PAGE)
        };
    };

    const withdraw = async (userId: string) =>
    {
        if (payouts === null)
        {
            throw rewardRefusal('reward-wallet', 'Rewards withdrawals are not available because the rewards wallet is not configured.');
        }

        return await payouts.withdraw(userId);
    };

    /** What is left to withdraw, switch or no switch: it was earned and is the player's. */
    const balance = async (userId: string) => ({ withdrawable: payouts === null ? 0 : nuraOf(await payouts.withdrawable(userId)) });

    const sweep = async (budgetMs: number): Promise<RewardPayoutSweep> => payouts === null
        ? { mined: 0, retried: 0, failed: 0, faults: [] }
        : await payouts.sweep(budgetMs);

    /** Whether rewards run here: the browser hides their door, and a reminder is not sent, while they do not. */
    const switchedOn = async () => (await configOf(db.manager)).on;

    return { state, checkIn, claimQuest, claimAll, activity, history, onFinish, withdraw, balance, sweep, switchedOn, audit: payouts?.audit };
}
