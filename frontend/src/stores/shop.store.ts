import { createResource, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import {
    ApiError,
    client,
    type ShopBalance,
    type ShopCollectionView,
    type ShopEarnings,
    type ShopOrderView,
    type ShopState,
    type WalletCall
} from '../api.ts';
import { bundleOf, bundlePriceFor, type ShopSlot } from '../../../backend/src/domains/shop/catalogue.ts';
import { attempt } from '../lib/attempt.ts';
import { createGuesses } from '../lib/guess.ts';
import { runtime } from '../lib/runtime.ts';
import { failureOf, itemName, priceOf, whyShop, type Price } from '../lib/shop.ts';
import { REFUSAL_OF, readyToSend, type SendRefusal } from '../lib/wallet-call.ts';
import type { MessageKey } from '../locales/en.ts';
import { useAccount } from './account.store.ts';
import { useLocale } from './locale.store.ts';
import { useRealtime } from './realtime.store.ts';
import { useToasts } from './toasts.store.ts';
import { useWallet } from './wallet.store.ts';

/** How often an order on its way is asked about while no ring has come. */
export const SETTLE_MS = 3_000;

/** How long past its quote's deadline an order is still waited for: the server's own lapse. */
const LAPSE_MS = 5 * 60_000;

const RECEIPT_WAIT_MS = 1_500;

const RECEIPT_TRIES = 40;

const SEND_COPY: Record<SendRefusal, MessageKey> = {
    rejected: 'shop.wallet.rejected',
    'wrong-chain': 'shop.wallet.wrongChain',
    unavailable: 'vault.unavailable',
    locked: 'vault.locked',
    asking: 'vault.asking',
    'no-wallet': 'vault.noWallet',
    'wrong-account': 'vault.wrongAccount',
    'wallet-failed': 'vault.walletFailed'
};

export type BuyStep = 'preparing' | 'wallet' | 'chain' | 'done' | 'failed';

export interface Buying
{
    item: string;
    for: string | null;
    step: BuyStep;
    order: ShopOrderView | null;
    chainId: number | null;
    from: string | null;
    hash: string | null;
    said: MessageKey | null;

    /** What it costs and what the wallet holds, in wei, when the wallet was short. */
    short: { price: string; held: string | null } | null;
}

export interface ShopApi
{
    state: Getter<ShopState | null>;
    loading: Getter<boolean>;
    failed: Getter<boolean>;
    unreached: Getter<boolean>;
    collection: Getter<ShopCollectionView | null>;
    collectionLoading: Getter<boolean>;
    collectionFailed: Getter<boolean>;

    /** Whether the reader owns a look, or every look of a bundle. */
    owns(item: string): boolean;

    /** Whether a look is chosen anywhere. */
    inUse(item: string): boolean;

    /** What the reader would pay for an item now: a bundle priced down for the looks they own, as the server prices it. */
    priceFor(item: string): Price | null;
    chosen(slot: ShopSlot): string | null;
    choose(slot: ShopSlot, item: string | null): Promise<boolean>;
    buying: Getter<Buying | null>;
    buy(item: string, recipient?: string): Promise<void>;
    watch(item: string): () => void;
    forget(): void;
    orders: Getter<readonly ShopOrderView[]>;
    ordersLoading: Getter<boolean>;
    hasOlder: Getter<boolean>;
    older(): Promise<void>;
    earnings: Getter<ShopEarnings | null>;
    claiming: Getter<boolean>;
    claim(): Promise<MessageKey | null>;
    balance: Getter<ShopBalance | null>;
    want(what: 'balance' | 'earnings' | 'orders'): void;
    listen(): () => void;
    refresh(): Promise<void>;
    reset(): void;
}

const funds = (error: unknown) =>
{
    if (!(error instanceof ApiError) || error.code !== 'shop-funds')
    {
        return null;
    }

    const price: unknown = typeof error.details === 'object' && error.details !== null ? Reflect.get(error.details, 'price') : undefined;

    return typeof price === 'string' ? price : null;
};

export const useShop = createStore((): ShopApi =>
{
    const account = useAccount();
    const wallet = useWallet();

    const reader = () => account.user()?.id ?? null;

    const [wanted, setWanted] = createSignal<readonly string[]>([]);

    const wants = (what: string) => () => (wanted().includes(what) ? reader() : null);

    const state = createResource(reader, () => client.shop.state(), { name: 'shop.state' });

    const held = createResource(reader, () => client.shop.collection(), { name: 'shop.collection' });

    const firstOrders = createResource(wants('orders'), () => client.shop.orders(), { name: 'shop.orders' });

    const earnings = createResource(wants('earnings'), () => client.shop.earnings(), { name: 'shop.earnings' });

    const balance = createResource(wants('balance'), () => client.shop.balance(), { name: 'shop.balance' });

    const guesses = createGuesses<ShopCollectionView | null>();

    const [olderPages, setOlderPages] = createSignal<readonly ShopOrderView[]>([]);

    /** Where the next older page starts: the first page's own cursor until an older page has been read. */
    const [olderCursor, setOlderCursor] = createSignal<string | null | undefined>(undefined);

    const nextCursor = () =>
    {
        const after = olderCursor();

        return after === undefined ? firstOrders.data()?.cursor ?? null : after;
    };

    const [buying, setBuying] = createSignal<Buying | null>(null);

    const [claiming, setClaiming] = createSignal(false);

    let age = 0;

    let holds = 0;

    let unring: (() => void) | null = null;

    let inFlight: Promise<void> | null = null;

    let poke: (() => void) | null = null;

    let watched: string | null = null;

    let waits: (() => void)[] = [];

    const collection = () => guesses.over(held.data() ?? null);

    const owned = (look: string) => collection()?.owned.some((one) => one.item === look) === true;

    const readAgain = async () =>
    {
        await held.refetch();

        const error = held.error();

        if (error !== null)
        {
            throw error;
        }
    };

    const mine = () =>
    {
        void held.refetch().then(() =>
        {
            if (held.error() === null)
            {
                guesses.landed();
            }
        });

        if (untrack(wanted).includes('orders'))
        {
            setOlderPages([]);
            setOlderCursor(undefined);
            void firstOrders.refetch();
        }

        if (untrack(wanted).includes('earnings'))
        {
            void earnings.refetch();
        }
    };

    const quiet = () =>
    {
        unring?.();
        unring = null;
        holds = 0;
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

    /** The order as the shop last said, once it is paid, failed, ran out or was refunded; null once it has been waited for long enough. */
    const settled = (id: string, deadline: string, era: number) =>
        new Promise<ShopOrderView | null>((resolve) =>
        {
            const until = Date.parse(deadline) + LAPSE_MS;
            let asking = false;
            let cancel: (() => void) | null = null;

            const done = (order: ShopOrderView | null) =>
            {
                cancel?.();
                poke = null;
                resolve(order);
            };

            const look = () =>
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

                void client.shop.one({ params: { id } }).then((order) => order, () => null).then((order) =>
                {
                    asking = false;

                    if (era !== age)
                    {
                        done(null);
                        return;
                    }

                    if (order !== null && order.state !== 'quoted' && order.state !== 'sent')
                    {
                        done(order);
                        return;
                    }

                    if (runtime().clock.now() > until)
                    {
                        done(null);
                        return;
                    }

                    cancel = later(SETTLE_MS, look);
                });
            };

            poke = look;
            look();
        });

    const receipt = (hash: string, era: number) =>
        new Promise<boolean | null>((resolve) =>
        {
            let left = RECEIPT_TRIES;

            const look = () =>
            {
                void wallet.settled(hash).then((status) =>
                {
                    left -= 1;

                    if (status !== null || left === 0 || era !== age)
                    {
                        resolve(status);
                        return;
                    }

                    later(RECEIPT_WAIT_MS, look);
                });
            };

            look();
        });

    const run = async (item: string, recipient: string | null) =>
    {
        const era = age;
        const locale = useLocale();

        const set = (patch: Partial<Buying>) =>
        {
            if (era === age)
            {
                setBuying((now) => (now === null ? null : { ...now, ...patch }));
            }
        };

        setBuying({ item, for: recipient, step: 'preparing', order: null, chainId: null, from: null, hash: null, said: null, short: null });

        let order: ShopOrderView;
        let call: WalletCall;

        try
        {
            ({ order, call } = await client.shop.order({ input: { item, ...(recipient === null ? {} : { for: recipient }) } }));
        }
        catch (error)
        {
            const price = funds(error);
            const inWallet = price === null ? null : await client.shop.balance().then((read) => read.wallet, () => null);

            set({ step: 'failed', said: whyShop(error), short: price === null ? null : { price, held: inWallet } });
            return;
        }

        set({ order, chainId: call.chainId });

        const blocked = await readyToSend(wallet, account.address(), call.chainId);

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

        void client.shop.sent({ params: { id: order.id }, input: { hash } }).catch(() => undefined);
        void receipt(hash, era).then(() => poke?.());

        const landed = await settled(order.id, order.deadline, era);

        if (era !== age)
        {
            return;
        }

        if (landed === null)
        {
            return;
        }

        if (landed.state === 'paid')
        {
            set({ step: 'done', order: landed, said: landed.delivered === false ? 'shop.step.nothing' : null });
            mine();

            if (untrack(() => watched) !== item)
            {
                useToasts().show({ kind: 'success', text: recipient === null ? locale.t('shop.step.mineNamed', { look: itemName(item, locale) }) : locale.t('shop.step.sent', { name: recipient }) });
            }

            return;
        }

        set({
            step: 'failed',
            order: landed,
            said: landed.state === 'failed' ? failureOf(landed.failure) : landed.state === 'expired' ? 'shop.failure.expired' : 'shop.step.nothing'
        });
    };

    return {
        state: () => state.data() ?? null,
        loading: () => state.loading(),
        failed: () => state.error() !== null,
        unreached: () =>
        {
            const error = state.error();
            return error instanceof ApiError && error.code === 'chain-unreachable';
        },

        collection,

        collectionLoading: () => held.loading(),

        collectionFailed: () => held.error() !== null,

        owns: (item) => (bundleOf(item)?.looks ?? [item]).every((look) => owned(look)),

        inUse: (item) => collection()?.chosen.some((one) => one.item === item) === true,

        priceFor(item)
        {
            const asked = priceOf(state.data() ?? null, item);
            const bundle = bundleOf(item);

            if (asked === null || bundle === undefined)
            {
                return asked;
            }

            const looks = bundle.looks.map((look) => ({ price: priceOf(state.data() ?? null, look)?.price ?? 0n, owned: owned(look) }));

            return { ...asked, price: bundlePriceFor(asked.price, looks) };
        },

        chosen: (slot) => collection()?.chosen.find((one) => one.slot === slot)?.item ?? null,

        choose: (slot, item) => attempt(
            guesses.during(
                (now) => (now === null
                    ? now
                    : { ...now, chosen: [...now.chosen.filter((one) => one.slot !== slot), ...(item === null ? [] : [{ slot, item }])] }),
                () => client.shop.choose({ input: { slot, ...(item === null ? {} : { item }) } }),
                readAgain
            ),
            undefined,
            (error) => whyShop(error)
        ),

        buying,

        buy(item, recipient)
        {
            inFlight ??= run(item, recipient ?? null).finally(() =>
            {
                inFlight = null;
            });

            return inFlight;
        },

        watch(item)
        {
            watched = item;

            return () =>
            {
                if (watched === item)
                {
                    watched = null;
                }
            };
        },

        forget()
        {
            const now = untrack(buying);

            if (now !== null && (now.step === 'done' || now.step === 'failed'))
            {
                setBuying(null);
            }
        },

        orders: () => [...(firstOrders.data()?.orders ?? []), ...olderPages()],

        ordersLoading: () => firstOrders.loading(),

        hasOlder: () => nextCursor() !== null,

        async older()
        {
            const cursor = untrack(nextCursor);

            if (cursor === null)
            {
                return;
            }

            const page = await client.shop.orders({ query: { cursor } });

            setOlderPages((now) => [...now, ...page.orders]);
            setOlderCursor(page.cursor ?? null);
        },

        earnings: () => earnings.data() ?? null,

        claiming,

        async claim()
        {
            if (untrack(claiming))
            {
                return 'vault.asking';
            }

            setClaiming(true);

            try
            {
                const call = await client.shop.claim();
                const blocked = await readyToSend(wallet, account.address(), call.chainId);

                if (blocked !== null)
                {
                    return SEND_COPY[blocked];
                }

                const hash = await wallet.send(call.to, call.data, { value: call.value, ...(call.gasPrice === undefined ? {} : { gasPrice: call.gasPrice }) });

                if (hash === null)
                {
                    return SEND_COPY[REFUSAL_OF[wallet.failure() ?? 'unknown']];
                }

                const ok = await receipt(hash, age);

                await earnings.refetch();

                return ok === false ? 'shop.failure.other' : null;
            }
            catch (error)
            {
                return whyShop(error);
            }
            finally
            {
                setClaiming(false);
            }
        },

        balance: () => balance.data() ?? null,

        want(what)
        {
            setWanted((now) => (now.includes(what) ? now : [...now, what]));
        },

        listen()
        {
            holds += 1;

            if (unring === null && untrack(() => held.data()) !== undefined && !untrack(() => held.loading()))
            {
                void state.refetch();
                mine();
            }

            unring ??= useRealtime().onNudge((scope, id) =>
            {
                if (scope === 'me' && (id === undefined || id === 'shop') && untrack(() => account.user()) !== null)
                {
                    poke?.();
                    mine();
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

        async refresh()
        {
            await Promise.all([state.refetch(), held.refetch()]);
        },

        reset()
        {
            age += 1;

            for (const cancel of waits)
            {
                cancel();
            }

            waits = [];
            poke = null;
            inFlight = null;
            watched = null;
            quiet();
            guesses.clear();
            setBuying(null);
            setClaiming(false);
            setOlderPages([]);
            setOlderCursor(undefined);
            setWanted([]);
        }
    };
});
