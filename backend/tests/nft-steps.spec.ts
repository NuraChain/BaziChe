import type { Address, Hex } from 'viem';
import { describe, expect, it } from 'vitest';

import { tokenIdOf, type NftChain, type Sent } from '../src/chain/minting.ts';
import type { Mined } from '../src/chain/vault.ts';
import { NFT_ATTEMPTS_MOST, NFT_LOST_AFTER_MS } from '../src/domains/nft/rules.ts';
import { awardAchievement, burnLook, MinterNotGranted, mintLooks, settleSent, type TokenRow } from '../src/domains/nft/steps.ts';

/**
 * What the NFT worker does with each token, against a chain that answers as told: read before
 * sending so nothing is sent twice, a refusal by name, a reverted send tried again, and the
 * refusals no retry changes put aside.
 */

const OWNER: Address = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const HASH: Hex = `0x${ 'ab'.repeat(32) }`;

interface World
{
    held: Set<string>;
    earned: Set<string>;
    defined: Set<string>;
    mined: Mined;
    refuse: string | null;
    sent: { call: string; args: unknown[] }[];
}

const world = (over: Partial<World> = {}): World => ({ held: new Set(), earned: new Set(), defined: new Set(), mined: 'pending', refuse: null, sent: [], ...over });

const chainOf = (w: World): NftChain =>
{
    const send = (call: string, ...args: unknown[]): Promise<Sent> =>
    {
        if (w.refuse !== null)
        {
            return Promise.resolve({ ok: false, refusal: w.refuse });
        }

        w.sent.push({ call, args });
        return Promise.resolve({ ok: true, hash: HASH });
    };

    return {
        configured: true,
        chainId: 31337,
        looks: OWNER,
        achievements: OWNER,
        minter: null,
        contracts: [],
        standing: () => Promise.reject(new Error('Roles are not asked here.')),
        roleCall: () => Promise.reject(new Error('Roles are not asked here.')),
        transactionOf: () => Promise.resolve(null),
        holdsLook: (_owner, id) => Promise.resolve(w.held.has(id)),
        earned: (_player, id) => Promise.resolve(w.earned.has(id)),
        defined: (id) => Promise.resolve(w.defined.has(id)),
        mintLooks: (owner, ids) => send('mintLooks', owner, ids),
        burnLook: (owner, id) => send('burnLook', owner, id),
        define: (key) => send('define', key),
        award: (player, id) => send('award', player, id),
        mined: () => Promise.resolve(w.mined)
    };
};

const look = (key: string, over: Partial<TokenRow> = {}): TokenRow => ({
    id: `t-${ key }`,
    collection: 'look',
    key,
    tokenId: tokenIdOf(key),
    address: OWNER,
    state: 'minting',
    hash: null,
    attempts: 0,
    sentAt: Date.now(),
    ...over
});

const legend = (over: Partial<TokenRow> = {}): TokenRow => ({ ...look('ludo-won-97', over), collection: 'achievement', id: 't-legend', ...over });

describe('minting looks', () =>
{
    it('sends the looks a wallet lacks in one transaction, and marks those it holds already without sending them again', async () =>
    {
        const w = world({ held: new Set([tokenIdOf('back.neon')]) });
        const done = await mintLooks([look('dice.shiraz'), look('back.neon'), look('theme.gold')], chainOf(w));

        expect(w.sent).toEqual([{ call: 'mintLooks', args: [OWNER, [tokenIdOf('dice.shiraz'), tokenIdOf('theme.gold')]] }]);
        expect(done.sent).toBe(true);
        expect(Object.fromEntries(done.changes)).toEqual({
            't-dice.shiraz': { hash: HASH, failure: null },
            't-back.neon': { state: 'minted', failure: null },
            't-theme.gold': { hash: HASH, failure: null }
        });
    });

    it('sends nothing when the wallet holds every one: the send before a crash that was never written down', async () =>
    {
        const w = world({ held: new Set([tokenIdOf('dice.shiraz')]) });
        const done = await mintLooks([look('dice.shiraz')], chainOf(w));

        expect(w.sent).toEqual([]);
        expect(done.sent).toBe(false);
        expect(done.changes.get('t-dice.shiraz')).toEqual({ state: 'minted', failure: null });
    });

    it('puts aside a wallet that takes no ERC-1155 at once, and counts any other refusal until it has been tried enough', async () =>
    {
        const shut = await mintLooks([look('dice.shiraz')], chainOf(world({ refuse: 'ERC1155InvalidReceiver' })));
        expect(shut.changes.get('t-dice.shiraz')).toEqual({ attempts: 1, failure: 'ERC1155InvalidReceiver', state: 'failed' });

        const once = await mintLooks([look('dice.shiraz')], chainOf(world({ refuse: 'reverted' })));
        expect(once.changes.get('t-dice.shiraz')).toEqual({ attempts: 1, failure: 'reverted' });

        const last = await mintLooks([look('dice.shiraz', { attempts: NFT_ATTEMPTS_MOST - 1 })], chainOf(world({ refuse: 'reverted' })));
        expect(last.changes.get('t-dice.shiraz')).toEqual({ attempts: NFT_ATTEMPTS_MOST, failure: 'reverted', state: 'failed' });
    });

    it('stops the pass, counting nothing against the token, when the minter was never granted its role', async () =>
    {
        await expect(mintLooks([look('dice.shiraz')], chainOf(world({ refuse: 'AccessControlUnauthorizedAccount' })))).rejects.toBeInstanceOf(MinterNotGranted);
    });
});

describe('burning a look', () =>
{
    it('burns one the wallet holds, and calls one it does not hold burned with nothing sent', async () =>
    {
        const held = world({ held: new Set([tokenIdOf('dice.shiraz')]) });
        expect(await burnLook(look('dice.shiraz', { state: 'burning' }), chainOf(held))).toEqual({ change: { hash: HASH, failure: null }, sent: true });
        expect(held.sent).toEqual([{ call: 'burnLook', args: [OWNER, tokenIdOf('dice.shiraz')] }]);

        const gone = world();
        expect(await burnLook(look('dice.shiraz', { state: 'burning' }), chainOf(gone))).toEqual({ change: { state: 'burned', failure: null }, sent: false });
        expect(gone.sent).toEqual([]);
    });
});

describe('a legendary achievement', () =>
{
    it('is defined first when nobody has earned it, soulbound, and awarded on a later pass', async () =>
    {
        const w = world();
        const first = await awardAchievement(legend(), chainOf(w));

        expect(first).toEqual({ change: null, sent: true });
        expect(w.sent).toEqual([{ call: 'define', args: ['ludo-won-97'] }]);

        w.defined.add(tokenIdOf('ludo-won-97'));
        expect(await awardAchievement(legend(), chainOf(w))).toEqual({ change: { hash: HASH, failure: null }, sent: true });
        expect(w.sent.at(-1)).toEqual({ call: 'award', args: [OWNER, tokenIdOf('ludo-won-97')] });
    });

    it('is minted with nothing sent when the contract says it was earned already', async () =>
    {
        const w = world({ earned: new Set([tokenIdOf('ludo-won-97')]) });

        expect(await awardAchievement(legend(), chainOf(w))).toEqual({ change: { state: 'minted', failure: null }, sent: false });
        expect(w.sent).toEqual([]);
    });

    it('takes a definition somebody else locked first as defined, waiting for the next pass', async () =>
    {
        expect(await awardAchievement(legend(), chainOf(world({ refuse: 'AchievementLocked' })))).toEqual({ change: null, sent: false });
    });
});

describe('a sent transaction', () =>
{
    it('waits while pending, is done once mined, and is sent again if it reverted', async () =>
    {
        const sent = look('dice.shiraz', { hash: HASH });

        expect(await settleSent(sent, chainOf(world({ mined: 'pending' })))).toBeNull();
        expect(await settleSent(sent, chainOf(world({ mined: 'success' })))).toEqual({ state: 'minted', failure: null });
        expect(await settleSent({ ...sent, state: 'burning' }, chainOf(world({ mined: 'success' })))).toEqual({ state: 'burned', failure: null });
        expect(await settleSent(sent, chainOf(world({ mined: 'reverted' })))).toEqual({ attempts: 1, failure: 'reverted', hash: null });
    });

    it('is taken for lost once it has waited too long with no receipt, so the token is read again rather than minting for ever', async () =>
    {
        const now = Date.parse('2026-11-02T12:00:00.000Z');
        const waited = (minutes: number) => look('dice.shiraz', { hash: HASH, sentAt: now - minutes * 60_000 });

        expect(await settleSent(waited(NFT_LOST_AFTER_MS / 60_000 - 1), chainOf(world({ mined: 'pending' })), now), 'still in time').toBeNull();
        expect(await settleSent(waited(NFT_LOST_AFTER_MS / 60_000 + 1), chainOf(world({ mined: 'pending' })), now)).toEqual({ attempts: 1, failure: 'dropped', hash: null });
    });
});
