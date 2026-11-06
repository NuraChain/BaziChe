import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';

import { buildApp } from '../src/app.ts';
import type { Principal } from '../src/http/auth.ts';
import type { ServerConfig } from '../src/env.ts';
import type { Ports } from '../src/ports.ts';

/**
 * A guest session is signed in with a key the browser holds, and has nothing on chain: every
 * state read says the feature is off, and every call that would be composed for a wallet is
 * refused, whatever the browser sends.
 */

const silent = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => silent
} as unknown as Parameters<typeof buildApp>[0]['log'];

const config = {
    port: 0,
    env: 'test',
    databaseUrl: '',
    databasePoolMax: 1,
    secret: 'test-secret',
    origin: 'http://localhost:3100',
    chainId: '',
    rpcUrl: '',
    servePages: false
} as unknown as ServerConfig;

const db = { isInitialized: true, query: () => Promise.resolve([]) } as unknown as DataSource;

const GUEST: Principal = { userId: 'somebody', handle: 'somebody', isMinor: false, sessionId: 'a-session', guest: true };

const WALLET: Principal = { userId: 'somebody', handle: 'somebody', isMinor: false, sessionId: 'a-session' };

const ACCOUNT = { id: 'somebody', handle: 'somebody', displayName: 'Somebody', bio: '', hue: 10, isMinor: false, address: '0x0000000000000000000000000000000000000001' };

const CALL = { from: ACCOUNT.address, to: ACCOUNT.address, data: '0x', value: '0', chainId: 1020 };

const OPEN_SHOP = { open: true, chainId: 1020, items: [], featured: 'glow', may: 'yes' };

function appFor(who: Principal, reached: string[])
{
    const reach = <T>(name: string, answer: T) => () =>
    {
        reached.push(name);
        return Promise.resolve(answer);
    };

    return buildApp({
        db,
        config,
        log: silent,
        ports: {
            identity: {
                secureCookies: false,
                principal: () => Promise.resolve(who),
                me: () => Promise.resolve(ACCOUNT),
                setProfile: () => Promise.resolve(ACCOUNT)
            },
            vault: { state: reach('vault.state', { configured: false }), deposit: reach('vault.deposit', CALL), withdraw: reach('vault.withdraw', CALL) },
            shop: { state: reach('shop.state', OPEN_SHOP), purchase: reach('shop.purchase', {}), claim: reach('shop.claim', CALL) },
            donate: { state: reach('donate.state', { open: true }), prepare: reach('donate.prepare', {}) },
            markets: { state: reach('markets.state', { open: true }), place: reach('markets.place', {}) },
            invites: { earnings: reach('invites.earnings', { tables: true, share: 1, fee: 1, earned: '0' }) },
            table: { stake: reach('table.stake', { typedData: '{}', deadline: '0' }), quickStake: reach('table.quickStake', { typedData: '{}', deadline: '0' }) },
            chain: { configured: true, registry: '0xregistry', chainId: '1020', profile: reach('chain.profile', null), record: reach('chain.record', ''), publish: reach('chain.publish', []) }
        } as unknown as Ports
    });
}

const get = (app: ReturnType<typeof buildApp>, path: string) => app.handle(new Request(`http://local/api${ path }`));

const post = (app: ReturnType<typeof buildApp>, path: string, body: unknown = {}) =>
    app.handle(new Request(`http://local/api${ path }`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

describe('a guest session', () =>
{
    it('is told it is a guest, on its own account', async () =>
    {
        const guest = await (await get(appFor(GUEST, []), '/auth/me')).json() as { account: { guest?: boolean } };
        const wallet = await (await get(appFor(WALLET, []), '/auth/me')).json() as { account: { guest?: boolean } };

        expect(guest.account.guest).toBe(true);
        expect(wallet.account).not.toHaveProperty('guest');
    });

    it('stays a guest across a profile write', async () =>
    {
        const written = await (await post(appFor(GUEST, []), '/auth/profile', { displayName: 'Somebody', bio: '' })).json() as { guest?: boolean };

        expect(written.guest).toBe(true);
    });

    it('reads every chain feature as off, without asking the chain', async () =>
    {
        const reached: string[] = [];
        const app = appFor(GUEST, reached);

        expect(await (await get(app, '/vault')).json()).toEqual({ configured: false });
        expect(await (await get(app, '/donations')).json()).toEqual({ open: false });
        expect(await (await get(app, '/markets')).json()).toEqual({ open: false });
        expect(await (await get(app, '/invites/earnings')).json()).toEqual({ tables: false });
        expect(await (await get(app, '/chain/profile')).json()).toEqual({ configured: false, registry: '', chainId: '', record: '' });
        expect(await (await get(app, '/shop')).json()).toEqual({ open: false, items: [], featured: 'glow', may: 'yes' });
        expect(reached).toEqual(['shop.state']);
    });

    it('is refused everything that would be composed for a wallet, before anything is composed', async () =>
    {
        const reached: string[] = [];
        const app = appFor(GUEST, reached);
        const asks: [string, unknown][] = [
            ['/vault/deposit', { amount: '1' }],
            ['/vault/withdraw', { amount: '1' }],
            ['/shop/earnings/claim', {}],
            ['/chain/profile/publish', {}],
            ['/tables/a-table/stake', {}],
            ['/tables/quick/stake', { game: 'ludo', stake: '1' }]
        ];

        for (const [path, body] of asks)
        {
            const response = await post(app, path, body);

            expect(response.status, path).toBe(403);
            expect(await response.json(), path).toMatchObject({ error: { code: 'guest-offline' } });
        }
        expect(reached).toEqual([]);
    });

    it('leaves a wallet session as it was', async () =>
    {
        const reached: string[] = [];
        const app = appFor(WALLET, reached);

        expect(await (await get(app, '/vault')).json()).toEqual({ configured: false });
        expect((await post(app, '/vault/deposit', { amount: '1' })).status).toBe(200);
        expect(reached).toEqual(['vault.state', 'vault.deposit']);
    });
});
