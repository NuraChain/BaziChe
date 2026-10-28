import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUNDLES, bundlePriceFor, lookOf } from '../../backend/src/domains/shop/catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import type { Eip1193Provider } from '../src/lib/wallet.ts';
import '../src/locales/app-catalogue.ts';
import '../src/locales/shop-catalogue.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { SETTLE_MS, useShop } from '../src/stores/shop.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useWallet } from '../src/stores/wallet.store.ts';
import type { Account } from '../../backend/src/schemas.ts';
import { failShopOrder, NURA_SHOP, sellShopOrder, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const OWNER = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f';
const OTHER = '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf';
const HASH = `0x${ 'ab'.repeat(32) }`;

interface Held
{
    calls: { method: string; params: unknown }[];
    chain: string;
    receipt: unknown;
    refuse: Set<string>;
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
    const held: Held = { calls: [], chain, receipt: { status: '0x1' }, refuse: new Set() };
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
                return HASH;
            }

            if (method === 'eth_getTransactionReceipt')
            {
                return held.receipt;
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
    const account: Account = { id: `u-shop-${ seq }`, handle: `shop${ seq }`, displayName: 'Dana', bio: '', hue: 12, isMinor: false, address: OWNER };
    server.account = account;
    useSession().establish(account);
    useWallet().adopt(wallet.provider);
    stopWallet = useWallet().start();
    await settle();
};

const methods = (held: Held) => held.calls.map((call) => call.method);

/** Lets the store's order watch ask once more, as its clock would. */
const tick = async () =>
{
    clock.advance(SETTLE_MS);
    await settle();
};

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(Date.parse('2026-10-27T12:00:00.000Z'));
    setRuntime({ clock, seed: 3 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useShop().reset();
    useToasts().reset();
});

afterEach(() =>
{
    stopWallet?.();
    stopWallet = null;
    useShop().reset();
    useWallet().reset();
    useSession().reset();
});

describe('the shop, as the browser holds it', () =>
{
    it('reads what is on sale and what the reader owns, and prices a bundle down for the looks they hold', async () =>
    {
        server.shop.owned = [{ item: 'dice.neon', via: 'grant', at: '2026-10-27T11:00:00.000Z' }];
        await signIn(walletAt(OWNER));

        const bundle = BUNDLES.find((one) => one.id === 'bundle.neon')!;
        const looks = bundle.looks.map((look) => ({ price: lookOf(look)!.price, owned: look === 'dice.neon' }));

        expect(useShop().state()).toEqual(server.shop.state);
        expect(useShop().owns('dice.neon')).toBe(true);
        expect(useShop().owns('bundle.neon'), 'a bundle is owned once all of it is').toBe(false);
        expect(useShop().priceFor('dice.glow')).toEqual({ price: lookOf('dice.glow')!.price });
        expect(useShop().priceFor('bundle.neon')).toEqual({ price: bundlePriceFor(bundle.price, looks) });
        expect(useShop().priceFor('nothing.here')).toBeNull();
    });

    it('says a sale with what it cost before and when it ends', async () =>
    {
        const state = server.shop.state;

        if (state.open)
        {
            server.shop.state = { ...state, items: state.items.map((one) => (one.id === 'pawns.gold' ? { ...one, sale: { price: '6000000000000000000', until: '2026-11-01T00:00:00.000Z' } } : one)) };
        }

        await signIn(walletAt(OWNER));

        expect(useShop().priceFor('pawns.gold')).toEqual({ price: 6n * 10n ** 18n, was: lookOf('pawns.gold')!.price, until: '2026-11-01T00:00:00.000Z' });
    });

    it('says a chain it could not reach as that, never as a closed shop', async () =>
    {
        server.shop.refuse = { status: 503, code: 'chain-unreachable' };
        await signIn(walletAt(OWNER));

        expect(useShop().failed()).toBe(true);
        expect(useShop().unreached()).toBe(true);
        expect(useShop().state()).toBeNull();
    });
});

describe('choosing a look', () =>
{
    it('shows the choice at the press, sends it, and keeps the server\'s word', async () =>
    {
        server.shop.owned = [{ item: 'back.shiraz', via: 'purchase', at: '2026-10-27T11:00:00.000Z' }];
        await signIn(walletAt(OWNER));

        let free: () => void = () => undefined;
        server.shop.hold = new Promise((resolve) =>
        {
            free = resolve;
        });

        const choosing = useShop().choose('hokm.back', 'back.shiraz');

        expect(useShop().chosen('hokm.back'), 'shown at the press').toBe('back.shiraz');
        expect(useShop().inUse('back.shiraz')).toBe(true);

        free();

        expect(await choosing).toBe(true);
        expect(server.calls).toContain('shop.choose hokm.back back.shiraz');
        expect(useShop().chosen('hokm.back')).toBe('back.shiraz');

        expect(await useShop().choose('hokm.back', null)).toBe(true);
        expect(useShop().chosen('hokm.back')).toBeNull();
        expect(server.calls).toContain('shop.choose hokm.back classic');
    });

    it('takes a refused choice back and says why in the shop\'s own words', async () =>
    {
        await signIn(walletAt(OWNER));

        expect(await useShop().choose('ludo.dice', 'dice.gold')).toBe(false);
        expect(useShop().chosen('ludo.dice')).toBeNull();
        expect(useToasts().items().map((toast) => toast.text)).toContain('That look is not yours yet.');
    });
});

describe('buying a look', () =>
{
    it('orders it, hands the wallet the purchase on the shop\'s chain, nudges the server, and says it is the reader\'s once sold', async () =>
    {
        const wallet = walletAt(OWNER, '0x1');
        await signIn(wallet);
        const watched = useShop().watch('dice.glow');

        const buying = useShop().buy('dice.glow');

        await settle();
        await settle();

        const id = server.shop.orders[0].id;
        const sent = wallet.held.calls.find((call) => call.method === 'eth_sendTransaction');

        expect(server.calls).toContain('shop.order dice.glow');
        expect(wallet.held.calls.find((call) => call.method === 'wallet_switchEthereumChain')?.params).toEqual([{ chainId: '0x7a69' }]);
        expect(sent?.params).toEqual([{ from: OWNER, to: NURA_SHOP, data: '0xbuy', value: `0x${ lookOf('dice.glow')!.price.toString(16) }` }]);
        expect(server.calls).toContain(`shop.sent ${ id }`);
        expect(useShop().buying()).toMatchObject({ item: 'dice.glow', step: 'chain', hash: HASH });

        sellShopOrder(id);
        await tick();
        await buying;

        expect(useShop().buying()).toMatchObject({ item: 'dice.glow', step: 'done', said: null });
        expect(useShop().owns('dice.glow')).toBe(true);
        expect(useToasts().items(), 'the sheet that watches says it, not a toast').toEqual([]);

        watched();
    });

    it('takes a look given at Buy as the reader\'s at once, asking the wallet nothing', async () =>
    {
        const wallet = walletAt(OWNER);

        await signIn(wallet);

        if (server.shop.state.open)
        {
            server.shop.state = { ...server.shop.state, free: true };
        }

        await useShop().buy('bundle.storm');

        expect(useShop().buying()).toMatchObject({ item: 'bundle.storm', step: 'done', order: null, hash: null });
        expect(useShop().owns('bundle.storm')).toBe(true);
        expect(wallet.held.calls.filter((call) => call.method === 'eth_sendTransaction'), 'the wallet was asked to pay for a free look').toEqual([]);
        expect(server.calls.filter((call) => call.startsWith('shop.sent')), 'a transaction was handed in for a free look').toEqual([]);
        expect(useToasts().items().map((toast) => toast.text)).toEqual(['Stormforged Monarch bundle is yours.']);
    });

    it('says it once it lands with a toast when no sheet is watching it', async () =>
    {
        await signIn(walletAt(OWNER));

        const buying = useShop().buy('pawns.shiraz');

        await settle();
        await settle();
        sellShopOrder(server.shop.orders[0].id);
        await tick();
        await buying;

        expect(useToasts().items().map((toast) => toast.text)).toEqual(['Shiraz Garden pawns is yours.']);
    });

    it('hears the shop\'s ring before its own clock', async () =>
    {
        await signIn(walletAt(OWNER));
        useShop().listen();
        useRealtime().start();
        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        const buying = useShop().buy('dice.glow');

        await settle();
        await settle();
        sellShopOrder(server.shop.orders[0].id);
        socket.deliver({ v: 1, t: 'nudge', n: 1, at: 0, scope: 'me', id: 'shop' });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();
        await buying;

        expect(useShop().buying()?.step).toBe('done');
    });

    it('sends nothing from another account than the one signed in', async () =>
    {
        const wallet = walletAt(OTHER);
        await signIn(wallet);

        await useShop().buy('dice.glow');

        expect(useShop().buying()).toMatchObject({ step: 'failed', said: 'vault.wrongAccount' });
        expect(methods(wallet.held)).not.toContain('eth_sendTransaction');
    });

    it('says a no in the wallet as nothing paid', async () =>
    {
        const wallet = walletAt(OWNER);
        wallet.held.refuse.add('eth_sendTransaction');
        await signIn(wallet);

        await useShop().buy('dice.glow');

        expect(useShop().buying()).toMatchObject({ step: 'failed', said: 'shop.wallet.rejected' });
        expect(server.calls.filter((call) => call.startsWith('shop.sent'))).toEqual([]);
    });

    it('says what it costs and what the wallet holds when the wallet is short', async () =>
    {
        await signIn(walletAt(OWNER));
        server.shop.refuse = { status: 409, code: 'shop-funds', details: { price: '12000000000000000000' } };

        await useShop().buy('dice.glow');

        expect(useShop().buying()).toMatchObject({ step: 'failed', said: 'shop.refused.shop-funds', short: { price: '12000000000000000000', held: null } });
    });

    it('says a payment the chain refused in the shop\'s own word', async () =>
    {
        await signIn(walletAt(OWNER));

        const buying = useShop().buy('dice.glow');

        await settle();
        await settle();
        failShopOrder(server.shop.orders[0].id, 'QuoteExpired');
        await tick();
        await buying;

        expect(useShop().buying()).toMatchObject({ step: 'failed', said: 'shop.failure.expired' });
    });

    it('sends a gift to the friend it names', async () =>
    {
        await signIn(walletAt(OWNER));
        useShop().watch('back.gold');

        const buying = useShop().buy('back.gold', 'sara.k');

        await settle();
        await settle();
        sellShopOrder(server.shop.orders[0].id);
        await tick();
        await buying;

        expect(server.calls).toContain('shop.order back.gold for sara.k');
        expect(useShop().buying()).toMatchObject({ item: 'back.gold', for: 'sara.k', step: 'done' });
        expect(useShop().owns('back.gold'), 'a gift is the friend\'s, not the buyer\'s').toBe(false);
    });

    it('answers a second press with the purchase already under way', async () =>
    {
        await signIn(walletAt(OWNER));

        const first = useShop().buy('dice.glow');
        const second = useShop().buy('dice.neon');

        expect(second).toBe(first);

        await settle();
        await settle();
        sellShopOrder(server.shop.orders[0].id);
        await tick();
        await first;

        expect(server.calls.filter((call) => call.startsWith('shop.order'))).toEqual(['shop.order dice.glow']);
    });

    it('forgets a purchase that is over once its sheet lets it go, and never one still on its way', async () =>
    {
        await signIn(walletAt(OWNER));

        const buying = useShop().buy('dice.glow');

        await settle();
        await settle();
        useShop().forget();

        expect(useShop().buying()?.step).toBe('chain');

        sellShopOrder(server.shop.orders[0].id);
        await tick();
        await buying;
        useShop().forget();

        expect(useShop().buying()).toBeNull();
    });
});

describe('what the shop owes for the people the reader invited', () =>
{
    it('claims it through the wallet and reads it again', async () =>
    {
        server.shop.earnings = { ...server.shop.earnings, earnings: '1200000000000000000' };
        const wallet = walletAt(OWNER);
        await signIn(wallet);
        useShop().want('earnings');
        await settle();

        expect(useShop().earnings()?.earnings).toBe('1200000000000000000');
        expect(await useShop().claim()).toBeNull();
        expect(wallet.held.calls.find((call) => call.method === 'eth_sendTransaction')?.params).toEqual([{ from: OWNER, to: NURA_SHOP, data: '0x4e71d92d', value: '0x0' }]);
    });

    it('says there is nothing to claim in the shop\'s word', async () =>
    {
        await signIn(walletAt(OWNER));

        expect(await useShop().claim()).toBe('shop.refused.shop-nothing');
    });
});
