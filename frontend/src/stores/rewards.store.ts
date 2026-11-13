import { createSignal, createStore, type Getter } from 'azerothjs';

import { client, type RewardHistoryPage, type RewardState } from '../api.ts';

export type LadderStep = {
    day: number;
    amount: number;
    claimed: boolean;
    look?: 'weekly' | 'exclusive';
};

export type QuestView = {
    id: string;
    period: 'daily' | 'weekly';
    game: string;
    title: string;
    blurb: string;
    target: number;
    progress: number;
    done: boolean;
    claimed: boolean;
};

export interface RewardsApi
{
    state: Getter<RewardState | null>;
    loading: Getter<boolean>;
    failed: Getter<boolean>;
    error: Getter<unknown | null>;
    claimable: Getter<boolean>;
    streak: Getter<number>;
    ladder: Getter<LadderStep[]>;
    today: Getter<number>;
    cycleGranted: Getter<number>;
    withdrawable: Getter<number>;
    reason: Getter<string | undefined>;
    dailyQuests: Getter<QuestView[]>;
    weeklyQuests: Getter<QuestView[]>;
    chestClaimed: Getter<boolean>;
    history: Getter<RewardHistoryPage | null>;
    historyLoading: Getter<boolean>;

    checkIn(): Promise<void>;
    claimQuest(period: 'daily' | 'weekly', id: string): Promise<void>;
    withdraw(): Promise<void>;
    refresh(): Promise<void>;
    loadHistory(cursor?: string | null): Promise<void>;
}

export const useRewards = createStore((): RewardsApi =>
{
    const [state, setState] = createSignal<RewardState | null>(null);
    const [error, setError] = createSignal<unknown | null>(null);
    const [history, setHistory] = createSignal<RewardHistoryPage | null>(null);
    const [historyLoading, setHistoryLoading] = createSignal(false);

    const loading = () => historyLoading();
    const failed = () => error() !== null;

    const claimable = () => state()?.claimable ?? false;
    const streak = () => state()?.streak ?? 0;
    const ladder = () =>
    {
        const s = state();
        if (s === null) return [];
        return s.ladder.map((step) => ({
            day: step.day,
            amount: step.amount,
            claimed: step.claimed,
            ...(step.look === undefined ? {} : { look: step.look })
        }));
    };
    const today = () => state()?.today ?? 0;
    const cycleGranted = () => state()?.cycleGranted ?? 0;
    const withdrawable = () => state()?.withdrawable ?? 0;
    const reason = () => state()?.reason;

    const dailyQuests = () =>
    {
        const s = state();
        if (s === null) return [];
        return (s as unknown as { daily?: Array<{ id: string; game: string; target: number; progress: number; done: boolean; claimed: boolean }> }).daily?.map((q) => ({
            id: q.id,
            period: 'daily' as const,
            game: q.game,
            title: '',
            blurb: '',
            target: q.target,
            progress: q.progress,
            done: q.done,
            claimed: q.claimed
        })) ?? [];
    };

    const weeklyQuests = () =>
    {
        const s = state();
        if (s === null) return [];
        return (s as unknown as { weekly?: Array<{ id: string; game: string; target: number; progress: number; done: boolean; claimed: boolean }> }).weekly?.map((q) => ({
            id: q.id,
            period: 'weekly' as const,
            game: q.game,
            title: '',
            blurb: '',
            target: q.target,
            progress: q.progress,
            done: q.done,
            claimed: q.claimed
        })) ?? [];
    };

    const chestClaimed = () =>
    {
        const s = state();
        if (s === null) return false;
        return (s as unknown as { chestClaimed?: boolean }).chestClaimed ?? false;
    };

    const checkIn = async () =>
    {
        setError(null);
        try
        {
            await client.rewards.checkIn();
            const fresh = await client.rewards.state();
            setState(fresh);
            setError(null);
        }
        catch (err)
        {
            setError(err);
        }
    };

    const claimQuest = async (period: 'daily' | 'weekly', id: string) =>
    {
        setError(null);
        try
        {
            await client.rewards.claimQuest({ params: { period, id } });
            const fresh = await client.rewards.state();
            setState(fresh);
            setError(null);
        }
        catch (err)
        {
            setError(err);
        }
    };

    const withdraw = async () =>
    {
        setError(null);
        try
        {
            await client.rewards.withdraw();
            const fresh = await client.rewards.state();
            setState(fresh);
            setError(null);
        }
        catch (err)
        {
            setError(err);
        }
    };

    const refresh = async () =>
    {
        try
        {
            const fresh = await client.rewards.state();
            setState(fresh);
            setError(null);
        }
        catch (err)
        {
            setError(err);
        }
    };

    const loadHistory = async (cursor?: string | null) =>
    {
        setHistoryLoading(true);
        try
        {
            const page = await client.rewards.history({ query: { cursor: cursor ?? undefined } });
            setHistory(page);
        }
        catch
        {
            setHistory(null);
        }
        finally
        {
            setHistoryLoading(false);
        }
    };

    return {
        state: () => state(),
        loading,
        failed,
        error: () => error(),
        claimable,
        streak,
        ladder,
        today,
        cycleGranted,
        withdrawable,
        reason,
        dailyQuests,
        weeklyQuests,
        chestClaimed,
        history: () => history(),
        historyLoading,
        checkIn,
        claimQuest,
        withdraw,
        refresh,
        loadHistory
    };
});
