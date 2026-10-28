import type { GameStatus } from '../../chain/vault.ts';
import type { ChainState } from '../../chain/markets.ts';
import type { DonationState } from '../donate/policy.ts';
import type { MarketState, PositionState } from '../market/policy.ts';
import type { OrderState } from '../shop/policy.ts';
import type { EscrowState } from '../stake/policy.ts';

/**
 * What one pair of a record here and what NuraChain holds for it comes to: they agree; the pair is
 * the worker's, which moves it on its next pass; it is put right through a worker's own write,
 * because the chain is the authority and that write is the one the worker makes; or it is for a
 * person. The design's tables, cell for cell (`docs/superpowers/specs/2026-10-28-operations-design.md`).
 */
export type Verdict = 'agree' | 'worker' | 'put-right' | 'person';

type Settled = Exclude<EscrowState, 'locking'>;

const ESCROW: Record<Settled, Record<GameStatus, Verdict>> = {
    open: { none: 'person', open: 'agree', settled: 'person', refunded: 'person', reclaimed: 'person' },
    settling: { none: 'person', open: 'worker', settled: 'worker', refunded: 'worker', reclaimed: 'worker' },
    refunding: { none: 'person', open: 'worker', settled: 'person', refunded: 'worker', reclaimed: 'worker' },
    settled: { none: 'person', open: 'person', settled: 'agree', refunded: 'person', reclaimed: 'person' },
    refunded: { none: 'person', open: 'person', settled: 'person', refunded: 'agree', reclaimed: 'person' },
    reclaimed: { none: 'person', open: 'person', settled: 'person', refunded: 'person', reclaimed: 'agree' },
    failed: { none: 'agree', open: 'person', settled: 'person', refunded: 'person', reclaimed: 'person' }
};

/** A paid game: the escrow's state here and the game's status in the vault. A lock is the worker's whatever the vault says. */
export const escrowVerdict = (here: EscrowState, there: GameStatus) => (here === 'locking' ? 'worker' : ESCROW[here][there]);

/** What the shop holds under an order: no sale, a sale to its buyer at its price (refunded or not), or a sale this server never quoted. */
export type Sold = 'unsold' | 'sold' | 'refunded' | 'other';

/** The orders no worker is moving: one paid or refunded here, or one that expired or failed past its lapse. */
export type OrderAfter = Extract<OrderState, 'paid' | 'refunded' | 'expired' | 'failed'>;

const ORDER: Record<OrderAfter, Record<Sold, Verdict>> = {
    paid: { unsold: 'person', sold: 'agree', refunded: 'person', other: 'person' },
    refunded: { unsold: 'person', sold: 'person', refunded: 'agree', other: 'person' },
    expired: { unsold: 'agree', sold: 'put-right', refunded: 'put-right', other: 'person' },
    failed: { unsold: 'agree', sold: 'put-right', refunded: 'put-right', other: 'person' }
};

export const orderVerdict = (here: OrderAfter, there: Sold) => ORDER[here][there];

/** What the gifts contract holds under a gift's giver and id: nothing, the gift prepared, or another one. */
export type Given = 'none' | 'prepared' | 'other';

export type DonationAfter = Exclude<DonationState, 'prepared' | 'sent'>;

const DONATION: Record<DonationAfter, Record<Given, Verdict>> = {
    confirmed: { none: 'person', prepared: 'agree', other: 'person' },
    expired: { none: 'agree', prepared: 'put-right', other: 'put-right' },
    reverted: { none: 'agree', prepared: 'put-right', other: 'put-right' },
    failed: { none: 'agree', prepared: 'put-right', other: 'agree' }
};

export const donationVerdict = (here: DonationAfter, there: Given) => DONATION[here][there];

/** The markets no worker is moving: resolved here, a settled one past its dispute window. */
export type MarketAfter = Exclude<MarketState, 'open' | 'closing'>;

const MARKET: Record<MarketAfter, ChainState> = {
    settled: 'settled',
    refunded: 'refunded',
    cancelled: 'cancelled',
    expired: 'expired',
    empty: 'none'
};

/** A settled market the chain holds as called off was overturned while the worker was not asking: its own `resolve` writes it. */
export const marketVerdict = (here: MarketAfter, there: ChainState): Verdict =>
{
    if (MARKET[here] === there)
    {
        return 'agree';
    }

    return here === 'settled' && there === 'cancelled' ? 'put-right' : 'person';
};

export type PositionAfter = Exclude<PositionState, 'prepared' | 'sent'>;

const POSITION: Record<PositionAfter, Record<Given, Verdict>> = {
    confirmed: { none: 'person', prepared: 'agree', other: 'person' },
    reverted: { none: 'agree', prepared: 'put-right', other: 'person' },
    expired: { none: 'agree', prepared: 'put-right', other: 'person' }
};

export const positionVerdict = (here: PositionAfter, there: Given) => POSITION[here][there];

/** Whether a confirmed position was claimed, here and on the chain: claimed by a call this server never saw is the claim route's own write. */
export const claimVerdict = (here: boolean, there: boolean): Verdict =>
{
    if (here === there)
    {
        return 'agree';
    }

    return there ? 'put-right' : 'person';
};
