import { createResource, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import { client, type MarketPositionView, type MarketsState, type MarketView } from '../api.ts';
import { attempt } from '../lib/attempt.ts';
import { createGuesses } from '../lib/guess.ts';
import { heldOf, whyMarket } from '../lib/market.ts';
import { runtime } from '../lib/runtime.ts';
import { REFUSAL_OF, readyToSend, type SendRefusal } from '../lib/wallet-call.ts';
import type { MessageKey } from '../locales/en.ts';
import { useAccount } from './account.store.ts';
import { useRealtime } from './realtime.store.ts';
import { useWallet } from './wallet.store.ts';

/** How often something on its way is asked about while no ring has come. */
export const SETTLE_MS = 3_000;

/** How long past its deadline a position is still waited for: the server's own lapse. */
const LAPSE_MS = 5 * 60_000;

/** How long a claim is waited for once it was sent. */
export const CLAIM_WAIT_MS = 2 * 60_000;

/** Where a market is not offered to the reader at all, so no way to one is drawn. */
const UNOFFERED: ReadonlySet<string> = new Set(['market-region', 'market-minor', 'market-wallet']);

const SEND_COPY: Record<SendRefusal, MessageKey> = {
    rejected: 'market.wallet.rejected',
    'wrong-chain': 'market.wallet.wrongChain',
    unavailable: 'vault.unavailable',
    locked: 'vault.locked',
    asking: 'vault.asking',
    'no-wallet': 'vault.noWallet',
    'wrong-account': 'vault.wrongAccount',
    'wallet-failed': 'vault.walletFailed'
};

export type Step = 'preparing' | 'wallet' | 'chain' | 'done' | 'failed';

export interface Placing
{
    market: string;
    outcome: number;

    /** Wei. */
    amount: string;
    step: Step;
    position: MarketPositionView | null;
    chainId: number | null;
    from: string | null;
    hash: string | null;
    said: MessageKey | null;

    /** What the wallet holds, in wei, when it was short. */
    held: string | null;
}

export interface Claiming
{
    ids: readonly string[];
    step: Step;
    chainId: number | null;
    hash: string | null;
    said: MessageKey | null;

    /** Wei: what the claim paid, read off its receipt by the server. */
    paid: string | null;
}

export interface MarketsApi
{
    state: Getter<MarketsState | null>;
    loading: Getter<boolean>;
    failed: Getter<boolean>;

    /** Whether a way to markets is drawn for the reader at all: open here, and offered to them where they are. */
    offered: Getter<boolean>;

    /** What a market is, read: shown at the press, taken back with the refusal's sentence. */
    disclose(): Promise<boolean>;

    /** Reads the market on a game until the answer is called; the newest game still held is the one read. */
    watch(match: string): () => void;
    view: Getter<MarketView | null>;
    viewLoading: Getter<boolean>;
    viewFailed: Getter<boolean>;
    placing: Getter<Placing | null>;
    place(market: string, outcome: number, amount: string): Promise<void>;
    claiming: Getter<Claiming | null>;
    claim(ids: readonly string[]): Promise<void>;

    /** Lets go of a position or a claim that has ended, so the next sheet opens clean. */
    forget(): void;
    /** The product clock, moved on each second while anybody listens, so every countdown reads one second. */
    now: Getter<number>;
    positions: Getter<MarketPositionView[]>;
    positionsLoading: Getter<boolean>;
    positionsFailed: Getter<boolean>;
    hasOlder: Getter<boolean>;
    older(): Promise<void>;
    wantPositions(): void;
    again(): void;
    listen(): () => void;
    reset(): void;
}

export const useMarkets = createStore((): MarketsApi =>
{
    const account = useAccount();
    const wallet = useWallet();

    const reader = () => account.user()?.id ?? null;

    const [watched, setWatched] = createSignal<string | null>(null);

    const [listed, setListed] = createSignal(false);

    const state = createResource(reader, () => client.markets.state(), { name: 'markets.state' });

    const guesses = createGuesses<MarketsState | null>();

    const shown = () => guesses.over(state.data() ?? null);

    const offered = () =>
    {
        const now = shown();

        return now !== null && now.open && !UNOFFERED.has(now.may);
    };

    const view = createResource(
        () => (reader() === null || !offered() ? null : watched()),
        async (match) => (await client.markets.game({ params: { match } })).market ?? null,
        { name: 'markets.view' }
    );

    const page = createResource(() => (listed() ? reader() : null), () => client.markets.positions({ query: {} }), { name: 'markets.positions' });

    const [olderRows, setOlderRows] = createSignal<readonly MarketPositionView[]>([]);

    const [olderCursor, setOlderCursor] = createSignal<string | null | undefined>(undefined);

    const [placing, setPlacing] = createSignal<Placing | null>(null);

    const [claiming, setClaiming] = createSignal<Claiming | null>(null);

    const [now, setNow] = createSignal(runtime().clock.now());

    let ticking: (() => void) | null = null;

    let age = 0;

    let holds = 0;

    let unring: (() => void) | null = null;

    let placed: Promise<void> | null = null;

    let claimed: Promise<void> | null = null;

    let pokes: (() => void)[] = [];

    let waits: (() => void)[] = [];

    let watchers: string[] = [];

    const nextCursor = () =>
    {
        const after = olderCursor();

        return after === undefined ? page.data()?.cursor ?? null : after;
    };

    const readAgain = async () =>
    {
        await state.refetch();

        const error = state.error();

        if (error !== null)
        {
            throw error;
        }
    };

    const later = (ms: number, run: () => void) =>
    {
        const cancel = runtime().clock.after(ms, () =>
        {
            waits = waits.filter((one) => one !== cancel);
            run();
        });

        waits.push(cancel);

        return cancel;
    };

    const mine = () =>
    {
        void state.refetch().then(() =>
        {
            if (state.error() === null)
            {
                guesses.landed();
            }
        });

        if (untrack(watched) !== null && untrack(offered))
        {
            void view.refetch();
        }

        if (untrack(listed))
        {
            setOlderRows([]);
            setOlderCursor(undefined);
            void page.refetch();
        }

        pokes.forEach((poke) => poke());
    };

    /**
     * Asks `look` again on the product clock and whenever the reader is rung, until it answers
     * something or `until` has passed; resolves with that, or null once given up on or reset.
     */
    const awaited = <T>(look: () => Promise<T | null>, until: number, era: number) =>
        new Promise<T | null>((resolve) =>
        {
            let asking = false;
            let cancel: (() => void) | null = null;

            const done = (value: T | null) =>
            {
                cancel?.();
                pokes = pokes.filter((one) => one !== ask);
                resolve(value);
            };

            const ask = () =>
            {
                if (era !== age)
                {
                    done(null);
                    return;
                }

                if (asking)
                {
                    return;
                }

                asking = true;
                cancel?.();
                cancel = null;

                void look().then((value) => value, () => null).then((value) =>
                {
                    asking = false;

                    if (era !== age)
                    {
                        done(null);
                        return;
                    }

                    if (value !== null)
                    {
                        done(value);
                        return;
                    }

                    if (runtime().clock.now() > until)
                    {
                        done(null);
                        return;
                    }

                    cancel = later(SETTLE_MS, ask);
                });
            };

            pokes.push(ask);
            ask();
        });

    const placeNow = async (market: string, outcome: number, amount: string) =>
    {
        const era = age;

        const set = (patch: Partial<Placing>) =>
        {
            if (era === age)
            {
                setPlacing((now) => (now === null ? null : { ...now, ...patch }));
            }
        };

        setPlacing({ market, outcome, amount, step: 'preparing', position: null, chainId: null, from: null, hash: null, said: null, held: null });

        let paying: Awaited<ReturnType<typeof client.markets.place>>;

        try
        {
            paying = await client.markets.place({ params: { id: market }, input: { outcome, amount } });
        }
        catch (error)
        {
            set({ step: 'failed', said: whyMarket(error), held: heldOf(error) });
            return;
        }

        const { position, call } = paying;

        set({ position, chainId: call.chainId });

        const blocked = await readyToSend(wallet, call.from, call.chainId);

        if (blocked !== null)
        {
            set({ step: 'failed', said: SEND_COPY[blocked] });
            return;
        }

        set({ step: 'wallet', from: wallet.address() });

        const hash = await wallet.send(call.to, call.data, { value: call.value, ...(call.gasPrice === undefined ? {} : { gasPrice: call.gasPrice }) });

        if (hash === null)
        {
            set({ step: 'failed', said: SEND_COPY[REFUSAL_OF[wallet.failure() ?? 'unknown']] });
            return;
        }

        set({ step: 'chain', hash });

        void client.markets.sent({ params: { id: position.id }, input: { hash } }).then(() => pokes.forEach((poke) => poke()), () => undefined);

        const landed = await awaited(async () =>
        {
            const now = await client.markets.one({ params: { id: position.id } });

            return now.state === 'prepared' || now.state === 'sent' ? null : now;
        }, useRealtime().toLocal(Date.parse(position.deadline)) + LAPSE_MS, era);

        if (era !== age || landed === null)
        {
            return;
        }

        mine();

        if (landed.state === 'confirmed')
        {
            set({ step: 'done', position: landed });
            return;
        }

        set({
            step: 'failed',
            position: landed,
            said: landed.state === 'expired' ? 'market.step.lapsed' : landed.state === 'reverted' ? 'market.step.reverted' : 'market.step.nothing'
        });
    };

    const claimNow = async (ids: readonly string[]) =>
    {
        const era = age;

        const set = (patch: Partial<Claiming>) =>
        {
            if (era === age)
            {
                setClaiming((now) => (now === null ? null : { ...now, ...patch }));
            }
        };

        setClaiming({ ids, step: 'preparing', chainId: null, hash: null, said: null, paid: null });

        let call: Awaited<ReturnType<typeof client.markets.claim>>;

        try
        {
            call = await client.markets.claim({ input: { positions: [...ids] } });
        }
        catch (error)
        {
            set({ step: 'failed', said: whyMarket(error) });
            mine();
            return;
        }

        set({ chainId: call.chainId });

        const blocked = await readyToSend(wallet, call.from, call.chainId);

        if (blocked !== null)
        {
            set({ step: 'failed', said: SEND_COPY[blocked] });
            return;
        }

        set({ step: 'wallet' });

        const hash = await wallet.send(call.to, call.data, { value: call.value, ...(call.gasPrice === undefined ? {} : { gasPrice: call.gasPrice }) });

        if (hash === null)
        {
            set({ step: 'failed', said: SEND_COPY[REFUSAL_OF[wallet.failure() ?? 'unknown']] });
            return;
        }

        set({ step: 'chain', hash });

        let told = false;

        const paid = await awaited(async () =>
        {
            if (!told)
            {
                await client.markets.claimSent({ input: { hash, positions: [...ids] } });
                told = true;
            }

            const now = await Promise.all(ids.map((id) => client.markets.one({ params: { id } })));

            return now.some((one) => one.claimedAt === undefined && one.claimHash !== undefined) ? null : now;
        }, runtime().clock.now() + CLAIM_WAIT_MS, era);

        if (era !== age || paid === null)
        {
            return;
        }

        mine();

        if (paid.every((one) => one.claimedAt !== undefined))
        {
            set({ step: 'done', paid: paid.reduce((sum, one) => sum + BigInt(one.paid ?? '0'), 0n).toString() });
            return;
        }

        set({ step: 'failed', said: 'market.claimRefused' });
    };

    return {
        state: shown,
        loading: () => state.loading(),
        failed: () => state.error() !== null,
        offered,

        disclose: () => attempt(
            guesses.during(
                (now) => (now === null || !now.open || now.may !== 'market-disclosure' ? now : { ...now, may: 'yes' }),
                () => client.markets.disclose(),
                readAgain
            ),
            undefined,
            (error) => whyMarket(error)
        ),

        watch(match)
        {
            watchers = [...watchers, match];
            setWatched(match);

            let holding = true;

            return () =>
            {
                if (!holding)
                {
                    return;
                }

                holding = false;

                const at = watchers.lastIndexOf(match);

                watchers = watchers.filter((_, index) => index !== at);
                setWatched(watchers.at(-1) ?? null);
            };
        },

        view: () => view.data() ?? null,
        viewLoading: () => view.loading(),
        viewFailed: () => view.error() !== null && view.data() === undefined,

        placing,

        place(market, outcome, amount)
        {
            placed ??= placeNow(market, outcome, amount).finally(() =>
            {
                placed = null;
            });

            return placed;
        },

        claiming,

        claim(ids)
        {
            claimed ??= claimNow(ids).finally(() =>
            {
                claimed = null;
            });

            return claimed;
        },

        forget()
        {
            const now = untrack(placing);

            if (now !== null && (now.step === 'done' || now.step === 'failed'))
            {
                setPlacing(null);
            }

            const claim = untrack(claiming);

            if (claim !== null && (claim.step === 'done' || claim.step === 'failed'))
            {
                setClaiming(null);
            }
        },

        now,

        positions: () => [...(page.data()?.positions ?? []), ...olderRows()],

        positionsLoading: () => page.loading(),

        positionsFailed: () => page.error() !== null && page.data() === undefined,

        hasOlder: () => nextCursor() !== null,

        async older()
        {
            const cursor = untrack(nextCursor);

            if (cursor === null)
            {
                return;
            }

            const next = await client.markets.positions({ query: { cursor } });

            setOlderRows((now) => [...now, ...next.positions]);
            setOlderCursor(next.cursor ?? null);
        },

        wantPositions()
        {
            setListed(true);
        },

        again()
        {
            void page.refetch();
        },

        listen()
        {
            holds += 1;

            if (unring === null && untrack(() => state.data()) !== undefined && !untrack(() => state.loading()))
            {
                mine();
            }

            unring ??= useRealtime().onNudge((scope, id) =>
            {
                if (scope === 'me' && (id === undefined || id === 'markets') && untrack(() => account.user()) !== null)
                {
                    mine();
                }
            });

            if (ticking === null)
            {
                setNow(runtime().clock.now());
                ticking = runtime().clock.every(1000, () => setNow(runtime().clock.now()));
            }

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
                    unring?.();
                    unring = null;
                    ticking?.();
                    ticking = null;
                }
            };
        },

        reset()
        {
            age += 1;
            waits.forEach((cancel) => cancel());
            waits = [];
            pokes = [];
            placed = null;
            claimed = null;
            unring?.();
            unring = null;
            ticking?.();
            ticking = null;
            holds = 0;
            setPlacing(null);
            setClaiming(null);
            watchers = [];
            setWatched(null);
            setListed(false);
            setOlderRows([]);
            setOlderCursor(undefined);
        }
    };
});
