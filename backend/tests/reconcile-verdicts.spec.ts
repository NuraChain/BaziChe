import { describe, expect, it } from 'vitest';

import { GAME_STATUS } from '../src/chain/vault.ts';
import { CHAIN_STATES } from '../src/chain/markets.ts';
import { ESCROW_STATES } from '../src/domains/stake/policy.ts';
import {
    claimVerdict,
    donationVerdict,
    escrowVerdict,
    marketVerdict,
    orderVerdict,
    positionVerdict,
    type Verdict
} from '../src/domains/reconcile/verdicts.ts';

/** Every cell of a table, as `here there verdict` lines, so a changed cell is one line of the diff. */
const cells = <H extends string, T extends string>(heres: readonly H[], theres: readonly T[], verdict: (here: H, there: T) => Verdict) =>
    heres.flatMap((here) => theres.map((there) => `${ here } ${ there } ${ verdict(here, there) }`));

describe('a paid game against the vault', () =>
{
    it('is the design\'s table, cell for cell, and a lock is the worker\'s whatever the vault says', () =>
    {
        expect(cells(ESCROW_STATES, GAME_STATUS, escrowVerdict)).toEqual([
            'locking none worker', 'locking open worker', 'locking settled worker', 'locking refunded worker', 'locking reclaimed worker',
            'open none person', 'open open agree', 'open settled person', 'open refunded person', 'open reclaimed person',
            'settling none person', 'settling open worker', 'settling settled worker', 'settling refunded worker', 'settling reclaimed worker',
            'settled none person', 'settled open person', 'settled settled agree', 'settled refunded person', 'settled reclaimed person',
            'refunding none person', 'refunding open worker', 'refunding settled person', 'refunding refunded worker', 'refunding reclaimed worker',
            'refunded none person', 'refunded open person', 'refunded settled person', 'refunded refunded agree', 'refunded reclaimed person',
            'reclaimed none person', 'reclaimed open person', 'reclaimed settled person', 'reclaimed refunded person', 'reclaimed reclaimed agree',
            'failed none agree', 'failed open person', 'failed settled person', 'failed refunded person', 'failed reclaimed person'
        ]);
    });

    it('never puts a paid game right: what the vault holds there is the staff\'s to look into', () =>
    {
        expect(cells(ESCROW_STATES, GAME_STATUS, escrowVerdict).filter((cell) => cell.endsWith('put-right'))).toEqual([]);
    });
});

describe('a shop order against the sale the shop holds', () =>
{
    it('delivers a sale the shop holds for an order that ran out or failed here, takes back what a refunded one delivered, and leaves everything else apart to a person', () =>
    {
        expect(cells(['paid', 'refunded', 'expired', 'failed'] as const, ['unsold', 'sold', 'refunded', 'other'] as const, orderVerdict)).toEqual([
            'paid unsold person', 'paid sold agree', 'paid refunded put-right', 'paid other person',
            'refunded unsold person', 'refunded sold person', 'refunded refunded agree', 'refunded other person',
            'expired unsold agree', 'expired sold put-right', 'expired refunded put-right', 'expired other person',
            'failed unsold agree', 'failed sold put-right', 'failed refunded put-right', 'failed other person'
        ]);
    });
});

describe('a gift against what the gifts contract holds', () =>
{
    it('confirms or fails a gift the chain holds after it was let go of here, and calls a counted gift the chain lacks a person\'s', () =>
    {
        expect(cells(['confirmed', 'expired', 'reverted', 'failed'] as const, ['none', 'prepared', 'other'] as const, donationVerdict)).toEqual([
            'confirmed none person', 'confirmed prepared agree', 'confirmed other person',
            'expired none agree', 'expired prepared put-right', 'expired other put-right',
            'reverted none agree', 'reverted prepared put-right', 'reverted other put-right',
            'failed none agree', 'failed prepared put-right', 'failed other agree'
        ]);
    });
});

describe('a market against what the markets contract holds', () =>
{
    it('agrees only with the state it was written from, and writes an overturn the worker missed', () =>
    {
        expect(cells(['settled', 'refunded', 'cancelled', 'expired', 'empty'] as const, CHAIN_STATES, marketVerdict)).toEqual([
            'settled none person', 'settled open person', 'settled settled agree', 'settled refunded person', 'settled cancelled put-right', 'settled expired person',
            'refunded none person', 'refunded open person', 'refunded settled person', 'refunded refunded agree', 'refunded cancelled person', 'refunded expired person',
            'cancelled none person', 'cancelled open person', 'cancelled settled person', 'cancelled refunded person', 'cancelled cancelled agree', 'cancelled expired person',
            'expired none person', 'expired open person', 'expired settled person', 'expired refunded person', 'expired cancelled person', 'expired expired agree',
            'empty none agree', 'empty open person', 'empty settled person', 'empty refunded person', 'empty cancelled person', 'empty expired person'
        ]);
    });
});

describe('a position against what the markets contract holds under its ticket', () =>
{
    it('confirms a ticket the chain took after it was let go of here, and gives anything under a ticket that is not the one prepared to a person', () =>
    {
        expect(cells(['confirmed', 'reverted', 'expired'] as const, ['none', 'prepared', 'other'] as const, positionVerdict)).toEqual([
            'confirmed none person', 'confirmed prepared agree', 'confirmed other person',
            'reverted none agree', 'reverted prepared put-right', 'reverted other person',
            'expired none agree', 'expired prepared put-right', 'expired other person'
        ]);
    });

    it('writes down a claim this server never read, and calls a claim the chain does not hold a person\'s', () =>
    {
        expect([claimVerdict(false, false), claimVerdict(true, true), claimVerdict(false, true), claimVerdict(true, false)]).toEqual(['agree', 'agree', 'put-right', 'person']);
    });
});
