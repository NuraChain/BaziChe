import { createResource, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import type { RewardWithdraw } from '../../../backend/src/schemas.ts';
import { ApiError, client, type RewardActivity, type RewardHistoryPage, type RewardState } from '../api.ts';
import { newestRead } from '../lib/newest-read.ts';
import { useAccount } from './account.store.ts';
import { useRealtime } from './realtime.store.ts';
import { useSession } from './session.store.ts';

export type RewardQuest = RewardState['daily'][number];

export type RewardHistoryItem = RewardHistoryPage['items'][number];

export type RewardPeriod = 'daily' | 'weekly';

/** What the reader pressed and is waiting on; one at a time. */
export type RewardAction = 'check-in' | 'claim-all' | 'withdraw' | `quest:${ RewardPeriod }:${ string }`;

/** Why the last press paid less or nothing, and where on the page to say it. */
export interface RewardSaid
{
    on: 'check-in' | 'quests' | 'withdraw';

    /** The server's refusal code, a withdrawal's own outcome (`withdraw-least`, `withdraw-queued`), or null when the press failed for a reason it did not name. */
    reason: string | null;

    /** The NURA a queued withdrawal moves. */
    amount?: number;
}

/** What a withdrawal's answer says to the reader: too little to withdraw, or a payout on its way, new or already under way. */
export function withdrawSaid(answer: RewardWithdraw): Omit<RewardSaid, 'on'> | null
{
    if (answer.status === 'none')
    {
        return { reason: 'withdraw-least' };
    }

    return answer.status === 'queued' ? { reason: 'withdraw-queued', amount: answer.amount } : null;
}

/** What the navigation's dot counts: today's check-in while it is open, and every quest done and not yet claimed. */
export function claimableCount(state: RewardState | null)
{
    if (state === null)
    {
        return 0;
    }

    return (state.claimable ? 1 : 0) + [...state.daily, ...state.weekly].filter((quest) => quest.done && !quest.claimed).length;
}

/** The answer a read gets once the owner has switched rewards off since the session was read. */
const isOff = (error: unknown) => error instanceof ApiError && error.code === 'reward-off';

export interface RewardsApi
{
    /** Whether rewards are switched on here: the session says so, and no read has since been told they are off. */
    open: Getter<boolean>;

    /** Whether the navigation draws a door to the page: rewards are on, or are off and earned NURA is left to withdraw. */
    door: Getter<boolean>;

    /** The whole NURA left to withdraw: from the state while rewards are on, from the balance alone while they are off. */
    withdrawable: Getter<number>;

    /** What can be claimed now, for the navigation's dot. */
    ready: Getter<number>;
    state: Getter<RewardState | null>;
    loading: Getter<boolean>;
    failed: Getter<boolean>;
    error: Getter<unknown>;

    /** Whether today's check-in is still to be made. */
    claimable: Getter<boolean>;
    dailyQuests: Getter<RewardQuest[]>;
    weeklyQuests: Getter<RewardQuest[]>;
    busy: Getter<RewardAction | null>;
    said: Getter<RewardSaid | null>;
    history: Getter<RewardHistoryItem[]>;
    historyLoading: Getter<boolean>;
    historyFailed: Getter<boolean>;
    historyError: Getter<unknown>;
    hasOlder: Getter<boolean>;
    older(): Promise<void>;
    activity: Getter<RewardActivity | null>;
    want(what: 'state' | 'history' | 'activity'): void;
    checkIn(): Promise<void>;
    claimQuest(period: RewardPeriod, id: string): Promise<void>;
    claimAll(): Promise<void>;
    withdraw(): Promise<void>;
    refresh(): Promise<void>;
    listen(): () => void;

    /** Reads the state once the app opens, so the navigation's dot is right before the page is visited. */
    start(): () => void;
    reset(): void;
}

/** The refusals a claim answers with that only say the page was behind: reading it again is the whole answer. */
const STALE = new Set(['not-ready', 'reward-claimed']);

export const useRewards = createStore((): RewardsApi =>
{
    const account = useAccount();
    const session = useSession();

    const reader = () => account.user()?.id ?? null;

    const switchedOn = () => session.account()?.rewards === true;

    const [wanted, setWanted] = createSignal<readonly string[]>([]);

    const [started, setStarted] = createSignal(false);

    const wants = (what: string) => () => ((wanted().includes(what) || (what === 'state' && started())) && switchedOn() ? reader() : null);

    const state = createResource(wants('state'), () => client.rewards.state(), { name: 'rewards.state' });

    const readState = newestRead(state);

    const off = () => !switchedOn() || isOff(state.error());

    /** While rewards are off the state is refused, and the balance is what is left to withdraw. */
    const balance = createResource(
        () => ((wanted().includes('state') || started()) && off() ? reader() : null),
        () => client.rewards.balance(),
        { name: 'rewards.balance' }
    );

    const readBalance = newestRead(balance);

    const firstHistory = createResource(wants('history'), () => client.rewards.history({ query: {} }), { name: 'rewards.history' });

    const activity = createResource(wants('activity'), () => client.rewards.activity(), { name: 'rewards.activity' });

    const [olderPages, setOlderPages] = createSignal<readonly RewardHistoryItem[]>([]);

    /** Where the next older page starts: the first page's own cursor until an older page has been read. */
    const [olderCursor, setOlderCursor] = createSignal<string | null | undefined>(undefined);

    const [busy, setBusy] = createSignal<RewardAction | null>(null);

    const [said, setSaid] = createSignal<RewardSaid | null>(null);

    let holds = 0;

    let unring: (() => void) | null = null;

    const nextCursor = () =>
    {
        const after = olderCursor();

        if (after !== undefined)
        {
            return after;
        }

        const first = firstHistory.data();

        return first?.hasMore === true ? first.cursor ?? null : null;
    };

    const cursorAfter = (page: RewardHistoryPage) => (page.hasMore ? page.cursor ?? null : null);

    /** Everything the page holds, read again: a press or the server's ring changed some of it. */
    const mine = async () =>
    {
        const now = untrack(wanted);
        const reads: Promise<void>[] = [];

        // The app's start reads the state for the navigation's dot, so a ring reads it again even before the page is opened.
        if (now.includes('state') || untrack(started))
        {
            // In turn: the state's answer says whether they are off, and each read is nothing while its source is.
            reads.push(readState().then(readBalance));
        }

        if (now.includes('history'))
        {
            setOlderPages([]);
            setOlderCursor(undefined);
            reads.push(firstHistory.refetch());
        }

        if (now.includes('activity'))
        {
            reads.push(activity.refetch());
        }

        await Promise.all(reads);
    };

    const press = async (action: RewardAction, on: RewardSaid['on'], run: () => Promise<string | Omit<RewardSaid, 'on'> | null | undefined>) =>
    {
        if (untrack(busy) !== null)
        {
            return;
        }

        setBusy(action);
        setSaid(null);

        try
        {
            const told = await run();
            const said = typeof told === 'string' ? { reason: told } : told;

            if (said !== undefined && said !== null && !STALE.has(said.reason ?? ''))
            {
                setSaid({ on, ...said });
            }
        }
        catch (error)
        {
            setSaid({ on, reason: error instanceof ApiError && error.code !== undefined ? error.code : null });
        }
        finally
        {
            await mine();
            setBusy(null);
        }
    };

    const quiet = () =>
    {
        unring?.();
        unring = null;
        holds = 0;
    };

    const rewards: RewardsApi = {
        open: () => !off(),
        door: () => !off() || (balance.data()?.withdrawable ?? 0) > 0,
        withdrawable: () => (off() ? balance.data()?.withdrawable : state.data()?.withdrawable) ?? 0,
        ready: () => (switchedOn() ? claimableCount(state.data() ?? null) : 0),
        state: () => state.data() ?? null,
        loading: () => state.loading(),
        failed: () => state.error() !== null,
        error: () => state.error(),
        claimable: () => state.data()?.claimable ?? false,
        dailyQuests: () => state.data()?.daily ?? [],
        weeklyQuests: () => state.data()?.weekly ?? [],
        busy,
        said,
        history: () => [...(firstHistory.data()?.items ?? []), ...olderPages()],
        historyLoading: () => firstHistory.loading(),
        historyFailed: () => firstHistory.error() !== null,
        historyError: () => firstHistory.error(),
        hasOlder: () => nextCursor() !== null,

        async older()
        {
            const cursor = untrack(nextCursor);

            if (cursor === null)
            {
                return;
            }

            const page = await client.rewards.history({ query: { cursor } });

            setOlderPages((now) => [...now, ...page.items]);
            setOlderCursor(cursorAfter(page));
        },

        activity: () => activity.data() ?? null,

        want(what)
        {
            setWanted((now) => (now.includes(what) ? now : [...now, what]));
        },

        checkIn: () => press('check-in', 'check-in', async () => (await client.rewards.checkIn()).reason),

        claimQuest: (period, id) => press(`quest:${ period }:${ id }`, 'quests', async () => (await client.rewards.claimQuest({ params: { period, id } })).reason),

        // Every row of one claim meets the same cap, budget and rule 7, so the first reason given is the one to say.
        claimAll: () => press('claim-all', 'quests', async () => (await client.rewards.claimAll()).claimed.find((one) => one.reason !== undefined)?.reason),

        withdraw: () => press('withdraw', 'withdraw', async () => withdrawSaid(await client.rewards.withdraw())),

        refresh: mine,

        listen()
        {
            holds += 1;

            if (unring === null && untrack(() => state.data()) !== undefined && !untrack(() => state.loading()))
            {
                void mine();
            }

            unring ??= useRealtime().onNudge((scope, id) =>
            {
                if (scope === 'me' && (id === undefined || id === 'rewards') && untrack(reader) !== null)
                {
                    void mine();
                }
            });

            let holding = true;

            return () =>
            {
                if (!holding)
                {
                    return;
                }

                holding = false;
                holds -= 1;

                if (holds === 0)
                {
                    quiet();
                }
            };
        },

        start()
        {
            setStarted(true);

            const stop = rewards.listen();

            return () =>
            {
                stop();
                setStarted(false);
            };
        },

        reset()
        {
            quiet();
            setStarted(false);
            setBusy(null);
            setSaid(null);
            setOlderPages([]);
            setOlderCursor(undefined);
            setWanted([]);
        }
    };

    return rewards;
});
