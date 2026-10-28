import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { claimsOf, estimateOf } from '../src/lib/market.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import type { Eip1193Provider } from '../src/lib/wallet.ts';
import '../src/locales/app-catalogue.ts';
import '../src/locales/market-catalogue.ts';
import { CLAIM_WAIT_MS, SETTLE_MS, useMarkets } from '../src/stores/markets.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useWallet } from '../src/stores/wallet.store.ts';
import type { Account, MarketPositionView, MarketView } from '../../backend/src/schemas.ts';
import { NURA_MARKETS, client, server, settleClaim, settlePosition } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const OWNER = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f';
const OTHER = '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf';
const HASH = `0x${ 'ab'.repeat(32) }`;
const NURA = 10n ** 18n;
const FIVE = (5n * NURA).toString();

const OPEN = {
    open: true as const,
    may: 'yes' as 'yes' | 'market-region' | 'market-wallet' | 'market-minor' | 'market-terms' | 'market-break' | 'market-disclosure',
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

interface Held
{
    calls: { method: string; params: unknown }[];
    chain: string;
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
    const held: Held = { calls: [], chain, refuse: new Set() };
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
    const account: Account = { id: `u-back-${ seq }`, handle: `backer${ seq }`, displayName: 'Dana', bio: '', hue: 12, isMinor: false, address: OWNER };
    server.account = account;
    useSession().establish(account);
    useWallet().adopt(wallet.provider);
    stopWallet = useWallet().start();
    await settle();
};

const methods = (held: Held) => held.calls.map((call) => call.method);

const tick = async (ms = SETTLE_MS) =>
{
    clock.advance(ms);
    await settle();
};

const won = (id: string, more: Partial<MarketPositionView> = {}): MarketPositionView => ({
    id,
    market: 'market-1',
    match: 'match-1',
    game: 'chess',
    outcome: 1,
    choice: { kind: 'seat', seat: 1, who: 'reza.t' },
    address: OWNER,
    amount: FIVE,
    state: 'confirmed',
    deadline: '2026-10-28T12:02:00.000Z',
    at: '2026-10-28T12:00:00.000Z',
    result: 'won',
    payout: (7n * NURA).toString(),
    claimableAt: '2026-10-28T12:05:00.000Z',
    ...more
});

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(Date.parse('2026-10-28T12:00:00.000Z'));
    setRuntime({ clock, seed: 3 });
    server.reset();
    server.markets.state = { ...OPEN };
    server.markets.view = structuredClone(MARKET);
    useRealtime().reset();
    socket.reset();
    useMarkets().reset();
    useToasts().reset();
});

afterEach(() =>
{
    stopWallet?.();
    stopWallet = null;
    useMarkets().reset();
    useWallet().reset();
    useSession().reset();
});

describe('markets, as the browser holds them', () =>
{
    it('reads whether they are open and offers them only where the reader may be shown one', async () =>
    {
        await signIn(walletAt(OWNER));

        expect(useMarkets().state()).toEqual(OPEN);
        expect(useMarkets().offered()).toBe(true);

        for (const may of ['market-region', 'market-minor', 'market-wallet'] as const)
        {
            server.markets.state = { ...OPEN, may };
            useMarkets().reset();
            await signIn(walletAt(OWNER));

            expect(useMarkets().offered(), may).toBe(false);
        }

        for (const may of ['market-terms', 'market-break', 'market-disclosure'] as const)
        {
            server.markets.state = { ...OPEN, may };
            useMarkets().reset();
            await signIn(walletAt(OWNER));

            expect(useMarkets().offered(), `${ may }: offered, and told why in the sheet`).toBe(true);
        }

        server.markets.state = { open: false };
        useMarkets().reset();
        await signIn(walletAt(OWNER));

        expect(useMarkets().offered()).toBe(false);
    });

    it('shows the disclosure read at the press, and keeps what the server said', async () =>
    {
        server.markets.state = { ...OPEN, may: 'market-disclosure' };
        await signIn(walletAt(OWNER));

        let free: () => void = () => undefined;
        server.markets.hold = new Promise((resolve) =>
        {
            free = resolve;
        });

        const reading = useMarkets().disclose();

        expect(useMarkets().state()).toMatchObject({ may: 'yes' });

        free();

        expect(await reading).toBe(true);
        expect(server.calls).toContain('markets.disclose');
        expect(useMarkets().state()).toMatchObject({ may: 'yes' });
    });

    it('takes a refused disclosure back and says why in its own words', async () =>
    {
        server.markets.state = { ...OPEN, may: 'market-disclosure' };
        await signIn(walletAt(OWNER));
        server.markets.refuse = { status: 404, code: 'market-off' };

        expect(await useMarkets().disclose()).toBe(false);
        expect(useMarkets().state()).toMatchObject({ may: 'market-disclosure' });
        expect(useToasts().items().map((toast) => toast.text)).toContain('Markets are not open here.');
    });

    it('reads the market on the game it holds, nothing for a game with none, and lets go when released', async () =>
    {
        await signIn(walletAt(OWNER));

        const release = useMarkets().watch('match-1');
        await settle();

        expect(server.calls).toContain('markets.game match-1');
        expect(useMarkets().view()).toMatchObject({ id: 'market-1', pool: MARKET.pool });

        const other = useMarkets().watch('match-2');
        await settle();

        expect(useMarkets().view(), 'a game with no market is nothing, not a failure').toBeNull();
        expect(useMarkets().viewFailed()).toBe(false);

        other();
        await settle();

        expect(useMarkets().view(), 'the game still held is read again').toMatchObject({ id: 'market-1' });

        release();
        await settle();

        expect(useMarkets().view()).toBeNull();
    });

    it('asks nothing about a game for a reader markets are not offered to', async () =>
    {
        server.markets.state = { ...OPEN, may: 'market-region' };
        await signIn(walletAt(OWNER));

        useMarkets().watch('match-1');
        await settle();

        expect(server.calls.filter((call) => call.startsWith('markets.game'))).toEqual([]);
    });

    it('reads the market again when the reader is rung about markets', async () =>
    {
        await signIn(walletAt(OWNER));
        const unlisten = useMarkets().listen();
        useRealtime().start();
        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        useMarkets().watch('match-1');
        await settle();

        const before = server.calls.filter((call) => call === 'markets.game match-1').length;

        server.markets.view = { ...structuredClone(MARKET), pool: (41n * NURA).toString() };
        socket.deliver({ v: 1, t: 'nudge', n: 1, at: 0, scope: 'me', id: 'markets' });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls.filter((call) => call === 'markets.game match-1').length).toBeGreaterThan(before);
        expect(useMarkets().view()?.pool).toBe((41n * NURA).toString());

        unlisten();
    });
});

describe('a position', () =>
{
    it('is prepared, handed to the bettor\'s wallet on its chain, nudged, and done once NuraChain holds it', async () =>
    {
        const wallet = walletAt(OWNER, '0x1');
        await signIn(wallet);
        useMarkets().watch('match-1');
        await settle();

        const placing = useMarkets().place('market-1', 1, FIVE);
        await settle();
        await settle();

        const sent = wallet.held.calls.find((call) => call.method === 'eth_sendTransaction');

        expect(server.calls).toContain(`markets.place market-1 1 ${ FIVE }`);
        expect(wallet.held.calls.find((call) => call.method === 'wallet_switchEthereumChain')?.params).toEqual([{ chainId: '0x7a69' }]);
        expect(sent?.params).toEqual([{ from: OWNER, to: NURA_MARKETS, data: '0xplace', value: `0x${ (5n * NURA).toString(16) }` }]);
        expect(server.calls).toContain('markets.sent position-1');
        expect(useMarkets().placing()).toMatchObject({ market: 'market-1', outcome: 1, amount: FIVE, step: 'chain', hash: HASH, chainId: 31337 });

        const reads = server.calls.filter((call) => call === 'markets.game match-1').length;

        settlePosition('position-1', 'confirmed');
        await tick();
        await placing;

        expect(useMarkets().placing()).toMatchObject({ step: 'done', said: null, position: { state: 'confirmed' } });
        expect(server.calls.filter((call) => call === 'markets.game match-1').length, 'the market read again once it is in').toBeGreaterThan(reads);
    });

    it('is answered with the first while one is on its way', async () =>
    {
        await signIn(walletAt(OWNER));

        const first = useMarkets().place('market-1', 1, FIVE);
        const second = useMarkets().place('market-1', 0, FIVE);

        expect(second).toBe(first);

        await settle();

        expect(server.calls.filter((call) => call.startsWith('markets.place'))).toEqual([`markets.place market-1 1 ${ FIVE }`]);
    });

    it('says a refusal in its own word, and what a short wallet holds', async () =>
    {
        await signIn(walletAt(OWNER));
        server.markets.refuse = { status: 409, code: 'market-funds', details: { held: (2n * NURA).toString() } };

        await useMarkets().place('market-1', 1, FIVE);

        expect(useMarkets().placing()).toMatchObject({ step: 'failed', said: 'market.refused.market-funds', held: (2n * NURA).toString() });

        useMarkets().forget();
        server.markets.refuse = { status: 409, code: 'market-limit', details: { limit: 'day' } };

        await useMarkets().place('market-1', 1, FIVE);

        expect(useMarkets().placing(), 'a limit says which').toMatchObject({ step: 'failed', said: 'market.limit.day' });

        useMarkets().forget();
        server.markets.refuse = { status: 503, code: 'chain-unreachable' };

        await useMarkets().place('market-1', 1, FIVE);

        expect(useMarkets().placing()).toMatchObject({ step: 'failed', said: 'market.unreached' });
    });

    it('sends nothing when the wallet says no, or holds another account', async () =>
    {
        const declining = walletAt(OWNER);
        declining.held.refuse.add('eth_sendTransaction');
        await signIn(declining);

        await useMarkets().place('market-1', 1, FIVE);

        expect(useMarkets().placing()).toMatchObject({ step: 'failed', said: 'market.wallet.rejected' });
        expect(server.calls.filter((call) => call.startsWith('markets.sent'))).toEqual([]);

        useMarkets().reset();
        useWallet().reset();
        stopWallet?.();

        const elsewhere = walletAt(OTHER);
        await signIn(elsewhere);

        await useMarkets().place('market-1', 1, FIVE);

        expect(useMarkets().placing()).toMatchObject({ step: 'failed', said: 'vault.wrongAccount' });
        expect(methods(elsewhere.held)).not.toContain('eth_sendTransaction');
    });

    it('is waited for until its deadline by the server\'s clock, however far ahead the device\'s runs', async () =>
    {
        await signIn(walletAt(OWNER));
        useRealtime().start();
        socket.accept();
        socket.deliver({ v: 1, t: 'hello', n: 1, rt: 'nura-rt/v1', self: 'backer', at: clock.now() - 10 * 60_000 });

        const placing = useMarkets().place('market-1', 1, FIVE);
        await settle();
        await settle();

        for (let minute = 0; minute < 9; minute += 1)
        {
            await tick(60_000);
        }

        settlePosition('position-1', 'confirmed');
        await tick();
        await placing;

        expect(useMarkets().placing(), 'nine minutes on, the server\'s clock is still short of the deadline').toMatchObject({ step: 'done' });
    });

    it('says a position that ran out unplaced, and one the chain refused', async () =>
    {
        await signIn(walletAt(OWNER));

        const lapsing = useMarkets().place('market-1', 1, FIVE);
        await settle();
        await settle();
        settlePosition('position-1', 'expired');
        await tick();
        await lapsing;

        expect(useMarkets().placing()).toMatchObject({ step: 'failed', said: 'market.step.lapsed' });

        useMarkets().forget();

        const refused = useMarkets().place('market-1', 0, FIVE);
        await settle();
        await settle();
        settlePosition('position-2', 'reverted', 'MarketClosed');
        await tick();
        await refused;

        expect(useMarkets().placing()).toMatchObject({ step: 'failed', said: 'market.step.reverted' });
    });

    it('leaves nothing ticking after a reset', async () =>
    {
        await signIn(walletAt(OWNER));

        void useMarkets().place('market-1', 1, FIVE);
        await settle();
        await settle();

        useMarkets().reset();

        expect(clock.pending(), 'no clock of its own left waiting').toBe(0);

        const asked = server.calls.length;

        await tick();
        await tick();

        expect(server.calls.length).toBe(asked);
        expect(useMarkets().placing()).toBeNull();
    });
});

describe('a claim', () =>
{
    it('is composed, sent from the wallet that placed it, handed in, and done once its receipt is read', async () =>
    {
        const wallet = walletAt(OWNER);
        await signIn(wallet);
        server.markets.positions = [won('position-9')];

        const claiming = useMarkets().claim(['position-9']);
        await settle();
        await settle();

        expect(server.calls).toContain('markets.claim position-9');
        expect(wallet.held.calls.find((call) => call.method === 'eth_sendTransaction')?.params).toEqual([{ from: OWNER, to: NURA_MARKETS, data: '0xclaim', value: '0x0' }]);
        expect(server.calls).toContain('markets.claimSent position-9');
        expect(useMarkets().claiming()).toMatchObject({ step: 'chain', hash: HASH });

        settleClaim(['position-9'], true);
        await tick();
        await claiming;

        expect(useMarkets().claiming()).toMatchObject({ step: 'done', paid: (7n * NURA).toString() });
    });

    it('hands the hash in again when the server could not be told the first time', async () =>
    {
        await signIn(walletAt(OWNER));
        server.markets.positions = [won('position-9')];

        const claimSent = vi.spyOn(client.markets, 'claimSent').mockRejectedValueOnce(new Error('dropped'));
        const claiming = useMarkets().claim(['position-9']);
        await settle();
        await settle();

        expect(useMarkets().claiming()).toMatchObject({ step: 'chain' });

        await tick();

        expect(claimSent).toHaveBeenCalledTimes(2);

        settleClaim(['position-9'], true);
        await tick();
        await claiming;

        expect(useMarkets().claiming()).toMatchObject({ step: 'done' });
        claimSent.mockRestore();
    });

    it('says a claim that NuraChain did not pay, and gives up once it has waited long enough', async () =>
    {
        await signIn(walletAt(OWNER));
        server.markets.positions = [won('position-9')];

        const reverted = useMarkets().claim(['position-9']);
        await settle();
        await settle();
        settleClaim(['position-9'], false);
        await tick();
        await reverted;

        expect(useMarkets().claiming()).toMatchObject({ step: 'failed', said: 'market.claimRefused' });

        useMarkets().forget();

        const waiting = useMarkets().claim(['position-9']);
        await settle();
        await settle();
        await tick(CLAIM_WAIT_MS + SETTLE_MS);
        await waiting;

        expect(useMarkets().claiming(), 'still on its way when it was given up on').toMatchObject({ step: 'chain' });
    });

    it('says a claim the server would not compose', async () =>
    {
        await signIn(walletAt(OWNER));
        server.markets.refuse = { status: 409, code: 'market-unclaimable' };

        await useMarkets().claim(['position-9']);

        expect(useMarkets().claiming()).toMatchObject({ step: 'failed', said: 'market.refused.market-unclaimable' });
    });
});

describe('what a stake would bring back', () =>
{
    it('is the pool with the stake in it, less the fee, by the stake\'s share of everybody behind that outcome', () =>
    {
        expect(estimateOf((40n * NURA).toString(), (30n * NURA).toString(), (5n * NURA).toString(), 0)).toBe((45n * NURA * 5n) / 35n);
        expect(estimateOf('0', '0', (5n * NURA).toString(), 0), 'alone in an empty pool, the stake').toBe(5n * NURA);
        expect(estimateOf((40n * NURA).toString(), (30n * NURA).toString(), (5n * NURA).toString(), 500)).toBe(((45n * NURA - (45n * NURA * 500n) / 10_000n) * 5n) / 35n);
    });
});

describe('what can be claimed now', () =>
{
    const due = (now: number) => (serverAt: number) => serverAt <= now;

    it('is every stake that goes back at once and every winner past the dispute window, a claim a wallet', () =>
    {
        const refund = won('r', { result: 'refund', payout: FIVE, claimableAt: undefined });
        const early = won('w1');
        const other = won('w2', { address: OTHER, payout: (3n * NURA).toString(), claimableAt: '2026-10-28T11:59:00.000Z' });
        const lost = won('l', { result: 'lost', payout: undefined });
        const claimed = won('c', { claimedAt: '2026-10-28T12:10:00.000Z', payout: undefined, paid: FIVE });
        const going = won('g', { result: 'refund', payout: FIVE, claimableAt: undefined, claimHash: HASH });
        const now = Date.parse('2026-10-28T12:00:00.000Z');

        expect(claimsOf([refund, early, other, lost, claimed, going], due(now))).toEqual([
            { address: OWNER, ids: ['r'], total: 5n * NURA },
            { address: OTHER, ids: ['w2'], total: 3n * NURA }
        ]);
        expect(claimsOf([refund, early], due(Date.parse('2026-10-28T12:05:00.000Z')))).toEqual([{ address: OWNER, ids: ['r', 'w1'], total: 12n * NURA }]);
    });

    it('names at most fifty positions in one claim', () =>
    {
        const many = Array.from({ length: 52 }, (_, index) => won(`p${ index }`, { result: 'refund', claimableAt: undefined, payout: NURA.toString() }));

        expect(claimsOf(many, () => true)[0].ids).toHaveLength(50);
    });
});
