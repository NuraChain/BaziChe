import { HttpError } from '@azerothjs/http';
import { In, IsNull, type DataSource, type EntityManager } from 'typeorm';

import type { RewardWallet } from '../../chain/rewards.ts';
import { EstablishedPlayer } from '../../entities/established-player.entity.ts';
import { OwnedItem } from '../../entities/owned-item.entity.ts';
import { RewardCheckin } from '../../entities/reward-checkin.entity.ts';
import { RewardGrant } from '../../entities/reward-grant.entity.ts';
import { RewardQuestProgress } from '../../entities/reward-quest-progress.entity.ts';
import { RewardStreak } from '../../entities/reward-streak.entity.ts';
import { Setting } from '../../entities/setting.entity.ts';
import { ShopItem } from '../../entities/shop-item.entity.ts';
import { User } from '../../entities/user.entity.ts';
import { REWARD_CAP, REWARD_DAY_MS, REWARD_EPOCH_MS, REWARD_LADDER, cycleOf, nextStreak, rewardDayOf } from './rules.ts';
import { countsForQuests, deltasForQuests, MIN_QUEST_TURNS, weeklyChestReady, type QuestProgressHook, type RewardFinishEffects } from './progress.ts';
import { questsFor } from './quests.ts';
import { createRewardPayoutService, type RewardPayoutSweep } from './payout.ts';
import { REWARD_REFUSALS, type RewardRefusal } from './refusals.ts';
import type { QuestTemplate } from './quests.ts';

const WEI_PER_NURA = 10n ** 18n;

const weiFor = (nura: number) => BigInt(nura) * WEI_PER_NURA;

const nuraFor = (wei: string | bigint) => Number(BigInt(wei) / WEI_PER_NURA);

export interface RewardDayResult
{
    amount: number;
    bonus: number;
    look?: 'weekly' | 'exclusive';
    day: number;
    eligible: boolean;
}

export const rewardRefusal = (word: RewardRefusal, message: string) =>
    new HttpError(REWARD_REFUSALS[word], message, { code: word });

/** A check-in day pays the ladder amount, with a look on the weekly skin days and the cycle bonus on day 30. */
export const rewardForDay = (day: number, established: boolean): RewardDayResult =>
{
    const ladderAmount = REWARD_LADDER[day - 1] ?? 0;

    if (day === 30)
    {
        return {
            day,
            amount: established ? 0 : 0,
            bonus: established ? 20_000 : 0,
            look: 'exclusive',
            eligible: established
        };
    }

    const look = [7, 14, 21, 28].includes(day) ? 'weekly' : undefined;

    return {
        day,
        amount: established ? ladderAmount : 0,
        bonus: 0,
        ...(look === undefined ? {} : { look }),
        eligible: established
    };
};

interface RewardState
{
    streak: number;
    lastDay: number;
    best: number;
    claimable: boolean;
    today: number;
    ladder: { day: number; amount: number; claimed: boolean; look?: 'weekly' | 'exclusive' }[];
    cycleGranted: number;
    withdrawable: number;
    reason?: RewardRefusal;
    daily: { id: string; game: string; target: number; progress: number; done: boolean; claimed: boolean }[];
    weekly: { id: string; game: string; target: number; progress: number; done: boolean; claimed: boolean }[];
    chestClaimed: boolean;
}

const todayOf = () => rewardDayOf(new Date());

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
                keys.add(`cycle:${ cycle.cycle }:week:${ cycle.week }`);
            }
        }
    }

    return [...keys];
};

const questForPeriodKey = (period: 'daily' | 'weekly', periodKey: string, questId: string) =>
{
    if (period === 'daily')
    {
        const day = Number(periodKey);
        if (!Number.isInteger(day) || day < 1)
        {
            return null;
        }

        const cycle = cycleOf(day);
        return questsFor(cycle.cycle, cycle.day, 'daily').find((quest) => quest.id === questId) ?? null;
    }

    const cycle = cycleWeekOf(periodKey);
    return cycle === null ? null : questsFor(cycle.cycle, cycle.week, 'weekly').find((quest) => quest.id === questId) ?? null;
};

export function createRewardService(db: DataSource, wallet?: RewardWallet, hooks: { mined?(userId: string): void } = {})
{
    const payouts = wallet === undefined ? null : createRewardPayoutService(db, wallet, hooks);

    const onFinish: NonNullable<QuestProgressHook['onFinish']> = async (tx, match, game, players) =>
    {
        const effects: RewardFinishEffects = { changed: [], ready: [] };
        const today = todayOf();
        const cycle = cycleOf(today);
        const weekStartDay = cycle.week === null ? today : today - (cycle.day - ((cycle.week - 1) * 7 + 1));
        const weekStart = new Date(REWARD_EPOCH_MS + (weekStartDay - 1) * REWARD_DAY_MS);
        const weekEnd = new Date(weekStart.getTime() + 7 * REWARD_DAY_MS);
        const active = [
            ...questsFor(cycle.cycle, cycle.day, 'daily').map((quest) => ({ quest, periodKey: String(today) })),
            ...(cycle.week === null ? [] : questsFor(cycle.cycle, cycle.week, 'weekly').map((quest) => ({ quest, periodKey: `cycle:${ cycle.cycle }:week:${ cycle.week }` })))
        ];

        for (const player of players)
        {
            const opponents = [...new Set(player.opponentIds.filter((id) => id !== player.userId))];
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
                 ), weekly_games as (
                     select coalesce(array_agg(distinct m.game), '{}'::varchar[]) as games
                     from matches m
                     inner join match_players mp on mp.match_id = m.id
                     where mp.user_id = $1 and m.id <> $5 and m.finished_at >= $6 and m.finished_at < $7
                       and mp.result in ('won', 'lost', 'drawn')
                 )
                 select coalesce(jsonb_agg(jsonb_build_object(
                            'id', k.opponent_id,
                            'friend', k.friend,
                            'established', k.established,
                            'count', case when $4::boolean then coalesce(b.count, k.previous) else k.previous end
                        )), '[]'::jsonb) as opponents,
                        exists (select 1 from tables t where t.id = $8 and t.tournament_id is not null) as tournament,
                        (select games from weekly_games) as games
                 from known k
                 left join bumped b on b.opponent_id = k.opponent_id`,
                [player.userId, opponents, today, mayCountOpponent, match.id, weekStart, weekEnd, match.tableId]
            ) as [{ opponents: { id: string; friend: boolean; established: boolean; count: number }[]; tournament: boolean; games: string[] }];

            const opponentCounts = Object.fromEntries(facts.opponents.map((opponent) => [opponent.id, Number(opponent.count)]));
            const friendOpponentIds = facts.opponents.filter((opponent) => opponent.friend).map((opponent) => opponent.id);
            const establishedOpponents = facts.opponents.filter((opponent) => opponent.established).map((opponent) => opponent.id);
            const seenGames = new Set(facts.games ?? []);
            const counts = countsForQuests({
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
                tally: player.tally,
                ...(mayCountOpponent && !seenGames.has(game) ? { distinctGames: 1 } : {})
            });

            const matchingQuests = active.filter(({ quest }) => quest.game === 'any' || quest.game === game);
            const deltaById = new Map(deltasForQuests(matchingQuests.map(({ quest }) => quest), game, counts).map((delta) => [delta.questId, delta]));
            const deltas = active.flatMap(({ quest, periodKey }) =>
            {
                const delta = deltaById.get(quest.id);
                return delta === undefined ? [] : [{ ...delta, periodKey }];
            });

            if (deltas.length > 0)
            {
                // A single multi-row upsert keeps a match to at most two reward statements per player.
                const advanced = await tx.query(
                    `with incoming as (
                         select * from jsonb_to_recordset($1::jsonb) as x(period varchar, period_key varchar, quest_id varchar, progress integer, target integer)
                     )
                     insert into reward_quest_progress (user_id, period, period_key, quest_id, progress, target, done_at)
                     select $2, period, period_key, quest_id, least(progress, target), target,
                            case when progress >= target then now() else null end
                     from incoming
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

    const state = async (userId: string): Promise<RewardState> =>
    {
        const [streakRow, claimedRows, established] = await Promise.all([
            db.getRepository(RewardStreak).findOne({ where: { userId } }),
            db.getRepository(RewardCheckin).find({ where: { userId } }),
            db.getRepository(EstablishedPlayer).exists({ where: { userId } })
        ]);

        const today = todayOf();
        const cycle = cycleOf(today).cycle;
        const claimedDaySet = new Set(claimedRows.map((one) => one.day));
        const ladder: RewardState['ladder'] = REWARD_LADDER.map((amount, index) =>
        {
            const day = index + 1;
            const look = [7, 14, 21, 28].includes(day) ? 'weekly' : day === 30 ? 'exclusive' : undefined;

            return {
                day,
                amount,
                claimed: claimedDaySet.has(day),
                ...(look === undefined ? {} : { look })
            };
        });

        const cycleGranted = await db.getRepository(RewardGrant).createQueryBuilder('grant')
            .select('coalesce(sum(grant.amount)::bigint, 0)', 'total')
            .where('grant.user_id = :userId', { userId })
            .andWhere('grant.cycle = :cycle', { cycle })
            .getRawOne<{ total: string }>();

        const reason = established ? undefined : 'not-established';
        const withdrawable = payouts === null ? 0 : nuraFor(await payouts.withdrawable(userId));

        const cycleInfo = cycleOf(today);
        const dailyTemplates = questsFor(cycleInfo.cycle, today, 'daily');
        const weeklyTemplates: QuestTemplate[] = cycleInfo.week === null ? [] : questsFor(cycleInfo.cycle, cycleInfo.week, 'weekly');
        const allTemplateIds = [...dailyTemplates.map((q) => q.id), ...weeklyTemplates.map((q) => q.id)];
        const periodKeys = periodKeysInClaimWindow('daily', today).concat(cycleInfo.week === null ? [] : periodKeysInClaimWindow('weekly', today));

        const progressRows = await db.getRepository(RewardQuestProgress).find({
            where: { userId, period: In(['daily', 'weekly'] as const), questId: In(allTemplateIds), periodKey: In(periodKeys) }
        });
        const progressByKey = new Map(progressRows.map((row) => [`${row.period}:${row.periodKey}:${row.questId}`, row]));

        const daily = dailyTemplates.map((quest) =>
        {
            const row = progressByKey.get(`daily:${today}:${quest.id}`);
            return {
                id: quest.id,
                game: quest.game,
                target: quest.target,
                progress: row?.progress ?? 0,
                done: row?.doneAt !== null,
                claimed: row?.claimedAt !== null
            };
        });

        const weekly = weeklyTemplates.map((quest) =>
        {
            const key = `cycle:${cycleInfo.cycle}:week:${cycleInfo.week}`;
            const row = progressByKey.get(`weekly:${key}:${quest.id}`);
            return {
                id: quest.id,
                game: quest.game,
                target: quest.target,
                progress: row?.progress ?? 0,
                done: row?.doneAt !== null,
                claimed: row?.claimedAt !== null
            };
        });

        const chestClaimed = weekly.length > 0 && weekly.every((q) => q.claimed);

        return {
            streak: streakRow?.streak ?? 0,
            lastDay: streakRow?.lastDay ?? 0,
            best: streakRow?.best ?? 0,
            claimable: !claimedDaySet.has(today),
            today,
            ladder,
            cycleGranted: nuraFor(cycleGranted?.total ?? '0'),
            withdrawable,
            daily,
            weekly,
            chestClaimed,
            ...(reason === undefined ? {} : { reason })
        };
    };

    const grant = async (
        tx: EntityManager,
        userId: string,
        day: number,
        source: 'checkin' | 'bonus' | 'daily' | 'weekly' | 'chest',
        amountWanted: number,
        options: { cycle?: number; sourceKey?: string; itemId?: string | null } = {}
    ) =>
    {
        const established = await tx.getRepository(EstablishedPlayer).exists({ where: { userId } });
        if (!established)
        {
            throw rewardRefusal('not-established', 'Only an established player may earn NURA rewards.');
        }

        const total = await tx.getRepository(RewardGrant).createQueryBuilder('grant')
            .select('coalesce(sum(grant.amount)::bigint, 0)', 'total')
            .where('grant.user_id = :userId', { userId })
            .andWhere('grant.cycle = :cycle', { cycle: options.cycle ?? 0 })
            .getRawOne<{ total: string }>();

        const alreadyGranted = BigInt(total?.total ?? '0');
        const wanted = weiFor(amountWanted);
        const award = wanted < weiFor(REWARD_CAP) - alreadyGranted
            ? wanted
            : (weiFor(REWARD_CAP) > alreadyGranted ? weiFor(REWARD_CAP) - alreadyGranted : 0n);

        let delivered: boolean | null = null;
        const itemId = options.itemId ?? null;
        if (itemId !== null)
        {
            const owned = await tx.getRepository(OwnedItem).createQueryBuilder()
                .insert()
                .values({ userId, itemId, via: 'reward', orderId: null, giverId: null })
                .orIgnore()
                .returning(['itemId'])
                .execute();
            delivered = (owned.raw as unknown[]).length > 0;
        }

        await tx.getRepository(RewardGrant).createQueryBuilder()
            .insert()
            .into(RewardGrant)
            .values({
                userId,
                cycle: options.cycle ?? 0,
                source,
                sourceKey: options.sourceKey ?? `${ userId }:${ source }:${ day }`,
                amount: award.toString(),
                wanted: wanted.toString(),
                itemId,
                delivered
            })
            .orIgnore()
            .execute();

        return nuraFor(award);
    };

    const claimQuest = async (userId: string, period: 'daily' | 'weekly', questId: string) => db.transaction(async (tx) =>
    {
        const today = todayOf();
        const periodKeys = periodKeysInClaimWindow(period, today);
        const rows = await tx.getRepository(RewardQuestProgress).createQueryBuilder('progress')
            .setLock('pessimistic_write')
            .where('progress.userId = :userId and progress.period = :period and progress.questId = :questId', { userId, period, questId })
            .andWhere('progress.periodKey in (:...periodKeys)', { periodKeys })
            .orderBy('progress.doneAt', 'DESC')
            .getMany();

        const row = rows.find((candidate) => questForPeriodKey(period, candidate.periodKey, questId) !== null);
        if (row === undefined)
        {
            return { claimed: false, period, id: questId, amount: 0, reason: 'not-ready' };
        }

        if (row.claimedAt !== null)
        {
            return { claimed: false, period, id: questId, amount: 0, reason: 'reward-claimed' };
        }

        if (row.doneAt === null || row.progress < row.target)
        {
            return { claimed: false, period, id: questId, amount: 0, reason: 'not-ready' };
        }

        const questCycle = period === 'daily'
            ? cycleOf(Number(row.periodKey))
            : cycleWeekOf(row.periodKey);

        if (questCycle === null)
        {
            return { claimed: false, period, id: questId, amount: 0, reason: 'not-ready' };
        }

        const source = period === 'daily' ? 'daily' : 'weekly';
        const amount = await grant(tx, userId, today, source, period === 'daily' ? 1_000 : 3_000, {
            cycle: questCycle.cycle,
            sourceKey: `${ userId }:${ period }:${ row.periodKey }:${ questId }`
        });

        await tx.getRepository(RewardQuestProgress).update(
            { userId, period, periodKey: row.periodKey, questId, claimedAt: IsNull() },
            { claimedAt: new Date() }
        );

        let total = amount;
        if (period === 'weekly' && questCycle !== null && questCycle.week !== null)
        {
            const weeklyIds = questsFor(questCycle.cycle, questCycle.week, 'weekly').map((quest) => quest.id);
            const claimed = await tx.getRepository(RewardQuestProgress).find({
                where: { userId, period: 'weekly', periodKey: row.periodKey, questId: In(weeklyIds) }
            });

            if (weeklyChestReady(weeklyIds, claimed.filter((quest) => quest.claimedAt !== null).map((quest) => quest.questId)))
            {
                const config = await tx.getRepository(Setting).findOne({ where: { key: 'reward-config' } });
                let pool: unknown = [];
                try
                {
                    pool = config === null ? [] : (JSON.parse(config.value) as { pool?: unknown }).pool ?? [];
                }
                catch
                {
                    pool = [];
                }

                const choices = Array.isArray(pool)
                    ? pool.filter((item): item is string => typeof item === 'string' && !item.startsWith('bundle.'))
                    : [];
                const available = choices.length === 0
                    ? []
                    : await tx.getRepository(ShopItem).find({ where: { id: In(choices) } });
                const look = available.length === 0
                    ? null
                    : available[([...userId, ...row.periodKey].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0)) % available.length].id;

                total += await grant(tx, userId, today, 'chest', 1_000, {
                    cycle: questCycle.cycle,
                    sourceKey: `${ userId }:chest:${ row.periodKey }`,
                    itemId: look
                });
            }
        }

        return { claimed: true, period, id: questId, amount: total };
    });

    const checkIn = async (userId: string) =>
    {
        return await db.transaction(async (tx) =>
        {
            const user = await tx.getRepository(User).findOne({ where: { id: userId } });
            if (user === null)
            {
                throw new HttpError(404, 'No such player.', { code: 'reward-missing' });
            }

            const today = todayOf();
            const streakRow = await tx.getRepository(RewardStreak).createQueryBuilder('s')
                .setLock('pessimistic_write')
                .where('s.user_id = :userId', { userId })
                .getOne();

            const existing = await tx.getRepository(RewardCheckin).createQueryBuilder('checkin')
                .where('checkin.user_id = :userId', { userId })
                .andWhere('checkin.day = :day', { day: today })
                .getOne();

            if (existing !== null)
            {
                return { claimed: false, day: today, amount: 0, reason: 'reward-claimed' };
            }

            const established = await tx.getRepository(EstablishedPlayer).exists({ where: { userId } });
            const current = streakRow ?? { userId, streak: 0, lastDay: 0, best: 0 };
            const next = nextStreak(current.lastDay, today, current.streak);
            const best = Math.max(current.best, next);
            const pay = rewardForDay(today, established);

            await tx.getRepository(RewardCheckin).createQueryBuilder()
                .insert()
                .into(RewardCheckin)
                .values({ userId, day: today, position: today })
                .orIgnore()
                .execute();

            await tx.getRepository(RewardStreak).createQueryBuilder()
                .insert()
                .into(RewardStreak)
                .values({ userId, streak: next, lastDay: today, best })
                .orUpdate(['streak', 'lastDay', 'best'], ['user_id'])
                .execute();

            const granted = established ? await grant(tx, userId, today, 'checkin', pay.amount + pay.bonus, { cycle: cycleOf(today).cycle }) : 0;

            return {
                claimed: true,
                day: today,
                amount: granted,
                look: pay.look,
                balance: granted,
                ...(established ? {} : { reason: 'not-established' as const })
            };
        });
    };

    const withdraw = async (userId: string) =>
    {
        if (payouts === null)
        {
            throw rewardRefusal('reward-wallet', 'Rewards withdrawals are not available because the rewards wallet is not configured.');
        }

        return await payouts.withdraw(userId);
    };

    const sweep = async (budgetMs: number): Promise<RewardPayoutSweep> => payouts === null
        ? { mined: 0, retried: 0, failed: 0, faults: [] }
        : await payouts.sweep(budgetMs);

    return { state, checkIn, claimQuest, grant, rewardForDay, onFinish, withdraw, sweep, audit: payouts?.audit };
}

export const rewardState = createRewardService;
