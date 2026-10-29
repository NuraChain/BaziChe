import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import LookSheet from '../src/components/shop/look-sheet.component.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/shop-catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import type { Eip1193Provider } from '../src/lib/wallet.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { SETTLE_MS, useShop } from '../src/stores/shop.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useWallet } from '../src/stores/wallet.store.ts';
import { closedShop, sellShopOrder, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';
import { forgetVoices, voices } from './fake-voices.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const equipped = vi.hoisted(() => [] as { look: HTMLElement; item: string }[]);
const handed = vi.hoisted(() => [] as unknown[]);

vi.mock('../src/game/looks/equip.ts', () => ({
    burstOver: (look: HTMLElement, item: string, voices: unknown = null) =>
    {
        equipped.push({ look, item });
        handed.push(voices);
    }
}));

vi.mock('../src/game/sound.ts', async (original) => ({
    ...(await original<typeof import('../src/game/sound.ts')>()),
    createVoices: (await import('./fake-voices.ts')).createVoices
}));

const OWNER = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f';

let clock: ManualClock;
let stopWallet: (() => void) | null = null;

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const walletWith = (refuse: string[] = []) =>
{
    const provider: Eip1193Provider = {
        async request({ method })
        {
            if (refuse.includes(method))
            {
                throw { code: 4001, message: 'User rejected the request.' };
            }

            if (method === 'eth_accounts' || method === 'eth_requestAccounts')
            {
                return [OWNER];
            }

            if (method === 'eth_chainId')
            {
                return '0x7a69';
            }

            if (method === 'eth_sendTransaction')
            {
                return `0x${ 'ab'.repeat(32) }`;
            }

            if (method === 'eth_getTransactionReceipt')
            {
                return { status: '0x1' };
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

    useWallet().adopt(provider);
    stopWallet = useWallet().start();
};

const sheet = async (item: string) =>
{
    server.account = { id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false, address: OWNER };
    useSession().establish(server.account);
    await settle();

    const closed: unknown[] = [];
    const { container } = renderTest(() => LookSheet({ item, overlayId: 'look-sheet', close: (result?: unknown) => closed.push(result) }) as unknown as HTMLElement);

    await settle();
    await settle();

    return { root: container, closed };
};

const button = (root: ParentNode, words: string) => [...root.querySelectorAll('button')].find((one) => one.textContent?.trim() === words);

const typeInto = (field: HTMLInputElement, value: string) =>
{
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(Date.parse('2026-10-27T12:00:00.000Z'));
    setRuntime({ clock, seed: 3 });
    equipped.length = 0;
    handed.length = 0;
    forgetVoices();
    useSettings().reset();
    server.reset();
    socket.reset();
    useRealtime().reset();
    useShop().reset();
    useToasts().reset();
    useSocial().reset();
    usePeople().reset();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    stopWallet?.();
    stopWallet = null;
    useShop().reset();
    useWallet().reset();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the sheet about a look', () =>
{
    it('names it, its collection and tier, where it shows and what it costs, and offers Buy and a gift', async () =>
    {
        const { root } = await sheet('pawns.shiraz');

        expect(root.querySelector('h2')?.textContent).toBe('Shiraz Garden pawns');
        expect(root.textContent).toContain('Rare');
        expect(root.textContent).toContain('Your four pawns at Ludo, in your seat’s colour.');
        expect(root.textContent).toContain('Everybody sees it on your things.');
        expect(root.querySelector('img.look-large')?.getAttribute('src')).toBe('/looks/pawns.shiraz.svg');
        expect(button(root, 'Buy for 12 NURA')).toBeDefined();
        expect(button(root, 'Send as a gift')).toBeDefined();
        expect(button(root, 'Use it'), 'nothing to use before it is owned').toBeUndefined();
        expect(root.querySelector('[data-next-game]'), 'when a look is drawn was said beside Buy rather than Use').toBeNull();
    });

    it('marks the look\'s collection with its sigil, and a mythic look with a badge in the light of its edge', async () =>
    {
        const rare = (await sheet('pawns.shiraz')).root;

        expect(rare.querySelector('[data-sigil]')?.getAttribute('src')).toBe('/sigils/shiraz.svg');
        expect(rare.querySelector('.tier-mythic')).toBeNull();
        cleanup();

        const mythic = (await sheet('decoration.inferno')).root;

        expect(mythic.querySelector('[data-sigil]')?.getAttribute('src')).toBe('/sigils/inferno.svg');
        expect(mythic.querySelector('.tier-mythic')?.textContent).toBe('Mythic');
        expect([...mythic.querySelectorAll('p span')].filter((one) => one.textContent?.trim() === 'Mythic'), 'a second badge beside it').toHaveLength(1);
        cleanup();

        const bundle = (await sheet('bundle.oni')).root;

        expect(bundle.querySelector('[data-sigil]')?.getAttribute('src')).toBe('/sigils/oni.svg');
        expect(bundle.querySelector('.tier-mythic')).toBeNull();
    });

    it('offers a look the reader owns for each place it goes, and chooses it at a press', async () =>

    {
        server.shop.owned = [{ item: 'back.glow', via: 'purchase', at: '2026-10-27T11:00:00.000Z' }];
        const { root } = await sheet('back.glow');

        expect(button(root, 'Buy for 12 NURA'), 'nothing to buy once owned').toBeUndefined();

        fire(button(root, 'Use at Hokm')!, 'click');
        await settle();

        expect(server.calls).toContain('shop.choose hokm.back back.glow');
        expect(button(root, 'In use at Hokm')?.getAttribute('aria-pressed')).toBe('true');
        expect(button(root, 'Use at Poker')).toBeDefined();
    });

    it('says beside Use that a look for a table shows from the next game, since a game already on keeps its looks', async () =>
    {
        server.shop.owned = [{ item: 'pawns.glow', via: 'purchase', at: '2026-10-27T11:00:00.000Z' }];
        const { root } = await sheet('pawns.glow');

        expect(root.querySelector('[data-next-game]')?.textContent).toBe('It shows from your next game. A game already being played keeps the looks it began with.');

        fire(button(root, 'Use it')!, 'click');
        await settle();

        expect(button(root, 'In use')?.getAttribute('aria-pressed')).toBe('true');
        expect(root.querySelector('[data-next-game]'), 'the sentence went once the look was in use').not.toBeNull();
    });

    it('says nothing of a next game for a look on the profile, which is drawn at once', async () =>
    {
        server.shop.owned = [{ item: 'decoration.glow', via: 'purchase', at: '2026-10-27T11:00:00.000Z' }];
        const { root } = await sheet('decoration.glow');

        expect(button(root, 'Use it')).toBeDefined();
        expect(root.querySelector('[data-next-game]')).toBeNull();
    });

    it('says when a look for a table shows in Persian', async () =>
    {
        useLocale().setLocale('fa');
        server.shop.owned = [{ item: 'dice.glow', via: 'purchase', at: '2026-10-27T11:00:00.000Z' }];
        const { root } = await sheet('dice.glow');

        expect(root.querySelector('[data-next-game]')?.textContent).toBe('از بازی بعدیت نشون داده می‌شه. بازی‌ای که الان در جریانه همون استایل‌های اولش رو نگه می‌داره.');
    });

    it('plays the look’s burst over its drawing as it is put on somewhere, and none where it is already worn', async () =>
    {
        server.shop.owned = [{ item: 'back.glow', via: 'purchase', at: '2026-10-27T11:00:00.000Z' }];
        const { root } = await sheet('back.glow');
        const drawing = root.querySelector('img.look-large');

        fire(button(root, 'Use at Hokm')!, 'click');

        expect(equipped, 'at the press, over the large drawing').toEqual([{ look: drawing, item: 'back.glow' }]);

        await settle();
        fire(button(root, 'In use at Hokm')!, 'click');

        expect(equipped).toHaveLength(1);

        fire(button(root, 'Use at Poker')!, 'click');

        expect(equipped.map((one) => one.item)).toEqual(['back.glow', 'back.glow']);
    });

    it('hands the burst the sheet’s voices, made under the device’s sound switch, following it, and let go with the sheet', async () =>
    {
        server.shop.owned = [{ item: 'back.glow', via: 'purchase', at: '2026-10-27T11:00:00.000Z' }];
        const { root } = await sheet('back.glow');

        expect(voices.made.map((one) => one.on), 'one handle, on as the switch is').toEqual([true]);

        fire(button(root, 'Use at Hokm')!, 'click');

        expect(handed).toEqual([voices.made[0]!.handle]);

        useSettings().update({ sound: false });
        await settle();

        expect(voices.made[0]!.turned.at(-1)).toBe(false);
        expect(voices.made).toHaveLength(1);

        cleanup();

        expect(voices.made[0]!.disposed).toBe(true);
    });

    it('says why an account with no wallet and one under 18 cannot buy, and offers neither Buy nor a gift', async () =>
    {
        const state = server.shop.state;

        if (state.open)
        {
            server.shop.state = { ...state, may: 'shop-wallet' };
        }

        const wallet = await sheet('dice.glow');

        expect(wallet.root.textContent).toContain('this account has none. A friend can still send you one.');
        expect(button(wallet.root, 'Buy for 12 NURA')).toBeUndefined();
        expect(button(wallet.root, 'Send as a gift')).toBeUndefined();

        cleanup();
        useShop().reset();

        if (state.open)
        {
            server.shop.state = { ...state, may: 'shop-minor' };
        }

        server.account = null;
        useSession().reset();

        const minor = await sheet('dice.gold');

        expect(minor.root.textContent).toContain('Accounts under 18 cannot buy looks.');
        expect(button(minor.root, 'Send as a gift')).toBeUndefined();
    });

    it('walks a purchase: the price, the wallet, NuraChain, and then it is the reader\'s with the look to use', async () =>
    {
        walletWith();
        const { root } = await sheet('dice.glow');

        fire(button(root, 'Buy for 12 NURA')!, 'click');
        await settle();
        await settle();

        expect(root.querySelector('[data-buy-step]')?.getAttribute('data-buy-step')).toBe('chain');
        expect(root.textContent).toContain('Waiting for NuraChain…');
        expect(button(root, 'Buy for 12 NURA'), 'no second purchase while one is on its way').toBeUndefined();

        sellShopOrder(server.shop.orders[0].id);
        clock.advance(SETTLE_MS);
        await settle();
        await settle();

        expect(root.querySelector('[data-buy-step]')?.getAttribute('data-buy-step')).toBe('done');
        expect(root.textContent).toContain('It’s yours.');
        expect(button(root, 'Use at Ludo')).toBeDefined();
        expect(useToasts().items(), 'the sheet says it; no toast as well').toEqual([]);
    });

    it('offers the wallet whose own looks are free the look for nothing, and gives it at the press with no wallet asked', async () =>
    {
        walletWith();

        if (server.shop.state.open)
        {
            server.shop.state = { ...server.shop.state, free: true };
        }

        const { root } = await sheet('dice.glow');

        expect(button(root, 'Buy for 12 NURA'), 'the free wallet was offered a price').toBeUndefined();

        fire(button(root, 'Get it free')!, 'click');
        await settle();
        await settle();

        expect(root.querySelector('[data-buy-step]')?.getAttribute('data-buy-step')).toBe('done');
        expect(root.textContent).toContain('It’s yours.');
        expect(button(root, 'Use at Ludo')).toBeDefined();
        expect(server.calls).toContain('shop.order dice.glow');
        expect(server.shop.orders, 'a free look left an order').toEqual([]);
    });

    it('says a shop that is turned off as that, beside what the look would cost, and offers neither Buy nor a gift', async () =>
    {
        walletWith();
        server.shop.state = closedShop();

        const { root } = await sheet('dice.glow');

        expect(root.querySelector('[data-off="shop"]')?.textContent).toContain('The shop is turned off right now');
        expect(root.textContent).toContain('12 NURA');
        expect(button(root, 'Buy for 12 NURA'), 'a shop that is turned off was offered to buy from').toBeUndefined();
        expect(button(root, 'Send as a gift')).toBeUndefined();
    });

    it('gives the wallet whose own looks are free its look though the shop is turned off', async () =>
    {
        walletWith();
        server.shop.state = { ...closedShop(), free: true };

        const { root } = await sheet('dice.glow');

        expect(root.querySelector('[data-off="shop"]'), 'the free wallet was told the shop is off').toBeNull();
        expect(button(root, 'Send as a gift'), 'a gift is paid for, and nothing is paid for here').toBeUndefined();

        fire(button(root, 'Get it free')!, 'click');
        await settle();
        await settle();

        expect(root.querySelector('[data-buy-step]')?.getAttribute('data-buy-step')).toBe('done');
        expect(server.shop.owned.map((one) => one.item)).toContain('dice.glow');
    });

    it('says a no in the wallet in its own words, and offers Buy again', async () =>
    {
        walletWith(['eth_sendTransaction']);
        const { root } = await sheet('dice.glow');

        fire(button(root, 'Buy for 12 NURA')!, 'click');
        await settle();
        await settle();

        expect(root.querySelector('[role="alert"]')?.textContent).toContain('You said no in your wallet, so nothing was paid.');
        expect(button(root, 'Buy for 12 NURA')).toBeDefined();
    });

    it('says a wallet short of NURA, with the way to get some', async () =>
    {
        walletWith();
        const { root } = await sheet('dice.glow');

        server.shop.refuse = { status: 409, code: 'shop-funds', details: { price: '12000000000000000000' } };
        fire(button(root, 'Buy for 12 NURA')!, 'click');
        await settle();
        await settle();

        const said = root.querySelector('[role="alert"]');

        expect(said?.textContent).toContain('Your wallet does not hold enough NURA for this.');
        expect(said?.querySelector('a')?.getAttribute('href')).toBe('https://nurachain.net');
    });

    it('sends a gift: the reader\'s friends, searched, and an order for the one pressed', async () =>
    {
        walletWith();
        const { root } = await sheet('back.gold');

        fire(button(root, 'Send as a gift')!, 'click');
        await settle();

        expect(root.querySelector('h2')?.textContent).toBe('Send Royal Gold card back to a friend');
        expect(root.querySelectorAll('[data-gift-friends] li').length).toBe(useSocial().friends().length);

        typeInto(root.querySelector('input')!, 'sara');
        await settle();

        const rows = [...root.querySelectorAll('[data-gift-friends] li')];

        expect(rows.map((row) => row.querySelector('[dir="ltr"]')?.textContent)).toEqual(['@sara.k']);

        fire(rows[0].querySelector('button')!, 'click');
        await settle();
        await settle();

        expect(server.calls).toContain('shop.order back.gold for sara.k');
    });

    it('says what a bundle holds, what it saves, and that it is priced for what is lacking', async () =>
    {
        server.shop.owned = [{ item: 'dice.neon', via: 'purchase', at: '2026-10-27T11:00:00.000Z' }];
        const { root } = await sheet('bundle.neon');

        expect(root.querySelector('h2')?.textContent).toBe('Midnight Neon bundle');
        expect(root.textContent).toContain('All 15 looks of this collection');
        expect(root.textContent).toMatch(/\d+% less than buying them one by one/);
        expect(root.textContent).toContain('Priced for the 14 looks you do not have yet');
    });

    it('says it all in Persian', async () =>
    {
        useLocale().setLocale('fa');
        const { root } = await sheet('pawns.shiraz');

        expect(root.querySelector('h2')?.textContent).toBe('مهره‌های منچ باغ شیراز');
        expect(button(root, 'خرید با ۱۲ NURA')).toBeDefined();
        expect(button(root, 'هدیه بده')).toBeDefined();
    });
});
