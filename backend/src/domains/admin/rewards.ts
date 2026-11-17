import { In, type DataSource, type EntityManager } from 'typeorm';

import type { RewardWallet } from '../../chain/rewards.ts';
import { RewardCycleTotal, RewardFreeze, Setting, ShopItem, User } from '../../entities/index.ts';
import { cursorOf, keyOf, keysetAfter, instantOf, olderThan, type Keyed } from '../../lib/keyset.ts';
import type {
    AdminRewardConfig,
    AdminRewardDayEntries,
    AdminRewardDays,
    AdminRewardFreeze,
    AdminRewardFrozen,
    AdminRewardOverview
} from '../../schemas.ts';
import { lookOf } from '../shop/catalogue.ts';
import {
    REWARD_CAP,
    REWARD_CYCLE_DAYS,
    REWARD_DAY_MS,
    REWARD_EPOCH_MS,
    amountsOf,
    budgetNuraOf,
    budgetOf,
    budgetOpen,
    configText,
    cycleOf,
    mostPerCycle,
    nuraOf,
    rewardConfigOf,
    rewardDayOf,
    type RewardAmounts,
    type RewardConfig
} from '../reward/rules.ts';
import { record, staffRefusal, type Actor } from './staff.ts';

const CONFIG_KEY = 'reward-config';

const BUDGET_KEY = 'reward-budget';

type RewardSettingKey = typeof CONFIG_KEY | typeof BUDGET_KEY;

/** Which part of rewards a `reward-config` staff action changed. */
type ConfigPart = 'switch' | 'amounts' | 'looks' | 'budget';

const looksText = (config: RewardConfig) => JSON.stringify({ pool: config.pool, exclusive: config.exclusive });

const amountsText = (amounts: RewardAmounts) => JSON.stringify(amounts);

export const REWARD_DAY_PAGE = 50;

export const REWARD_FROZEN_PAGE = 50;

export const REWARD_TOP_EARNERS = 20;

export const REWARD_QUEUE_ROWS = 100;

/** How long a failed payout stays at the head of the queue; the player can withdraw again at once, so older ones are history. */
const FAILED_SHOWN_DAYS = 30;

/** When reward day `day` begins, in milliseconds since the epoch. */
export const dayStartOf = (day: number) => REWARD_EPOCH_MS + (day - 1) * REWARD_DAY_MS;

/** The first and last absolute reward days of a cycle. */
export const cycleSpan = (cycle: number) => ({ first: cycle * REWARD_CYCLE_DAYS + 1, last: (cycle + 1) * REWARD_CYCLE_DAYS });

/** `rewardDayOf` in SQL, for rows that carry only when they were written. */
export const daySql = (column: string) => `(floor((extract(epoch from ${ column }) * 1000 - ${ REWARD_EPOCH_MS }) / ${ REWARD_DAY_MS })::int + 1)`;

/**
 * Grants of the absolute days `$1`..`$2`, by the day each was granted on; a row written before the
 * day was kept is found by its cycle (`$3`) and placed on the day it was written, which is the day
 * it was granted. Both arms read `reward_grants_day_idx` (a btree finds nulls too).
 */
const GRANTS_OF_DAYS = `(g.day between $1 and $2 or (g.day is null and g.cycle = $3))`;

const GRANT_DAY = `coalesce(g.day, ${ daySql('g.created_at') })`;

/**
 * One statement for a cycle's log: the ledger summed by day and source, and the payouts asked for
 * on each day that mined. A payout belongs to the day it was asked for, so the day it lists under is
 * the day its mined NURA is counted on.
 */
const DAYS_SQL = `
    with granted as (
        select ${ GRANT_DAY } as day,
            coalesce(sum(g.amount) filter (where g.source = 'checkin'), 0)::text as checkin,
            coalesce(sum(g.amount) filter (where g.source = 'bonus'), 0)::text as bonus,
            coalesce(sum(g.amount) filter (where g.source = 'daily'), 0)::text as daily,
            coalesce(sum(g.amount) filter (where g.source = 'weekly'), 0)::text as weekly,
            coalesce(sum(g.amount) filter (where g.source = 'chest'), 0)::text as chest,
            coalesce(sum(g.amount), 0)::text as total,
            (count(*) filter (where g.item_id is not null and g.delivered))::int as skins,
            count(distinct g.user_id)::int as players
        from reward_grants g
        where ${ GRANTS_OF_DAYS }
        group by 1
    ), paid as (
        select ${ daySql('p.created_at') } as day, sum(p.amount)::text as paid
        from reward_payouts p
        where p.state = 'mined' and p.created_at >= $4 and p.created_at < $5
        group by 1
    )
    select coalesce(granted.day, paid.day) as day,
        coalesce(granted.checkin, '0') as checkin,
        coalesce(granted.bonus, '0') as bonus,
        coalesce(granted.daily, '0') as daily,
        coalesce(granted.weekly, '0') as weekly,
        coalesce(granted.chest, '0') as chest,
        coalesce(granted.total, '0') as total,
        coalesce(granted.skins, 0) as skins,
        coalesce(granted.players, 0) as players,
        coalesce(paid.paid, '0') as paid
    from granted
    full join paid on paid.day = granted.day
`;

const FACE_COLUMNS = `u.handle as handle, u.display_name as display_name, u.hue as hue, u.avatar as avatar`;

/** A day's grants and the payouts asked for on it, newest first, a page at a time by keyset over (when, id). */
const ENTRIES_SQL = `
    select e.*, ${ FACE_COLUMNS }
    from (
        select 'grant' as kind, g.id, g.user_id, g.created_at as at, ${ keyOf('g.created_at') } as at_key,
            g.source, g.source_key, g.amount::text as amount, g.wanted::text as wanted, g.item_id, g.delivered,
            null::text as state, null::text as tx_hash, null::int as attempts
        from reward_grants g
        where g.day = $1 or (g.day is null and g.cycle = $2 and g.created_at >= $3 and g.created_at < $4)
        union all
        select 'payout', p.id, p.user_id, p.created_at, ${ keyOf('p.created_at') },
            null, null, p.amount::text, null, null, null,
            p.state, p.tx_hash, p.attempts
        from reward_payouts p
        where p.created_at >= $3 and p.created_at < $4
    ) e
    join users u on u.id = e.user_id
    where $5::text is null or (e.at, e.id) < (${ instantOf('$5') }, cast($6 as uuid))
    order by e.at desc, e.id desc
    limit ${ REWARD_DAY_PAGE + 1 }
`;

/** The cycle's earners by what they were granted, with whether they are frozen. */
const TOP_SQL = `
    select g.user_id, sum(g.amount)::text as earned, ${ FACE_COLUMNS },
        exists (select 1 from reward_freezes f where f.user_id = g.user_id) as frozen
    from reward_grants g
    join users u on u.id = g.user_id
    where ${ GRANTS_OF_DAYS }
    group by g.user_id, u.handle, u.display_name, u.hue, u.avatar
    having sum(g.amount) > 0
    order by sum(g.amount) desc, g.user_id
    limit ${ REWARD_TOP_EARNERS }
`;

/** The payouts still to settle and the recent failures, failed first (newest), then oldest first so the head of the line leads. */
const QUEUE_SQL = `
    select p.id, p.wallet_address, p.amount::text as amount, p.state, p.tx_hash, p.attempts,
        coalesce(p.failed_at, p.sent_at, p.queued_at, p.created_at) as at, ${ FACE_COLUMNS }
    from reward_payouts p
    join users u on u.id = p.user_id
    where p.state in ('queued', 'sent') or (p.state = 'failed' and p.failed_at > now() - interval '${ FAILED_SHOWN_DAYS } days')
    order by (p.state = 'failed') desc, p.failed_at desc nulls last, p.created_at asc, p.id
    limit ${ REWARD_QUEUE_ROWS }
`;

const QUEUE_TOTALS_SQL = `
    select (count(*) filter (where state = 'queued'))::int as queued,
        (count(*) filter (where state = 'sent'))::int as sent,
        coalesce(sum(amount), 0)::text as owed
    from reward_payouts
    where state in ('queued', 'sent')
`;

interface Faced
{
    handle: string;
    display_name: string;
    hue: number;
    avatar: string | null;
}

export interface DayRow
{
    day: number;
    checkin: string;
    bonus: string;
    daily: string;
    weekly: string;
    chest: string;
    total: string;
    skins: number;
    players: number;
    paid: string;
}

type EntryRow = Faced & {
    kind: 'grant' | 'payout';
    id: string;
    at: Date;
    at_key: string;
    source: 'checkin' | 'bonus' | 'daily' | 'weekly' | 'chest' | null;
    source_key: string | null;
    amount: string;
    wanted: string | null;
    item_id: string | null;
    delivered: boolean | null;
    state: 'queued' | 'sent' | 'mined' | 'failed' | null;
    tx_hash: string | null;
    attempts: number | null;
};

const faceOf = (row: Faced) => ({
    handle: row.handle,
    displayName: row.display_name,
    hue: row.hue,
    ...(row.avatar === null ? {} : { avatar: row.avatar })
});

/** The quest a daily or weekly grant paid, from its key (`<period key>:<quest id>`); other sources have none. */
export const questOf = (source: string, sourceKey: string | null) =>
{
    if ((source !== 'daily' && source !== 'weekly') || sourceKey === null)
    {
        return undefined;
    }

    const quest = sourceKey.slice(sourceKey.lastIndexOf(':') + 1);

    return quest === '' ? undefined : quest;
};

/**
 * A cycle's log from its summed rows, newest day first: every day of the cycle up to `today` (all
 * of a cycle that is over), a day with nothing in it as zeros, each with the cycle's grants through
 * its end and what the budget had opened by then. Each figure is its own sum floored to whole NURA,
 * so a day's total is the ledger's for that day even when a clipped grant left a fraction.
 */
export const dailyLog = (rows: readonly DayRow[], cycle: number, budget: bigint, today: number): AdminRewardDays =>
{
    const { first, last } = cycleSpan(cycle);
    const through = Math.min(last, today);
    const byDay = new Map(rows.map((row) => [row.day, row]));
    const days: AdminRewardDays['days'] = [];
    let used = 0n;

    for (let day = first; day <= through; day++)
    {
        const row = byDay.get(day);
        const cycleDay = day - first + 1;

        used += BigInt(row?.total ?? '0');
        days.push({
            day,
            cycleDay,
            granted: {
                checkin: nuraOf(row?.checkin ?? '0'),
                bonus: nuraOf(row?.bonus ?? '0'),
                daily: nuraOf(row?.daily ?? '0'),
                weekly: nuraOf(row?.weekly ?? '0'),
                chest: nuraOf(row?.chest ?? '0')
            },
            total: nuraOf(row?.total ?? '0'),
            skins: row?.skins ?? 0,
            players: row?.players ?? 0,
            paidOut: nuraOf(row?.paid ?? '0'),
            used: nuraOf(used),
            open: nuraOf(budgetOpen(budget, cycleDay))
        });
    }

    return { cycle, budget: nuraOf(budget), days: days.reverse() };
};

/** One line of a day as the staff read it, in whole NURA. */
export const entryOf = (row: EntryRow): AdminRewardDayEntries['rows'][number] =>
{
    if (row.kind === 'payout')
    {
        return {
            kind: 'payout',
            id: row.id,
            person: faceOf(row),
            amount: nuraOf(row.amount),
            state: row.state ?? 'queued',
            ...(row.tx_hash === null ? {} : { hash: row.tx_hash }),
            attempts: row.attempts ?? 0,
            at: row.at.toISOString()
        };
    }

    const source = row.source ?? 'checkin';
    const quest = questOf(source, row.source_key);

    return {
        kind: 'grant',
        id: row.id,
        person: faceOf(row),
        source,
        ...(quest === undefined ? {} : { quest }),
        amount: nuraOf(row.amount),
        wanted: nuraOf(row.wanted ?? '0'),
        ...(row.item_id === null ? {} : { item: row.item_id }),
        ...(row.delivered === null ? {} : { delivered: row.delivered }),
        at: row.at.toISOString()
    };
};

/**
 * The staff's side of rewards. Reading (`rewards`): the config, the daily log and its days, the
 * budget, the wallet, the payout queue, the top earners and the frozen players. Writing: the
 * switch, the amounts, the looks and the budget (the owner's, through `wallet`), and freezing one
 * player (`rewards`). Each change is its staff action, written in the transaction that makes it,
 * with the setting's row locked so two edits at once neither lose one another nor log a "before"
 * that was not.
 */
export function createRewardAdmin(db: DataSource, wallet: RewardWallet)
{
    const budgetNow = async () => budgetOf((await db.getRepository(Setting).findOneBy({ key: BUDGET_KEY }))?.value ?? null);

    /** The setting's text, with its row locked; written first when it is not there, as what reading nothing already means. */
    const locked = async (tx: EntityManager, key: RewardSettingKey, absent: string) =>
    {
        await tx.getRepository(Setting).createQueryBuilder()
            .insert()
            .values({ key, value: absent, staffId: null })
            .orIgnore()
            .execute();

        const row = await tx.getRepository(Setting).createQueryBuilder('s')
            .setLock('pessimistic_write')
            .where('s.key = :key', { key })
            .getOneOrFail();

        return row.value;
    };

    const view = async (from: EntityManager): Promise<AdminRewardConfig> =>
    {
        const settings = await from.getRepository(Setting).find({ where: { key: In([CONFIG_KEY, BUDGET_KEY]) } });
        const config = rewardConfigOf(settings.find((one) => one.key === CONFIG_KEY)?.value ?? null);

        return {
            on: config.on,
            amounts: { ...config.amounts, ladder: [...config.amounts.ladder] },
            mostPerCycle: mostPerCycle(config.amounts),
            cap: REWARD_CAP,
            pool: config.pool,
            ...(config.exclusive === null ? {} : { exclusive: config.exclusive }),
            budget: budgetNuraOf(settings.find((one) => one.key === BUDGET_KEY)?.value ?? null)
        };
    };

    /** One change to the config: nothing is written, and nothing logged, when it changes nothing. */
    const change = async (actor: Actor, part: ConfigPart, reason: string, next: (config: RewardConfig) => RewardConfig, said: (config: RewardConfig) => string) =>
        await db.transaction(async (tx) =>
        {
            const before = rewardConfigOf(await locked(tx, CONFIG_KEY, configText(rewardConfigOf(null))));
            const after = next(before);

            if (configText(after) !== configText(before))
            {
                await tx.getRepository(Setting).update({ key: CONFIG_KEY }, { value: configText(after), staffId: actor.id });
                await record(tx, actor, { kind: 'reward-config', reason, details: { part, from: said(before), to: said(after) } });
            }

            return await view(tx);
        });

    return {
        config: () => view(db.manager),

        /** One cycle's daily log, the current one when none is asked for; a cycle not begun yet is null. */
        async days(asked: number | null, now = Date.now()): Promise<AdminRewardDays | null>
        {
            const today = rewardDayOf(now);
            const cycle = asked ?? cycleOf(today).cycle;
            const { first, last } = cycleSpan(cycle);

            if (first > today)
            {
                return null;
            }

            const rows = await db.query(DAYS_SQL, [first, last, cycle, new Date(dayStartOf(first)), new Date(dayStartOf(last + 1))]) as DayRow[];

            return dailyLog(rows, cycle, await budgetNow(), today);
        },

        /** A day's grants and payouts one by one, newest first; a day not begun yet is null. */
        async day(day: number, cursor: string | undefined, now = Date.now()): Promise<AdminRewardDayEntries | null>
        {
            if (!Number.isSafeInteger(day) || day < 1 || day > rewardDayOf(now))
            {
                return null;
            }

            const after = keysetAfter(cursor);
            const rows = await db.query(ENTRIES_SQL, [
                day,
                cycleOf(day).cycle,
                new Date(dayStartOf(day)),
                new Date(dayStartOf(day + 1)),
                after?.micros ?? null,
                after?.id ?? null
            ]) as EntryRow[];

            return { day, rows: rows.slice(0, REWARD_DAY_PAGE).map(entryOf), ...cursorOf(rows, REWARD_DAY_PAGE) };
        },

        /** The budget today, the rewards wallet, the payout queue and the cycle's top earners. */
        async overview(now = Date.now()): Promise<AdminRewardOverview>
        {
            const today = rewardDayOf(now);
            const { cycle, day: cycleDay } = cycleOf(today);
            const { first, last } = cycleSpan(cycle);
            const [budget, total, [todays], top, queue, [totals]] = await Promise.all([
                budgetNow(),
                db.getRepository(RewardCycleTotal).findOneBy({ cycle }),
                db.query('select coalesce(sum(amount), 0)::text as amount from reward_grants where day = $1', [today]) as Promise<[{ amount: string }]>,
                db.query(TOP_SQL, [first, last, cycle]) as Promise<(Faced & { earned: string; frozen: boolean })[]>,
                db.query(QUEUE_SQL) as Promise<(Faced & { id: string; wallet_address: string; amount: string; state: 'queued' | 'sent' | 'mined' | 'failed'; tx_hash: string | null; attempts: number; at: Date })[]>,
                db.query(QUEUE_TOTALS_SQL) as Promise<[{ queued: number; sent: number; owed: string }]>
            ]);

            let balance: number | undefined;

            if (wallet.configured && wallet.address !== null)
            {
                try
                {
                    balance = nuraOf(await wallet.balanceOf(wallet.address));
                }
                catch
                {
                    // The chain being down must not take the page with it; the balance is shown as unknown.
                    balance = undefined;
                }
            }

            return {
                budget: {
                    cycle,
                    cycleDay,
                    day: today,
                    budget: nuraOf(budget),
                    open: nuraOf(budgetOpen(budget, cycleDay)),
                    used: nuraOf(total?.granted ?? '0'),
                    usedToday: nuraOf(todays.amount)
                },
                wallet: {
                    configured: wallet.configured,
                    ...(wallet.address === null ? {} : { address: wallet.address }),
                    ...(wallet.configured ? { chainId: wallet.chainId } : {}),
                    ...(balance === undefined ? {} : { balance })
                },
                queue: {
                    queued: totals.queued,
                    sent: totals.sent,
                    owed: nuraOf(totals.owed),
                    rows: queue.map((row) => ({
                        id: row.id,
                        person: faceOf(row),
                        wallet: row.wallet_address,
                        amount: nuraOf(row.amount),
                        state: row.state,
                        ...(row.tx_hash === null ? {} : { hash: row.tx_hash }),
                        attempts: row.attempts,
                        at: row.at.toISOString()
                    }))
                },
                top: top.map((row) => ({ person: faceOf(row), earned: nuraOf(row.earned), frozen: row.frozen }))
            };
        },

        /** The frozen players, newest freeze first, a page at a time. */
        async frozen(cursor: string | undefined): Promise<AdminRewardFrozen>
        {
            const after = keysetAfter(cursor);
            const query = db.getRepository(RewardFreeze).createQueryBuilder('f')
                .innerJoin(User, 'u', 'u.id = f.user_id')
                .leftJoin(User, 's', 's.id = f.staff_id')
                .select('f.user_id', 'id')
                .addSelect(keyOf('f.created_at'), 'at_key')
                .addSelect('f.reason', 'reason')
                .addSelect('f.created_at', 'created_at')
                .addSelect('u.handle', 'handle')
                .addSelect('u.display_name', 'display_name')
                .addSelect('u.hue', 'hue')
                .addSelect('u.avatar', 'avatar')
                .addSelect('s.handle', 'staff_handle');

            if (after !== null)
            {
                query.andWhere(olderThan('f.created_at', 'f.user_id'), after);
            }

            const rows = await query
                .orderBy('f.created_at', 'DESC')
                .addOrderBy('f.user_id', 'DESC')
                .limit(REWARD_FROZEN_PAGE + 1)
                .getRawMany<Keyed & Faced & { reason: string; created_at: Date; staff_handle: string | null }>();

            return {
                rows: rows.slice(0, REWARD_FROZEN_PAGE).map((row) => ({
                    person: faceOf(row),
                    reason: row.reason,
                    ...(row.staff_handle === null ? {} : { by: row.staff_handle }),
                    at: row.created_at.toISOString()
                })),
                ...cursorOf(rows, REWARD_FROZEN_PAGE)
            };
        },

        switchTo: (actor: Actor, on: boolean, reason: string) =>
            change(actor, 'switch', reason, (config) => ({ ...config, on }), (config) => (config.on ? 'on' : 'off')),

        async setAmounts(actor: Actor, said: RewardAmounts, reason: string)
        {
            const amounts = amountsOf(said);

            if (amounts === null)
            {
                throw staffRefusal('staff-reward-amounts', `Those amounts pay one player more than ${ REWARD_CAP } NURA a cycle.`);
            }

            return await change(actor, 'amounts', reason, (config) => ({ ...config, amounts }), (config) => amountsText(config.amounts));
        },

        async setLooks(actor: Actor, pool: readonly string[], exclusive: string | null, reason: string)
        {
            const wanted = [...new Set([...pool, ...(exclusive === null ? [] : [exclusive])])];
            const known = wanted.length === 0
                ? new Set<string>()
                : new Set((await db.getRepository(ShopItem).find({ select: { id: true }, where: { id: In(wanted) } })).map((item) => item.id));

            // A bundle is never owned, so a reward could never give it.
            if (wanted.some((id) => lookOf(id) === undefined || !known.has(id)))
            {
                throw staffRefusal('staff-campaign-look', 'The shop sells no such look.');
            }

            return await change(actor, 'looks', reason, (config) => ({ ...config, pool: [...new Set(pool)], exclusive }), looksText);
        },

        async setBudget(actor: Actor, budget: number, reason: string)
        {
            return await db.transaction(async (tx) =>
            {
                const before = budgetNuraOf(await locked(tx, BUDGET_KEY, String(budgetNuraOf(null))));

                if (before !== budget)
                {
                    await tx.getRepository(Setting).update({ key: BUDGET_KEY }, { value: String(budget), staffId: actor.id });
                    await record(tx, actor, { kind: 'reward-config', reason, details: { part: 'budget', from: String(before), to: String(budget) } });
                }

                return await view(tx);
            });
        },

        async freezeState(userId: string, handle: string): Promise<AdminRewardFreeze>
        {
            const held = await db.getRepository(RewardFreeze).findOneBy({ userId });

            return held === null
                ? { handle, frozen: false }
                : { handle, frozen: true, reason: held.reason, at: held.createdAt.toISOString() };
        },

        /** Freezes or thaws one player's rewards; nothing is written, and nothing logged, when they already are so. */
        async freeze(actor: Actor, person: { id: string; handle: string }, frozen: boolean, reason: string)
        {
            return await db.transaction(async (tx) =>
            {
                // The lock every claim takes first: a claim under way finishes before the freeze lands.
                await tx.getRepository(User).createQueryBuilder('u').setLock('for_no_key_update').where('u.id = :id', { id: person.id }).getOne();

                const changed = frozen
                    ? ((await tx.getRepository(RewardFreeze).createQueryBuilder()
                        .insert()
                        .values({ userId: person.id, reason, staffId: actor.id })
                        .orIgnore()
                        .returning(['userId'])
                        .execute()).raw as unknown[]).length > 0
                    : ((await tx.getRepository(RewardFreeze).delete({ userId: person.id })).affected ?? 0) > 0;

                if (changed)
                {
                    await record(tx, actor, { kind: 'reward-freeze', person, reason, details: { to: frozen ? 'frozen' : 'thawed' } });
                }

                return changed;
            });
        }
    };
}
