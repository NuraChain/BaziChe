import { createResource, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import { client, type DonationsState, type DonationView } from '../api.ts';
import { attempt } from '../lib/attempt.ts';
import { heldOf, whyDonate } from '../lib/donate.ts';
import { createGuesses } from '../lib/guess.ts';
import { runtime } from '../lib/runtime.ts';
import { REFUSAL_OF, readyToSend, type SendRefusal } from '../lib/wallet-call.ts';
import type { MessageKey } from '../locales/en.ts';
import { useAccount } from './account.store.ts';
import { useRealtime } from './realtime.store.ts';
import { useWallet } from './wallet.store.ts';

/** How often a gift on its way is asked about while no ring has come. */
export const SETTLE_MS = 3_000;

/** How long past its deadline a gift is still waited for: the server's own lapse. */
const LAPSE_MS = 5 * 60_000;

const SEND_COPY: Record<SendRefusal, MessageKey> = {
    rejected: 'donate.wallet.rejected',
    'wrong-chain': 'donate.wallet.wrongChain',
    unavailable: 'vault.unavailable',
    locked: 'vault.locked',
    asking: 'vault.asking',
    'no-wallet': 'vault.noWallet',
    'wrong-account': 'vault.wrongAccount',
    'wallet-failed': 'vault.walletFailed'
};

export type GiveStep = 'preparing' | 'wallet' | 'chain' | 'done' | 'failed';

export interface Giving
{
    match: string;
    to: string;

    /** Wei. */
    amount: string;
    step: GiveStep;
    donation: DonationView | null;
    chainId: number | null;
    from: string | null;
    hash: string | null;
    said: MessageKey | null;

    /** What the wallet holds, in wei, when it was short. */
    held: string | null;
}

export type Side = 'given' | 'received';

export interface DonationsApi
{
    state: Getter<DonationsState | null>;
    loading: Getter<boolean>;
    failed: Getter<boolean>;

    /** Whether the reader takes donations, as shown: a switch pressed is shown at once. */
    accepting: Getter<boolean>;
    accept(on: boolean): Promise<boolean>;

    /** Who of a watched game's players may be given NURA by the reader, by handle; null when it could not be asked. */
    players(match: string): Promise<ReadonlyMap<string, boolean> | null>;
    giving: Getter<Giving | null>;
    give(match: string, to: string, amount: string): Promise<void>;
    forget(): void;
    list(side: Side): DonationView[];
    listLoading(side: Side): boolean;
    listFailed(side: Side): boolean;
    hasOlder(side: Side): boolean;
    older(side: Side): Promise<void>;
    want(side: Side): void;

    /** One side's first page read again, after it could not be read. */
    again(side: Side): void;
    listen(): () => void;
    reset(): void;
}

export const useDonations = createStore((): DonationsApi =>
{
    const account = useAccount();
    const wallet = useWallet();

    const reader = () => account.user()?.id ?? null;

    const [wanted, setWanted] = createSignal<readonly Side[]>([]);

    const wants = (side: Side) => () => (wanted().includes(side) ? reader() : null);

    const state = createResource(reader, () => client.donations.state(), { name: 'donations.state' });

    const pages = {
        given: createResource(wants('given'), () => client.donations.history({ query: { side: 'given' } }), { name: 'donations.given' }),
        received: createResource(wants('received'), () => client.donations.history({ query: { side: 'received' } }), { name: 'donations.received' })
    };

    const [olderPages, setOlderPages] = createSignal<Record<Side, readonly DonationView[]>>({ given: [], received: [] });

    const [olderCursor, setOlderCursor] = createSignal<Record<Side, string | null | undefined>>({ given: undefined, received: undefined });

    const guesses = createGuesses<DonationsState | null>();

    const [giving, setGiving] = createSignal<Giving | null>(null);

    let age = 0;

    let holds = 0;

    let unring: (() => void) | null = null;

    let inFlight: Promise<void> | null = null;

    let poke: (() => void) | null = null;

    let waits: (() => void)[] = [];

    const shown = () => guesses.over(state.data() ?? null);

    const nextCursor = (side: Side) =>
    {
        const after = olderCursor()[side];

        return after === undefined ? pages[side].data()?.cursor ?? null : after;
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

    const mine = () =>
    {
        void state.refetch().then(() =>
        {
            if (state.error() === null)
            {
                guesses.landed();
            }
        });

        for (const side of untrack(wanted))
        {
            setOlderPages((now) => ({ ...now, [side]: [] }));
            setOlderCursor((now) => ({ ...now, [side]: undefined }));
            void pages[side].refetch();
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

    /** The gift as the server last said, once it is confirmed, refused, ran out or failed; null once it has been waited for long enough. */
    const settled = (id: string, deadline: string, era: number) =>
        new Promise<DonationView | null>((resolve) =>
        {
            const until = useRealtime().toLocal(Date.parse(deadline)) + LAPSE_MS;
            let asking = false;
            let cancel: (() => void) | null = null;

            const done = (gift: DonationView | null) =>
            {
                cancel?.();
                poke = null;
                resolve(gift);
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

                void client.donations.one({ params: { id } }).then((gift) => gift, () => null).then((gift) =>
                {
                    asking = false;

                    if (era !== age)
                    {
                        done(null);
                        return;
                    }

                    if (gift !== null && gift.state !== 'prepared' && gift.state !== 'sent')
                    {
                        done(gift);
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

    const run = async (match: string, to: string, amount: string) =>
    {
        const era = age;

        const set = (patch: Partial<Giving>) =>
        {
            if (era === age)
            {
                setGiving((now) => (now === null ? null : { ...now, ...patch }));
            }
        };

        setGiving({ match, to, amount, step: 'preparing', donation: null, chainId: null, from: null, hash: null, said: null, held: null });

        let paying: Awaited<ReturnType<typeof client.donations.give>>;

        try
        {
            paying = await client.donations.give({ input: { match, to, amount } });
        }
        catch (error)
        {
            set({ step: 'failed', said: whyDonate(error), held: heldOf(error) });
            return;
        }

        const { donation, call } = paying;

        set({ donation, chainId: call.chainId });

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

        void client.donations.sent({ params: { id: donation.id }, input: { hash } }).then(() => poke?.(), () => undefined);

        const landed = await settled(donation.id, donation.deadline, era);

        if (era !== age || landed === null)
        {
            return;
        }

        if (landed.state === 'confirmed')
        {
            set({ step: 'done', donation: landed });
            return;
        }

        set({
            step: 'failed',
            donation: landed,
            said: landed.state === 'expired' ? 'donate.step.lapsed' : landed.state === 'reverted' ? 'donate.step.reverted' : 'donate.step.nothing'
        });
    };

    return {
        state: shown,
        loading: () => state.loading(),
        failed: () => state.error() !== null,

        accepting: () =>
        {
            const now = shown();

            return now !== null && now.open && now.accepting;
        },

        accept: (on) => attempt(
            guesses.during(
                (now) => (now === null || !now.open ? now : { ...now, accepting: on }),
                () => client.donations.accept({ input: { on } }),
                readAgain
            ),
            undefined,
            (error) => whyDonate(error)
        ),

        async players(match)
        {
            try
            {
                const answer = await client.donations.players({ query: { match } });

                return new Map(answer.players.map((one) => [one.who.toLowerCase(), one.may]));
            }
            catch
            {
                return null;
            }
        },

        giving,

        give(match, to, amount)
        {
            inFlight ??= run(match, to, amount).finally(() =>
            {
                inFlight = null;
            });

            return inFlight;
        },

        forget()
        {
            const now = untrack(giving);

            if (now !== null && (now.step === 'done' || now.step === 'failed'))
            {
                setGiving(null);
            }
        },

        list: (side) => [...(pages[side].data()?.donations ?? []), ...olderPages()[side]],

        listLoading: (side) => pages[side].loading(),

        listFailed: (side) => pages[side].error() !== null && pages[side].data() === undefined,

        hasOlder: (side) => nextCursor(side) !== null,

        async older(side)
        {
            const cursor = untrack(() => nextCursor(side));

            if (cursor === null)
            {
                return;
            }

            const page = await client.donations.history({ query: { side, cursor } });

            setOlderPages((now) => ({ ...now, [side]: [...now[side], ...page.donations] }));
            setOlderCursor((now) => ({ ...now, [side]: page.cursor ?? null }));
        },

        want(side)
        {
            setWanted((now) => (now.includes(side) ? now : [...now, side]));
        },

        again(side)
        {
            void pages[side].refetch();
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
                if (scope === 'me' && (id === undefined || id === 'donations') && untrack(() => account.user()) !== null)
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
                    unring?.();
                    unring = null;
                }
            };
        },

        reset()
        {
            age += 1;
            waits.forEach((cancel) => cancel());
            waits = [];
            poke = null;
            inFlight = null;
            unring?.();
            unring = null;
            holds = 0;
            setGiving(null);
            setWanted([]);
            setOlderPages({ given: [], received: [] });
            setOlderCursor({ given: undefined, received: undefined });
        }
    };
});
