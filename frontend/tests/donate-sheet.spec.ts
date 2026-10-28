import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';

import DonateSheet from '../src/components/donate/donate-sheet.component.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/donate-catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import type { Eip1193Provider } from '../src/lib/wallet.ts';
import { SETTLE_MS, useDonations } from '../src/stores/donations.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useWallet } from '../src/stores/wallet.store.ts';
import { server, settleDonation } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const OWNER = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f';
const NURA = 10n ** 18n;

const OPEN = {
    open: true as const,
    accepting: true,
    may: 'yes' as 'yes' | 'donate-wallet' | 'donate-minor' | 'donate-terms' | 'donate-break',
    presets: [1n, 5n, 10n, 25n, 50n, 100n].map((one) => (one * NURA).toString()),
    least: NURA.toString(),
    most: (1000n * NURA).toString()
};

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

const sheet = async () =>
{
    server.account = { id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false, address: OWNER };
    useSession().establish(server.account);
    await settle();

    const closed: unknown[] = [];
    const router = createRouter({ routes, history: createMemoryHistory('/app/play/t-1'), scroll: false });
    const { container } = renderTest(() => RouterProvider({
        router,
        children: () => DonateSheet({ match: 'm-1', to: 'sara.k', overlayId: 'donate-sheet', close: (result?: unknown) => closed.push(result) })
    }) as unknown as HTMLElement);

    await settle();
    await settle();

    return { root: container, closed };
};

const button = (root: ParentNode, words: string) => [...root.querySelectorAll('button')].find((one) => one.textContent?.trim() === words);

const preset = (root: ParentNode, nura: bigint) => root.querySelector<HTMLButtonElement>(`[data-preset="${ (nura * NURA).toString() }"]`);

const typeInto = (field: HTMLInputElement, value: string) =>
{
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(Date.parse('2026-10-28T12:00:00.000Z'));
    setRuntime({ clock, seed: 3 });
    server.reset();
    server.donate.state = { ...OPEN };
    socket.reset();
    useRealtime().reset();
    useDonations().reset();
    useToasts().reset();
    usePeople().reset();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    stopWallet?.();
    stopWallet = null;
    useDonations().reset();
    useWallet().reset();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the sheet that sends NURA to a player', () =>
{
    it('names the player, says where the NURA goes, and offers the amounts with five chosen', async () =>
    {
        const { root } = await sheet();

        expect(root.textContent).toContain('Send NURA to sara.k');
        expect(root.textContent).toContain('It goes from your wallet straight to theirs. Baziche keeps none of it');
        expect([...root.querySelectorAll('[data-preset]')].map((one) => one.textContent?.trim())).toEqual(['1 NURA', '5 NURA', '10 NURA', '25 NURA', '50 NURA', '100 NURA']);
        expect(preset(root, 5n)?.getAttribute('aria-pressed')).toBe('true');
        expect(button(root, 'Send 5 NURA')).toBeDefined();
    });

    it('sends the amount chosen to the player of the game it was opened for', async () =>
    {
        walletWith();
        const { root } = await sheet();

        preset(root, 25n)!.click();
        await settle();
        button(root, 'Send 25 NURA')!.click();
        await settle();
        await settle();

        expect(server.calls).toContain(`donations.give m-1 sara.k ${ (25n * NURA).toString() }`);
        expect(root.querySelector('[data-give-step="chain"]')?.textContent).toContain('Waiting for NuraChain…');

        settleDonation('gift-1', 'confirmed');
        clock.advance(SETTLE_MS);
        await settle();

        expect(root.querySelector('[data-give-step="done"]')?.textContent).toContain('sara.k has 25 NURA from you.');
        expect(button(root, 'Send 25 NURA'), 'nothing more to send once it is given').toBeUndefined();
    });

    it('takes another amount to four places within the range, and says what is wrong with one that is not', async () =>
    {
        const { root } = await sheet();

        button(root, 'Another amount')!.click();
        await settle();

        const field = root.querySelector<HTMLInputElement>('input')!;

        typeInto(field, '2.5');
        await settle();

        expect(button(root, 'Send 2.5 NURA')).toBeDefined();
        expect(root.querySelector('[data-bad-amount]')).toBeNull();

        for (const bad of ['0.5', '1001', '1.23456', 'five'])
        {
            typeInto(field, bad);
            await settle();

            expect(root.querySelector('[data-bad-amount]')?.textContent, bad).toBe('Write an amount from 1 to 1,000 NURA, with four places at most.');
            expect([...root.querySelectorAll('button')].find((one) => one.textContent?.trim().startsWith('Send'))?.hasAttribute('disabled'), bad).toBe(true);
        }

        typeInto(field, '۳٫۲۵');
        await settle();

        expect(button(root, 'Send 3.25 NURA'), 'Persian digits are read as digits').toBeDefined();
    });

    it('says a wallet short of the gift with what it holds, and where NURA is had', async () =>
    {
        walletWith();
        const { root } = await sheet();

        server.donate.refuse = { status: 409, code: 'donate-funds', details: { amount: (5n * NURA).toString(), held: (2n * NURA).toString() } };

        button(root, 'Send 5 NURA')!.click();
        await settle();

        const failed = root.querySelector('[data-give-step="failed"]');

        expect(failed?.textContent).toContain('Your wallet holds 2 NURA, short of 5.');
        expect(failed?.querySelector('a')?.textContent).toBe('Get NURA');
        expect(button(root, 'Send 5 NURA'), 'the amount can be sent again').toBeDefined();
    });

    it('says a refusal in its own words', async () =>
    {
        walletWith();
        const { root } = await sheet();

        server.donate.refuse = { status: 409, code: 'donate-playing' };

        button(root, 'Send 5 NURA')!.click();
        await settle();

        expect(root.querySelector('[data-give-step="failed"]')?.textContent).toBe('You are playing in this game, so you cannot send NURA to anybody in it.');
    });

    it('sends a reader who has not confirmed the terms to the wallet page, and offers no amount', async () =>
    {
        server.donate.state = { ...OPEN, may: 'donate-terms' };
        const { root, closed } = await sheet();

        const link = [...root.querySelectorAll('a')].find((one) => one.textContent === 'Open your wallet page');

        expect(root.textContent).toContain('Giving NURA asks what playing for NURA asks');
        expect(link?.getAttribute('href')).toBe('/app/me/wallet');
        expect(root.querySelector('[data-preset]')).toBeNull();

        link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));

        expect(closed).toHaveLength(1);
    });

    it('tells a reader on a break that giving waits with it', async () =>
    {
        server.donate.state = { ...OPEN, may: 'donate-break' };
        const { root } = await sheet();

        expect(root.textContent).toContain('You asked for a break from playing for NURA.');
        expect(root.querySelector('[data-preset]')).toBeNull();
    });

    it('speaks Persian to a Persian reader, digits and all', async () =>
    {
        useLocale().setLocale('fa');
        const { root } = await sheet();

        expect(root.textContent).toContain('واسه sara.k NURA بفرست');
        expect(preset(root, 5n)?.textContent?.trim()).toBe('۵ NURA');
        expect(button(root, '۵ NURA بفرست')).toBeDefined();
    });
});
