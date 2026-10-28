import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import type { Eip1193Provider } from '../src/lib/wallet.ts';
import '../src/locales/app-catalogue.ts';
import '../src/locales/donate-catalogue.ts';
import { SETTLE_MS, useDonations } from '../src/stores/donations.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useWallet } from '../src/stores/wallet.store.ts';
import type { Account } from '../../backend/src/schemas.ts';
import { NURA_TIPS, server, settleDonation } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const OWNER = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f';
const OTHER = '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf';
const HASH = `0x${ 'ab'.repeat(32) }`;
const NURA = 10n ** 18n;
const FIVE = (5n * NURA).toString();

const OPEN = {
    open: true as const,
    accepting: true,
    may: 'yes' as const,
    presets: [1n, 5n, 10n, 25n, 50n, 100n].map((one) => (one * NURA).toString()),
    least: NURA.toString(),
    most: (1000n * NURA).toString()
};

interface Held
{
    calls: { method: string; params: unknown }[];
    chain: string;
    refuse: Set<string>;

    /** What the wallet waits on before it says it sent, so a spec can act while it is being asked. */
    gate: Promise<void> | null;
}

let clock: ManualClock;
let seq = 0;
let stopWallet: (() => void) | null = null;

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
};

const walletAt = (address: string, chain = '0x7a69') =>
{
    const held: Held = { calls: [], chain, refuse: new Set(), gate: null };
    const provider: Eip1193Provider = {
        async request({ method, params })
        {
            held.calls.push({ method, params });

            if (held.refuse.has(method))
            {
                throw { code: 4001, message: 'User rejected the request.' };
            }

            if (method === 'eth_accounts' || method === 'eth_requestAccounts')
            {
                return [address];
            }

            if (method === 'eth_chainId')
            {
                return held.chain;
            }

            if (method === 'wallet_switchEthereumChain')
            {
                held.chain = ((params as { chainId: string }[])[0]).chainId;
                return null;
            }

            if (method === 'eth_sendTransaction')
            {
                await held.gate;
                return HASH;
            }

            return null;
        },
        on()
        {
            return;
        },
        removeListener()
        {
            return;
        }
    };

    return { held, provider };
};

const signIn = async (wallet: { provider: Eip1193Provider }) =>
{
    seq += 1;
    const account: Account = { id: `u-give-${ seq }`, handle: `giver${ seq }`, displayName: 'Dana', bio: '', hue: 12, isMinor: false, address: OWNER };
    server.account = account;
    useSession().establish(account);
    useWallet().adopt(wallet.provider);
    stopWallet = useWallet().start();
    await settle();
};

const methods = (held: Held) => held.calls.map((call) => call.method);

/** Lets the store's watch over a gift ask once more, as its clock would. */
const tick = async () =>
{
    clock.advance(SETTLE_MS);
    await settle();
};

/** A gift given and sent, waiting on NuraChain. */
const sending = async () =>
{
    const giving = useDonations().give('m-1', 'sara.k', FIVE);

    await settle();
    await settle();

    return { giving };
};

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(Date.parse('2026-10-28T12:00:00.000Z'));
    setRuntime({ clock, seed: 3 });
    server.reset();
    server.donate.state = { ...OPEN };
    useRealtime().reset();
    socket.reset();
    useDonations().reset();
    useToasts().reset();
});

afterEach(() =>
{
    stopWallet?.();
    stopWallet = null;
    useDonations().reset();
    useWallet().reset();
    useSession().reset();
});

describe('donations, as the browser holds them', () =>
{
    it('reads whether they are open and what the reader may do', async () =>
    {
        await signIn(walletAt(OWNER));

        expect(useDonations().state()).toEqual(OPEN);
        expect(useDonations().accepting()).toBe(true);
    });

    it('shows the switch at the press, sends it, and keeps the server\'s word', async () =>
    {
        await signIn(walletAt(OWNER));

        let free: () => void = () => undefined;
        server.donate.hold = new Promise((resolve) =>
        {
            free = resolve;
        });

        const switching = useDonations().accept(false);

        expect(useDonations().accepting(), 'shown at the press').toBe(false);

        free();

        expect(await switching).toBe(true);
        expect(server.calls).toContain('donations.accept false');
        expect(useDonations().accepting()).toBe(false);
    });

    it('takes a refused switch back and says why in its own words', async () =>
    {
        await signIn(walletAt(OWNER));
        server.donate.refuse = { status: 404, code: 'donate-off' };

        expect(await useDonations().accept(false)).toBe(false);
        expect(useDonations().accepting()).toBe(true);
        expect(useToasts().items().map((toast) => toast.text)).toContain('Donations are not open here.');
    });

    it('asks who of a watched game\'s players may be given NURA, by handle whatever its case', async () =>
    {
        await signIn(walletAt(OWNER));
        server.donate.players = [{ who: 'Sara.K', may: true }, { who: 'reza.t', may: false }];

        const players = await useDonations().players('m-1');

        expect(server.calls).toContain('donations.players m-1');
        expect(players?.get('sara.k')).toBe(true);
        expect(players?.get('reza.t')).toBe(false);
    });

    it('answers nothing when who may be given could not be asked', async () =>
    {
        await signIn(walletAt(OWNER));
        server.donate.refuse = { status: 503, code: 'chain-unreachable' };

        expect(await useDonations().players('m-1')).toBeNull();
    });
});

describe('giving NURA', () =>
{
    it('prepares the gift, hands the wallet the call on its chain, nudges the server, and says it arrived once NuraChain holds it', async () =>
    {
        const wallet = walletAt(OWNER, '0x1');
        await signIn(wallet);

        const { giving } = await sending();
        const sent = wallet.held.calls.find((call) => call.method === 'eth_sendTransaction');

        expect(server.calls).toContain(`donations.give m-1 sara.k ${ FIVE }`);
        expect(wallet.held.calls.find((call) => call.method === 'wallet_switchEthereumChain')?.params).toEqual([{ chainId: '0x7a69' }]);
        expect(sent?.params).toEqual([{ from: OWNER, to: NURA_TIPS, data: '0xtip', value: `0x${ (5n * NURA).toString(16) }` }]);
        expect(server.calls).toContain('donations.sent gift-1');
        expect(useDonations().giving()).toMatchObject({ match: 'm-1', to: 'sara.k', amount: FIVE, step: 'chain', hash: HASH, chainId: 31337 });

        settleDonation('gift-1', 'confirmed');
        await tick();
        await giving;

        expect(useDonations().giving()).toMatchObject({ step: 'done', said: null, donation: { state: 'confirmed' } });
    });

    it('hears the reader\'s ring before its own clock', async () =>
    {
        await signIn(walletAt(OWNER));
        const unlisten = useDonations().listen();
        useRealtime().start();
        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        const { giving } = await sending();

        settleDonation('gift-1', 'confirmed');
        socket.deliver({ v: 1, t: 'nudge', n: 1, at: 0, scope: 'me', id: 'donations' });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();
        await giving;

        expect(useDonations().giving()?.step).toBe('done');

        unlisten();
    });

    it('says a wallet short of the gift with what it holds', async () =>
    {
        await signIn(walletAt(OWNER));
        server.donate.refuse = { status: 409, code: 'donate-funds', details: { amount: FIVE, held: (2n * NURA).toString() } };

        await useDonations().give('m-1', 'sara.k', FIVE);

        expect(useDonations().giving()).toMatchObject({ step: 'failed', said: 'donate.refused.donate-funds', held: (2n * NURA).toString() });
    });

    it('says each refusal in its own words, and a chain it could not reach as that', async () =>
    {
        await signIn(walletAt(OWNER));

        for (const [code, said] of [['donate-playing', 'donate.refused.donate-playing'], ['donate-nobody', 'donate.refused.donate-nobody'], ['chain-unreachable', 'donate.unreached'], ['nothing-we-know', 'common.actionFailed']] as const)
        {
            server.donate.refuse = { status: 409, code };

            await useDonations().give('m-1', 'sara.k', FIVE);

            expect(useDonations().giving(), code).toMatchObject({ step: 'failed', said, held: null });
        }
    });

    it('sends nothing from another account than the one signed in', async () =>
    {
        const wallet = walletAt(OTHER);
        await signIn(wallet);

        await useDonations().give('m-1', 'sara.k', FIVE);

        expect(useDonations().giving()).toMatchObject({ step: 'failed', said: 'vault.wrongAccount' });
        expect(methods(wallet.held)).not.toContain('eth_sendTransaction');
    });

    it('says a no in the wallet as nothing sent', async () =>
    {
        const wallet = walletAt(OWNER);
        wallet.held.refuse.add('eth_sendTransaction');
        await signIn(wallet);

        await useDonations().give('m-1', 'sara.k', FIVE);

        expect(useDonations().giving()).toMatchObject({ step: 'failed', said: 'donate.wallet.rejected' });
        expect(server.calls.filter((call) => call.startsWith('donations.sent'))).toEqual([]);
    });

    it('waits for a gift until its deadline by the server\'s clock, however far ahead the device\'s runs', async () =>
    {
        await signIn(walletAt(OWNER));
        useRealtime().start();
        socket.accept();
        socket.deliver({ v: 1, t: 'hello', n: 1, rt: 'nura-rt/v1', self: 'giver', at: clock.now() - 10 * 60_000 });

        const { giving } = await sending();

        for (let minute = 0; minute < 36; minute += 1)
        {
            clock.advance(60_000);
            await settle();
        }

        settleDonation('gift-1', 'confirmed');
        await tick();
        await giving;

        expect(useDonations().giving(), 'thirty-six minutes on, the server\'s clock is still short of the deadline').toMatchObject({ step: 'done' });
    });

    it('says a gift that ran out, one the chain refused and one held as something else, each in its own words', async () =>
    {
        await signIn(walletAt(OWNER));

        for (const [state, said] of [['expired', 'donate.step.lapsed'], ['reverted', 'donate.step.reverted'], ['failed', 'donate.step.nothing']] as const)
        {
            const { giving } = await sending();

            settleDonation(server.donate.given[0].id, state);
            await tick();
            await giving;

            expect(useDonations().giving(), state).toMatchObject({ step: 'failed', said });
        }
    });

    it('answers a second press with the gift already under way', async () =>
    {
        await signIn(walletAt(OWNER));

        const first = useDonations().give('m-1', 'sara.k', FIVE);
        const second = useDonations().give('m-1', 'reza.t', FIVE);

        expect(second).toBe(first);

        await settle();
        await settle();
        settleDonation('gift-1', 'confirmed');
        await tick();
        await first;

        expect(server.calls.filter((call) => call.startsWith('donations.give'))).toEqual([`donations.give m-1 sara.k ${ FIVE }`]);
    });

    it('forgets a gift that is over once its sheet lets it go, and never one still on its way', async () =>
    {
        await signIn(walletAt(OWNER));

        const { giving } = await sending();

        useDonations().forget();

        expect(useDonations().giving()?.step).toBe('chain');

        settleDonation('gift-1', 'confirmed');
        await tick();
        await giving;
        useDonations().forget();

        expect(useDonations().giving()).toBeNull();
    });

    it('asks nothing more of a gift once the store is reset, even one whose wallet answers after it', async () =>
    {
        const wallet = walletAt(OWNER);
        let open: () => void = () => undefined;

        wallet.held.gate = new Promise((resolve) =>
        {
            open = resolve;
        });
        await signIn(wallet);

        void useDonations().give('m-1', 'sara.k', FIVE);
        await settle();

        expect(useDonations().giving()?.step).toBe('wallet');

        useDonations().reset();

        const asked = server.calls.length;

        open();
        await settle();
        await tick();
        await tick();

        expect(server.calls.slice(asked).filter((call) => call.startsWith('donations.one')), 'a gift from before the reset was still being asked about').toEqual([]);
        expect(useDonations().giving()).toBeNull();
    });
});

describe('what was given and received', () =>
{
    it('reads each side a page at a time, and older pages after the first', async () =>
    {
        await signIn(walletAt(OWNER));
        server.donate.received = [{ id: 'r-1', from: 'sara.k', amount: FIVE, state: 'confirmed', game: 'hokm', deadline: '2026-10-28T12:30:00.000Z', at: '2026-10-28T11:00:00.000Z', confirmedAt: '2026-10-28T11:01:00.000Z' }];

        useDonations().want('received');
        await settle();

        expect(useDonations().list('received').map((one) => one.id)).toEqual(['r-1']);
        expect(useDonations().list('given')).toEqual([]);
        expect(server.calls.filter((call) => call.startsWith('donations.history'))).toEqual(['donations.history received']);
        expect(useDonations().hasOlder('received')).toBe(false);
    });

    it('reads a side again when it could not be read', async () =>
    {
        await signIn(walletAt(OWNER));
        server.donate.refuse = { status: 500, code: 'internal' };

        useDonations().want('given');
        await settle();

        expect(useDonations().listFailed('given')).toBe(true);

        server.donate.refuse = null;
        server.donate.given = [{ id: 'g-1', to: 'sara.k', amount: FIVE, state: 'sent', game: 'ludo', deadline: '2026-10-28T12:30:00.000Z', at: '2026-10-28T11:00:00.000Z' }];
        useDonations().again('given');
        await settle();

        expect(useDonations().listFailed('given')).toBe(false);
        expect(useDonations().list('given').map((one) => one.id)).toEqual(['g-1']);
    });
});
