import { createResource, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import type { RewardAmounts } from '../../../backend/src/domains/reward/rules.ts';
import type { AdminRewardConfig, AdminRewardDayEntries, AdminRewardDays, AdminRewardFreeze, AdminRewardFrozen, AdminRewardOverview } from '../../../backend/src/schemas.ts';
import { client } from '../api.ts';
import { useAccount } from './account.store.ts';

export type AdminRewardEntry = AdminRewardDayEntries['rows'][number];

export type AdminFrozenRow = AdminRewardFrozen['rows'][number];

export type AdminRewardView = 'config' | 'overview' | 'days' | 'frozen';

export interface Page<Row>
{
    rows: Row[];
    cursor?: string;
}

/** A keyset list read a page at a time: the first page follows its key, and older pages belong to the first page they continued. */
export interface Paged<Row>
{
    rows: Getter<Row[]>;
    loading: Getter<boolean>;
    failed: Getter<boolean>;
    error: Getter<unknown>;
    more: Getter<boolean>;
    older(): Promise<void>;
    refetch(): Promise<void>;
}

export function paged<Key, Row>(key: () => Key | null, read: (key: Key, cursor?: string) => Promise<Page<Row>>, name: string): Paged<Row>
{
    const first = createResource(key, (asked) => read(asked), { name });

    const [tail, setTail] = createSignal<{ from: Page<Row>; rows: Row[]; cursor?: string } | null>(null);

    const continued = () =>
    {
        const held = tail();

        return held !== null && held.from === first.data() ? held : null;
    };

    const cursor = () =>
    {
        const held = continued();

        return held === null ? first.data()?.cursor : held.cursor;
    };

    let paging = false;

    return {
        rows: () => [...(first.data()?.rows ?? []), ...(continued()?.rows ?? [])],
        loading: () => first.loading(),
        failed: () => first.error() !== null && first.data() === undefined,
        error: () => first.error(),
        more: () => cursor() !== undefined,

        async older()
        {
            const from = untrack(first.data);
            const after = untrack(cursor);
            const asked = untrack(key);

            if (from === undefined || after === undefined || asked === null || paging)
            {
                return;
            }

            paging = true;

            try
            {
                const next = await read(asked, after);

                // A page that answers after the list was read again belongs to a list no longer shown.
                if (untrack(first.data) === from)
                {
                    setTail({ from, rows: [...(untrack(continued)?.rows ?? []), ...next.rows], ...(next.cursor === undefined ? {} : { cursor: next.cursor }) });
                }
            }
            finally
            {
                paging = false;
            }
        },

        async refetch()
        {
            setTail(null);
            await first.refetch();
        }
    };
}

export interface AdminRewardsApi
{
    want(view: AdminRewardView): void;
    config: Getter<AdminRewardConfig | null>;
    configFailed: Getter<boolean>;
    configError: Getter<unknown>;
    overview: Getter<AdminRewardOverview | null>;
    overviewFailed: Getter<boolean>;
    overviewError: Getter<unknown>;
    days: Getter<AdminRewardDays | null>;
    daysFailed: Getter<boolean>;
    daysError: Getter<unknown>;

    /** The cycle whose log is asked for; null is the current one. */
    cycle: Getter<number | null>;
    showCycle(cycle: number | null): void;

    /** The reward day opened in the log, or null. */
    opened: Getter<number | null>;
    open(day: number | null): void;
    entries: Paged<AdminRewardEntry>;
    frozen: Paged<AdminFrozenRow>;
    switchTo(on: boolean, reason: string): Promise<AdminRewardConfig>;
    setAmounts(amounts: RewardAmounts, reason: string): Promise<AdminRewardConfig>;
    setLooks(pool: readonly string[], exclusive: string | null, reason: string): Promise<AdminRewardConfig>;
    setBudget(budget: number, reason: string): Promise<AdminRewardConfig>;
    freeze(handle: string, frozen: boolean, reason: string): Promise<AdminRewardFreeze>;
    refresh(): Promise<void>;
    reset(): void;
}

export const useAdminRewards = createStore((): AdminRewardsApi =>
{
    const account = useAccount();

    const reader = () => account.user()?.id ?? null;

    const [wanted, setWanted] = createSignal<readonly AdminRewardView[]>([]);

    const [cycle, setCycle] = createSignal<number | null>(null);

    const [opened, setOpened] = createSignal<number | null>(null);

    const wants = (view: AdminRewardView) => () => (wanted().includes(view) ? reader() : null);

    const config = createResource(wants('config'), () => client.admin.rewardConfig(), { name: 'admin.rewards.config' });

    const overview = createResource(wants('overview'), () => client.admin.rewardOverview(), { name: 'admin.rewards.overview' });

    const days = createResource(
        () => (wanted().includes('days') && reader() !== null ? { cycle: cycle() } : null),
        (asked) => client.admin.rewardDays({ query: asked.cycle === null ? {} : { cycle: String(asked.cycle) } }),
        { name: 'admin.rewards.days' }
    );

    const entries = paged(
        () => (reader() === null ? null : opened()),
        (day, cursor) => client.admin.rewardDay({ params: { day: String(day) }, query: cursor === undefined ? {} : { cursor } }),
        'admin.rewards.day'
    );

    const frozen = paged(
        () => (wanted().includes('frozen') ? reader() : null),
        (_, cursor) => client.admin.rewardFrozen({ query: cursor === undefined ? {} : { cursor } }),
        'admin.rewards.frozen'
    );

    /** A config write answers with the config; the overview's budget and the log's budget follow it, so they are read again. */
    const configured = async (write: Promise<AdminRewardConfig>) =>
    {
        const answer = await write;

        await Promise.all([config.refetch(), overview.refetch(), days.refetch()]);

        return answer;
    };

    return {
        want(view)
        {
            setWanted((now) => (now.includes(view) ? now : [...now, view]));
        },

        config: () => config.data() ?? null,
        configFailed: () => config.error() !== null && config.data() === undefined,
        configError: () => config.error(),
        overview: () => overview.data() ?? null,
        overviewFailed: () => overview.error() !== null && overview.data() === undefined,
        overviewError: () => overview.error(),
        days: () => days.data() ?? null,
        daysFailed: () => days.error() !== null && days.data() === undefined,
        daysError: () => days.error(),
        cycle,

        showCycle(next)
        {
            setOpened(null);
            setCycle(next);
        },

        opened,

        open(day)
        {
            setOpened((now) => (now === day ? null : day));
        },

        entries,
        frozen,

        switchTo: (on, reason) => configured(client.admin.switchRewards({ input: { on, reason } })),

        setAmounts: (amounts, reason) => configured(client.admin.setRewardAmounts({ input: { amounts: { ...amounts, ladder: [...amounts.ladder] }, reason } })),

        setLooks: (pool, exclusive, reason) => configured(client.admin.setRewardLooks({ input: { pool: [...pool], ...(exclusive === null ? {} : { exclusive }), reason } })),

        setBudget: (budget, reason) => configured(client.admin.setRewardBudget({ input: { budget, reason } })),

        async freeze(handle, to, reason)
        {
            const answer = await client.admin.freezeRewards({ params: { handle }, input: { frozen: to, reason } });

            await Promise.all([frozen.refetch(), overview.refetch()]);

            return answer;
        },

        async refresh()
        {
            const now = untrack(wanted);

            await Promise.all([
                now.includes('config') ? config.refetch() : undefined,
                now.includes('overview') ? overview.refetch() : undefined,
                now.includes('days') ? days.refetch() : undefined,
                now.includes('frozen') ? frozen.refetch() : undefined,
                untrack(opened) === null ? undefined : entries.refetch()
            ]);
        },

        reset()
        {
            setWanted([]);
            setCycle(null);
            setOpened(null);
        }
    };
});
