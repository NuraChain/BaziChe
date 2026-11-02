import { describe, expect, it } from 'vitest';

import { markOf, unlinked, type NftMark } from '../src/domains/nft/read.ts';

/**
 * What a page says of a token: on the owner's own collection, the transaction that minted it; on a
 * profile anybody can open, only that it is on NuraChain, because a transaction's page names the
 * wallet it went to.
 */
describe('a token\'s mark', () =>
{
    const marks = new Map<string, NftMark>([
        ['ludo-won-97', { state: 'minted', hash: `0x${ 'ab'.repeat(32) }` }],
        ['ludo-won-98', { state: 'minting' }]
    ]);

    it('is shown to others without the transaction, which would name the owner\'s wallet', () =>
    {
        expect(unlinked(marks)).toEqual(new Map([['ludo-won-97', { state: 'minted' }], ['ludo-won-98', { state: 'minting' }]]));
    });

    it('is carried only by what is a token', () =>
    {
        expect(markOf(marks, 'ludo-won-98')).toEqual({ nft: { state: 'minting' } });
        expect(markOf(marks, 'ludo-won-1')).toEqual({});
    });
});
