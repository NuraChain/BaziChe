import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';

import MarketSheet from '../src/components/market/market-sheet.component.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/market-catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import type { Eip1193Provider } from '../src/lib/wallet.ts';
import { routes } from '../src/routes.ts';
import { SETTLE_MS, useMarkets } from '../src/stores/markets.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useWallet } from '../src/stores/wallet.store.ts';
import type { MarketPositionView, MarketView } from '../../backend/src/schemas.ts';
import { server, settleClaim, settlePosition } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const OWNER = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f';
const NURA = 10n ** 18n;

const OPEN = {
    open: true as const,
    may: 'yes' as 'yes' | 'market-wallet' | 'market-minor' | 'market-terms' | 'market-break' | 'market-disclosure',
    presets: [1n, 5n, 10n, 25n, 50n, 100n].map((one) => (one * NURA).toString()),
    least: NURA.toString(),
    most: (500n * NURA).toString(),
    perBettor: (1000n * NURA).toString(),
    perDay: (2000n * NURA).toString(),
    pool: (100_000n * NURA).toString(),
    feeBps: 0,
    window: 90
};

const MARKET: MarketView = {
    id: 'market-1',
    match: 'match-1',
    game: 'chess',
    state: 'open',
    closesAt: '2026-10-28T12:01:30.000Z',
    feeBps: 0,
    minBettors: 2,
    minOutcomes: 2,
    outcomes: [
        { choice: { kind: 'seat', seat: 0, who: 'sara.k' }, pool: (10n * NURA).toString() },
        { choice: { kind: 'seat', seat: 1, who: 'reza.t' }, pool: (30n * NURA).toString() },
        { choice: { kind: 'draw' }, pool: '0' }
    ],
    pool: (40n * NURA).toString(),
    bettors: 3,
    mine: []
};

const mine = (more: Partial<MarketPositionView> = {}): MarketPositionView => ({
    id: 'position-9',
    market: 'market-1',
    match: 'match-1',
    game: 'chess',
    outcome: 1,
    choice: { kind: 'seat', seat: 1, who: 'reza.t' },
    address: OWNER,
    amount: (5n * NURA).toString(),
    state: 'confirmed',
    deadline: '2026-10-28T12:02:00.000Z',
    at: '2026-10-28T12:00:00.000Z',
    ...more
});

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
        children: () => MarketSheet({ match: 'match-1', overlayId: 'market-sheet', close: (result?: unknown) => closed.push(result) })
    }) as unknown as HTMLElement);

    await settle();
    await settle();

    return { root: container, closed };
};

const button = (root: ParentNode, words: string) => [...root.querySelectorAll('button')].find((one) => one.textContent?.trim().replace(/\s+/g, ' ') === words);

const outcome = (root: ParentNode, index: number) => root.querySelector<HTMLButtonElement>(`[data-outcome="${ index }"]`);

const text = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.trim().replace(/\s+/g, ' ') ?? null;

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(Date.parse('2026-10-28T12:00:00.000Z'));
    setRuntime({ clock, seed: 3 });
    server.reset();
    server.markets.state = { ...OPEN };
    server.markets.view = structuredClone(MARKET);
    socket.reset();
    useRealtime().reset();
    useMarkets().reset();
    useToasts().reset();
    usePeople().reset();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    stopWallet?.();
    stopWallet = null;
    useMarkets().reset();
    useWallet().reset();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the market on a watched game', () =>
{
    it('shows each outcome with what the chain holds on it, how long it takes positions, and who is in', async () =>
    {
        const { root } = await sheet();

        expect([0, 1, 2].map((index) => outcome(root, index)?.querySelector('[dir="auto"]')?.textContent)).toEqual(['Sara', 'Reza', 'A draw']);
        expect(outcome(root, 1)?.textContent).toContain('30 NURA in the pool');
        expect(outcome(root, 1)?.textContent).toContain('75% of the pool');
        expect(text(root, '[data-market-when]')).toBe('Taking positions for 1:30');
        expect([...root.querySelectorAll('[data-market-pool] span')].map((one) => one.textContent)).toEqual(['40 NURA in the pool', '3 people in']);

        clock.advance(1000);
        await settle();

        expect(text(root, '[data-market-when]'), 'the clock runs').toBe('Taking positions for 1:29');
    });

    it('names a player nobody has described by their handle, and two partners together', async () =>
    {
        server.markets.view = {
            ...structuredClone(MARKET),
            outcomes: [{ choice: { kind: 'seat', seat: 0, who: 'ghost.z' }, pool: '0' }, { choice: { kind: 'side', seats: [1, 3], who: ['sara.k', 'reza.t'] }, pool: '0' }]
        };

        const { root } = await sheet();

        expect([0, 1].map((index) => outcome(root, index)?.querySelector('[dir="auto"]')?.textContent)).toEqual(['ghost.z', 'Sara and Reza']);
    });

    it('backs the outcome chosen with the amount chosen, in the reader\'s own wallet, and says when it is in', async () =>
    {
        walletWith();
        const { root } = await sheet();

        expect(button(root, 'Choose who you think wins')?.disabled, 'nothing to back until an outcome is chosen').toBe(true);
        expect(root.querySelector('[data-estimate]'), 'nothing estimated until an outcome is chosen').toBeNull();

        outcome(root, 1)?.click();
        await settle();

        expect(outcome(root, 1)?.getAttribute('aria-checked')).toBe('true');
        expect(text(root, '[data-estimate]'), 'what it would bring back as the pool stands: 45 shared by 35 behind it').toBe('If Reza wins, about 6.4285 NURA would come back to you, as the pool stands now. It moves as others back the game.');

        button(root, 'Back Reza with 5 NURA')?.click();
        await settle();
        await settle();

        expect(server.calls).toContain(`markets.place market-1 1 ${ (5n * NURA).toString() }`);
        expect(root.querySelector('[data-place-step="chain"]')?.textContent).toContain('Waiting for NuraChain…');

        settlePosition('position-1', 'confirmed');
        clock.advance(SETTLE_MS);
        await settle();
        await settle();

        expect(text(root, '[data-place-step="done"]')).toBe('You backed Reza with 5 NURA.');
        expect(root.querySelector('[data-yours]')?.textContent, 'the position among the reader\'s own here').toContain('5 NURA on Reza');
    });

    it('takes another amount typed, in Persian digits as well, and says one it cannot take', async () =>
    {
        walletWith();
        const { root } = await sheet();

        outcome(root, 0)?.click();
        root.querySelector<HTMLButtonElement>('[data-other]')?.click();
        await settle();

        const field = root.querySelector<HTMLInputElement>('input')!;

        field.value = '۲٫۵';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await settle();

        expect(button(root, 'Back Sara with 2.5 NURA')).toBeDefined();

        field.value = '9999';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await settle();

        expect(text(root, '[data-bad-amount]')).toBe('Write an amount from 1 to 500 NURA, with four places at most.');
        expect(root.querySelector('[data-estimate]'), 'no estimate for an amount it cannot take').toBeNull();
    });

    it('asks a reader who has not read what a market is to read it first, and lets them back once they have', async () =>
    {
        server.markets.state = { ...OPEN, may: 'market-disclosure' };
        const { root } = await sheet();

        expect(root.querySelector('[data-disclosure]')?.querySelectorAll('li')).toHaveLength(5);
        expect(root.querySelector('[data-preset]'), 'no amount before it is read').toBeNull();

        button(root, 'I understand')?.click();
        await settle();

        expect(server.calls).toContain('markets.disclose');
        expect(root.querySelector('[data-disclosure]')).toBeNull();
        expect(root.querySelector('[data-preset]')).not.toBeNull();
    });

    it('sends a reader without the terms of paid play to their wallet page, and tells one on a break why', async () =>
    {
        server.markets.state = { ...OPEN, may: 'market-terms' };
        let { root } = await sheet();

        expect(root.textContent).toContain('Backing a game asks what playing for NURA asks');
        expect(root.querySelector('a[href="/app/me/wallet"]')).not.toBeNull();
        expect(root.querySelector('[data-preset]')).toBeNull();

        cleanup();
        useMarkets().reset();
        server.markets.state = { ...OPEN, may: 'market-break' };
        ({ root } = await sheet());

        expect(root.textContent).toContain('You asked for a break from playing for NURA.');
        expect(root.querySelector('[data-preset]')).toBeNull();
    });

    it('says a refusal in its own words, and what a short wallet holds with the way to get NURA', async () =>
    {
        walletWith();
        const { root } = await sheet();

        outcome(root, 1)?.click();
        await settle();
        server.markets.refuse = { status: 409, code: 'market-funds', details: { held: (2n * NURA).toString() } };
        button(root, 'Back Reza with 5 NURA')?.click();
        await settle();
        await settle();

        expect(text(root, '[data-place-step="failed"]')).toContain('Your wallet holds 2 NURA, short of 5.');
        expect(root.querySelector('[data-place-step="failed"] a')?.textContent).toBe('Get NURA');
    });

    it('says what a market that stopped taking positions came to, marks the winner, and offers nothing to back', async () =>
    {
        server.markets.view = { ...structuredClone(MARKET), state: 'settled', outcome: 1, claimableAt: '2026-10-28T12:05:00.000Z' };
        const { root } = await sheet();

        expect(text(root, '[data-market-when]')).toBe('Settled: whoever backed Reza shares the pool.');
        expect(outcome(root, 1)?.textContent).toContain('Won');
        expect(outcome(root, 1)?.disabled).toBe(true);
        expect(root.querySelector('[data-preset]')).toBeNull();

        cleanup();
        useMarkets().reset();
        server.markets.view = { ...structuredClone(MARKET), state: 'cancelled' };
        const again = await sheet();

        expect(text(again.root, '[data-market-when]')).toBe('Called off: every stake goes back.');
    });

    it('says there is no market where the game has none', async () =>
    {
        server.markets.view = null;
        const { root } = await sheet();

        expect(root.textContent).toContain('There is no market on this game.');
        expect(root.querySelector('[data-outcomes]')).toBeNull();
        expect(text(root, '[data-market-when]'), 'no clock for a market that is not there').toBe('');
    });

    it('claims what the reader is owed from the wallet that placed it, and says what it paid', async () =>
    {
        walletWith();
        server.markets.view = { ...structuredClone(MARKET), state: 'settled', outcome: 1, claimableAt: '2026-10-28T11:59:00.000Z' };
        server.markets.positions = [mine({ result: 'won', payout: (7n * NURA).toString(), claimableAt: '2026-10-28T11:59:00.000Z' })];
        const { root } = await sheet();

        expect(root.querySelector('[data-yours]')?.textContent).toContain('Won 7 NURA');

        button(root, 'Claim 7 NURA')?.click();
        await settle();
        await settle();

        expect(server.calls).toContain('markets.claim position-9');
        expect(server.calls).toContain('markets.claimSent position-9');

        settleClaim(['position-9'], true);
        clock.advance(SETTLE_MS);
        await settle();
        await settle();

        expect(text(root, '[data-claim-step="done"]')).toBe('Claimed 7 NURA.');
    });

    it('says a claim is done with no amount where the server could not read what it paid', async () =>
    {
        walletWith();
        server.markets.view = { ...structuredClone(MARKET), state: 'settled', outcome: 1, claimableAt: '2026-10-28T11:59:00.000Z' };
        server.markets.positions = [mine({ result: 'won', payout: (7n * NURA).toString(), claimableAt: '2026-10-28T11:59:00.000Z' })];
        const { root } = await sheet();

        button(root, 'Claim 7 NURA')?.click();
        await settle();
        await settle();
        settleClaim(['position-9'], true, false);
        clock.advance(SETTLE_MS);
        await settle();
        await settle();

        expect(text(root, '[data-claim-step="done"]'), 'never "Claimed 0 NURA."').toBe('Claimed');
        expect(root.querySelector('[data-yours]')?.textContent).toContain('Claimed');
    });

    it('offers no claim before the dispute window has passed, and says when it may be made', async () =>
    {
        server.markets.view = { ...structuredClone(MARKET), state: 'settled', outcome: 1, claimableAt: '2026-10-28T12:05:00.000Z' };
        server.markets.positions = [mine({ result: 'won', payout: (7n * NURA).toString(), claimableAt: '2026-10-28T12:05:00.000Z' })];
        const { root } = await sheet();

        expect(button(root, 'Claim 7 NURA')).toBeUndefined();
        expect(text(root, '[data-claim-from]')).toBe('Yours to claim in 5 minutes');
    });

    it('speaks Persian', async () =>
    {
        useLocale().setLocale('fa');
        walletWith();
        const { root } = await sheet();

        expect(root.textContent).toContain('کی می‌بره؟');

        outcome(root, 1)?.click();
        await settle();

        expect([...root.querySelectorAll('button')].some((one) => /NURA روی .+ بذار/.test(one.textContent ?? ''))).toBe(true);
        expect(text(root, '[data-market-when]')).toBe('تا ۱:۳۰ دیگه می‌شه پیش‌بینی کرد');
        expect(text(root, '[data-estimate]')).toMatch(/^اگه .+ ببره، با وضع الان صندوق حدود ۶٫۴۲۸۵ NURA بهت می‌رسه\./);
    });

    it('lets go of the market it read once it is closed', async () =>
    {
        await sheet();

        expect(useMarkets().view()).not.toBeNull();

        cleanup();
        await settle();

        expect(useMarkets().view()).toBeNull();
    });
});
