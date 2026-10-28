import { HttpError } from '@azerothjs/http';
import type { DataSource, EntityManager } from 'typeorm';
import { getAddress, toHex, type Address, type Hex } from 'viem';

import { marketIdOf, termsHashOf, type MarketOnChain, type MarketsCall, type MarketsChain, type Terms, type Ticket } from '../../chain/markets.ts';
import { MarketDisclosure } from '../../entities/market-disclosure.entity.ts';
import { MarketPosition } from '../../entities/market-position.entity.ts';
import { Market } from '../../entities/market.entity.ts';
import { MatchPlayer } from '../../entities/match-player.entity.ts';
import { Match } from '../../entities/match.entity.ts';
import { Table } from '../../entities/table.entity.ts';
import { cursorOf, keyOf, keysetAfter, olderThan } from '../../lib/keyset.ts';
import type { MarketChoice, MarketLook, MarketPaying, MarketPositions, MarketPositionView, MarketsState, WalletCall } from '../../schemas.ts';
import type { Engine } from '../match/engine.ts';
import { voidedOf } from '../match/service.ts';
import { audited, AUDIT_PAGE, nothing, RECENT, type AuditAsk, type Finding, type Words } from '../reconcile/audit.ts';
import { claimVerdict, marketVerdict, positionVerdict, type Given, type MarketAfter, type PositionAfter } from '../reconcile/verdicts.ts';
import { eligibilityOf, WEI_PER_NURA, weiOf, type Eligibility, type Standing } from '../stake/policy.ts';
import { choicesOf, verdictOf } from './outcomes.ts';
import {
    LEAST_STAKE_NURA,
    MARKET_FEE_BPS,
    MARKET_PRESETS_NURA,
    MARKET_WINDOW_MS,
    MAX_PER_BETTOR_NURA,
    MAX_PER_DAY_NURA,
    MAX_POOL_NURA,
    MAX_STAKE_NURA,
    MIN_BETTORS,
    MIN_OUTCOMES,
    TICKET_LIFE_MS,
    type Choice,
    type MarketMay,
    type MarketState,
    type PositionState
} from './policy.ts';
import { MARKET_REFUSALS, type MarketRefusal } from './refusals.ts';

/** A ticket is not signed for a market with less than this left before it closes: it could not be placed in time. */
const CLOSE_MARGIN_S = 5;

/** A position asked for again is handed back only while its ticket has this long left. */
const REUSE_LEAST_S = 15;

/**
 * How long after a deadline this server's clock waits before it believes the chain's: a block's
 * clock can run behind this one, and a node behind the chain's newest block answers for an older one.
 */
const LAPSE = `interval '5 minutes'`;

/** How often a position nobody said they sent is asked about: the wallet may have sent it after its tab closed. */
const UNSENT_EVERY_MS = 10_000;

/** How often a settled market is asked whether the owner overturned it, until its dispute window has passed. */
const OVERTURN_EVERY_MS = 30_000;

/**
 * How long a claim's hash may name nothing the node holds before the contract's own record decides
 * what became of it: a transaction just sent can take a moment to reach the node this server reads.
 */
export const GONE_AFTER_MS = 60_000;

const PAGE = 50;

/** The most positions, claims and markets one pass of the worker looks at, each. */
const SWEEP_MOST = 200;

const BPS = 10_000n;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const nura = (amount: number) => BigInt(amount) * WEI_PER_NURA;

const LEAST = nura(LEAST_STAKE_NURA);

/** A position the chain holds, or one whose ticket may still be placed. */
const LIVE = `(p.state = 'confirmed' or (p.state in ('prepared', 'sent') and p.deadline + ${ LAPSE } > now()))`;

/** A position whose claim the contract would pay now: a winner's from the end of its dispute window, a stake back at once. */
/**
 * What a position claimed by a transaction this server never read paid: a stake back is its stake,
 * and a winner's share depends on who claimed before it, so it is not worked out.
 */
const PAID_UNSEEN = `case when (select k.state from markets k where k.id = market_id) = 'settled' then null else amount end`;

const CLAIMABLE = `p.state = 'confirmed' and p.claimed_at is null
    and ((k.state = 'settled' and p.outcome = k.outcome and k.claimable_at <= now()) or k.state in ('refunded', 'cancelled', 'expired'))`;

/**
 * A position that can still be claimed, now or later: one in a market that is not settled (a stake
 * back, or a market not resolved yet), a winner's, or any in a settled market the owner may still
 * overturn. A loser past the dispute window never can.
 */
const CLAIMS_YET = `p.state = 'confirmed' and p.claimed_at is null
    and (k.state <> 'settled' or p.outcome = k.outcome or k.claimable_at + ${ LAPSE } > now())`;

export interface MarketHooks
{
    /** A market moved: whoever looks at its table hears it, and these people besides. */
    changed(tableId: string | null, userIds: readonly string[]): void;
}

export interface MarketSweep
{
    placed: number;
    refused: number;
    lapsed: number;
    sent: number;
    settled: number;
    refunded: number;
    cancelled: number;
    expired: number;
    empty: number;
    claimed: number;
    faults: { market: string; error: string }[];
}

interface TermsFields
{
    match_id: string;
    outcomes: number;
    closes_at: Date;
    fee_bps: number;
    max_stake: string;
    max_per_bettor: string;
    max_pool: string;
    min_bettors: number;
    min_outcomes: number;
}

interface MarketRow extends TermsFields
{
    id: string;
    table_id: string;
    game: string;
    choices: Choice[];
    state: MarketState;
    outcome: number | null;
    claimable_at: Date | null;
    tx_hash: string | null;
    failure: string | null;
    finished_at: Date | null;
    left_s: number;
    lapsed: boolean;
    disputed: boolean;
    now_ms: number;
}

interface PositionRow extends TermsFields
{
    id: string;
    market_id: string;
    table_id: string;
    game: string;
    bettor_id: string;
    address: string;
    outcome: number;
    amount: string;
    deadline: Date;
    state: PositionState;
    tx_hash: string | null;
    failure: string | null;
    created_at: Date;
    confirmed_at: Date | null;
    claimed_at: Date | null;
    paid: string | null;
    claim_hash: string | null;
    market_state: MarketState;
    market_outcome: number | null;
    claimable_at: Date | null;
    choices: Choice[];

    /** Each seat's handle, by seat. */
    handles: Record<string, string> | null;
    lapsed: boolean;
    at_key: string;
}

interface AuditMarketRow extends MarketRow
{
    handles: Record<string, string> | null;
    at_key: string;
}

interface AuditPositionRow extends PositionRow
{
    bettor: string;
}

/** Each seat's handle in a market's game, by seat. */
const HANDLES = '(select jsonb_object_agg(s.seat, u.handle) from match_players s join users u on u.id = s.user_id where s.match_id = k.match_id)';

/** An outcome in words: who it is (the seat's player, a side's players), or a draw. */
const outcomeWords = (choices: readonly Choice[], handles: Record<string, string> | null, outcome: number | null): Words =>
{
    const choice = outcome === null ? undefined : choices[outcome];

    if (choice === undefined)
    {
        return outcome === null ? {} : { outcome: String(outcome) };
    }

    const named = (seat: number) => handles?.[String(seat)] ?? '';

    switch (choice.kind)
    {
        case 'seat':
            return { outcome: String(outcome), backed: named(choice.seat) };
        case 'side':
            return { outcome: String(outcome), backed: choice.seats.map(named).join(' & ') };
        default:
            return { outcome: String(outcome), draw: 'yes' };
    }
};

const marketQuery = (from: DataSource | EntityManager) => from.getRepository(Market)
    .createQueryBuilder('k')
    .innerJoin(Match, 'm', 'm.id = k.match_id')
    .select('k.id', 'id')
    .addSelect('k.match_id', 'match_id')
    .addSelect('k.table_id', 'table_id')
    .addSelect('k.game', 'game')
    .addSelect('k.outcomes', 'outcomes')
    .addSelect('k.choices', 'choices')
    .addSelect('k.closes_at', 'closes_at')
    .addSelect('k.fee_bps', 'fee_bps')
    .addSelect('k.max_stake::text', 'max_stake')
    .addSelect('k.max_per_bettor::text', 'max_per_bettor')
    .addSelect('k.max_pool::text', 'max_pool')
    .addSelect('k.min_bettors', 'min_bettors')
    .addSelect('k.min_outcomes', 'min_outcomes')
    .addSelect('k.state', 'state')
    .addSelect('k.outcome', 'outcome')
    .addSelect('k.claimable_at', 'claimable_at')
    .addSelect('k.tx_hash', 'tx_hash')
    .addSelect('k.failure', 'failure')
    .addSelect('m.finished_at', 'finished_at')
    .addSelect('extract(epoch from k.closes_at - now())::float8', 'left_s')
    .addSelect(`k.closes_at + ${ LAPSE } < now()`, 'lapsed')
    .addSelect(`coalesce(k.claimable_at + ${ LAPSE } > now(), false)`, 'disputed')
    .addSelect('(extract(epoch from now()) * 1000)::float8', 'now_ms');

const positionQuery = (from: DataSource | EntityManager) => from.getRepository(MarketPosition)
    .createQueryBuilder('p')
    .innerJoin(Market, 'k', 'k.id = p.market_id')
    .select('p.id', 'id')
    .addSelect('p.market_id', 'market_id')
    .addSelect('k.match_id', 'match_id')
    .addSelect('k.table_id', 'table_id')
    .addSelect('k.game', 'game')
    .addSelect('p.bettor_id', 'bettor_id')
    .addSelect('p.address', 'address')
    .addSelect('p.outcome', 'outcome')
    .addSelect('p.amount::text', 'amount')
    .addSelect('p.deadline', 'deadline')
    .addSelect('p.state', 'state')
    .addSelect('p.tx_hash', 'tx_hash')
    .addSelect('p.failure', 'failure')
    .addSelect('p.created_at', 'created_at')
    .addSelect('p.confirmed_at', 'confirmed_at')
    .addSelect('p.claimed_at', 'claimed_at')
    .addSelect('p.paid::text', 'paid')
    .addSelect('p.claim_hash', 'claim_hash')
    .addSelect('k.state', 'market_state')
    .addSelect('k.outcome', 'market_outcome')
    .addSelect('k.claimable_at', 'claimable_at')
    .addSelect('k.outcomes', 'outcomes')
    .addSelect('k.closes_at', 'closes_at')
    .addSelect('k.fee_bps', 'fee_bps')
    .addSelect('k.max_stake::text', 'max_stake')
    .addSelect('k.max_per_bettor::text', 'max_per_bettor')
    .addSelect('k.max_pool::text', 'max_pool')
    .addSelect('k.min_bettors', 'min_bettors')
    .addSelect('k.min_outcomes', 'min_outcomes')
    .addSelect('k.choices', 'choices')
    .addSelect('(select jsonb_object_agg(s.seat, u.handle) from match_players s join users u on u.id = s.user_id where s.match_id = k.match_id)', 'handles')
    .addSelect(`p.deadline + ${ LAPSE } < now()`, 'lapsed')
    .addSelect(keyOf('p.created_at'), 'at_key');

const secondsOf = (at: Date) => BigInt(Math.floor(new Date(at).getTime() / 1000));

/** The terms a market's tickets name by their hash: every value written once, when its row was. */
const termsOf = (marketId: string, row: TermsFields): Terms => ({
    market: marketIdOf(marketId),
    game: marketIdOf(row.match_id),
    outcomes: row.outcomes,
    closesAt: secondsOf(row.closes_at),
    feeBps: row.fee_bps,
    maxStake: BigInt(row.max_stake),
    maxPerBettor: BigInt(row.max_per_bettor),
    maxPool: BigInt(row.max_pool),
    minBettors: row.min_bettors,
    minOutcomes: row.min_outcomes
});

const ticketOf = (terms: Terms, position: { id: string; address: string; outcome: number; amount: string; deadline: Date }): Ticket => ({
    id: marketIdOf(position.id),
    market: terms.market,
    terms: termsHashOf(terms),
    bettor: getAddress(position.address),
    outcome: position.outcome,
    amount: BigInt(position.amount),
    deadline: secondsOf(position.deadline)
});

const wireOf = (from: Address, call: MarketsCall): WalletCall => ({
    from,
    to: call.to,
    data: call.data,
    value: toHex(call.value),
    chainId: call.chainId,
    ...(call.gasPrice === null ? {} : { gasPrice: toHex(call.gasPrice) })
});

/** Each market's stakes the chain holds, by outcome, in wei. */
type Pools = Map<string, Map<number, bigint>>;

const resultOf = (row: PositionRow) =>
{
    if (row.state !== 'confirmed')
    {
        return null;
    }

    if (row.market_state === 'settled')
    {
        return row.outcome === row.market_outcome ? 'won' as const : 'lost' as const;
    }

    return row.market_state === 'refunded' || row.market_state === 'cancelled' || row.market_state === 'expired' ? 'refund' as const : null;
};

/** What claiming a position pays: its stake back, or its share of the pool less the fee, as `payoutOf` works it out before anybody claims. */
const payoutOf = (row: PositionRow, pools: Pools) =>
{
    const result = resultOf(row);

    if (result === 'refund')
    {
        return BigInt(row.amount);
    }

    if (result !== 'won')
    {
        return null;
    }

    const held = pools.get(row.market_id) ?? new Map<number, bigint>();
    const pool = [...held.values()].reduce((sum, one) => sum + one, 0n);
    const backing = held.get(row.outcome) ?? 0n;

    return backing === 0n ? null : ((pool - (pool * BigInt(row.fee_bps)) / BPS) * BigInt(row.amount)) / backing;
};

const asPosition = (row: PositionRow, pools: Pools): MarketPositionView =>
{
    const result = resultOf(row);
    const payout = row.claimed_at === null ? payoutOf(row, pools) : null;

    return {
        id: row.id,
        market: row.market_id,
        match: row.match_id,
        game: row.game,
        outcome: row.outcome,
        choice: choiceView(row.choices[row.outcome]!, new Map(Object.entries(row.handles ?? {}).map(([seat, handle]) => [Number(seat), handle]))),
        address: row.address,
        amount: row.amount,
        state: row.state,
        deadline: new Date(row.deadline).toISOString(),
        ...(row.tx_hash === null ? {} : { hash: row.tx_hash }),
        ...(row.failure === null ? {} : { failure: row.failure }),
        at: new Date(row.created_at).toISOString(),
        ...(row.confirmed_at === null ? {} : { confirmedAt: new Date(row.confirmed_at).toISOString() }),
        ...(result === null ? {} : { result }),
        ...(payout === null ? {} : { payout: payout.toString() }),
        ...(result === 'won' && row.claimable_at !== null ? { claimableAt: new Date(row.claimable_at).toISOString() } : {}),
        ...(row.claimed_at === null ? {} : { claimedAt: new Date(row.claimed_at).toISOString() }),
        ...(row.paid === null ? {} : { paid: row.paid }),
        ...(row.claim_hash === null || row.claimed_at !== null ? {} : { claimHash: row.claim_hash })
    };
};

const choiceView = (choice: Choice, handles: ReadonlyMap<number, string>): MarketChoice =>
{
    switch (choice.kind)
    {
        case 'seat':
            return { kind: 'seat', seat: choice.seat, who: handles.get(choice.seat) ?? '' };
        case 'side':
            return { kind: 'side', seats: [...choice.seats], who: choice.seats.map((seat) => handles.get(seat) ?? '') };
        default:
            return { kind: 'draw' };
    }
};

export const marketRefusal = (word: MarketRefusal, message: string, details?: Record<string, string>) =>
    new HttpError(MARKET_REFUSALS[word], message, { code: word, ...(details === undefined ? {} : { details }) });

const MAY_OF = {
    'paid-wallet': 'market-wallet',
    'paid-minor': 'market-minor',
    'paid-terms': 'market-terms',
    'paid-break': 'market-break'
} as const satisfies Record<Exclude<Eligibility, 'yes'>, MarketMay>;

const mayRefused = {
    'market-region': () => marketRefusal('market-region', 'Markets are not offered where you are.'),
    'market-wallet': () => marketRefusal('market-wallet', 'Taking a position needs a wallet account.'),
    'market-minor': () => marketRefusal('market-minor', 'Markets are for adults only.'),
    'market-terms': () => marketRefusal('market-terms', 'Confirm the terms of playing for NURA first.'),
    'market-break': () => marketRefusal('market-break', 'You asked for a break from playing for NURA.'),
    'market-disclosure': () => marketRefusal('market-disclosure', 'Read what a market is first.')
} satisfies Record<Exclude<MarketMay, 'yes'>, () => HttpError>;

const notOpen = () => marketRefusal('market-off', 'Markets are not open here.');
const noMarket = () => marketRefusal('market-missing', 'There is no market there.');
const closed = () => marketRefusal('market-closed', 'This market has stopped taking positions.');
const unclaimable = () => marketRefusal('market-unclaimable', 'Nothing of yours there can be claimed now.');
const noPosition = () => marketRefusal('market-missing', 'No position of yours by that name.');

const limited = (limit: 'bettor' | 'day' | 'pool') =>
    marketRefusal('market-limit', 'That would go past a limit on what can be staked.', { limit });

/** What the contract's refusal of a placement means to whoever asked for the position. */
const placeRefusalOf = (error: string, amount: string, held: bigint) =>
{
    switch (error)
    {
        case 'InsufficientFunds':
            return marketRefusal('market-funds', 'Your wallet does not hold enough NURA for this.', { amount, held: held.toString() });
        case 'EnforcedPause':
            return marketRefusal('market-paused', 'Markets are paused for now.');
        case 'MarketClosed':
        case 'TicketExpired':
            return closed();
        case 'BettorLimit':
            return limited('bettor');
        case 'PoolLimit':
            return limited('pool');
        case 'StakeTooLarge':
            return marketRefusal('market-amount', `A position is ${ LEAST_STAKE_NURA } to ${ MAX_STAKE_NURA } NURA.`);
        default:
            return marketRefusal('market-refused', 'NuraChain would not take this position.', { error });
    }
};

/** Claims a bettor's wallet sends, which only the contract can refuse: it is asked first, by name. */
const claimRefusalOf = (error: string) =>
    (error === 'NotYetClaimable' || error === 'AlreadyClaimed' || error === 'NothingOwed' || error === 'MarketOpen'
        ? unclaimable()
        : marketRefusal('market-refused', 'NuraChain would not pay this claim.', { error }));

/**
 * Markets: pari-mutuel pools on the result of a game being played at a public table. Every stake
 * goes from a bettor's own wallet into `ArcadeMarkets` with a ticket this server signs, and the
 * contract pays the winners or gives every stake back. This server never holds NURA and believes
 * nothing it is told about the chain: the worker asks the contract about every position and every
 * market, settles each market from the game's own result, and calls off one it cannot vouch for.
 */
export function createMarketService(
    db: DataSource,
    chain: MarketsChain,
    engines: readonly Engine[],
    regions: ReadonlySet<string>,
    standingOf: (me: string) => Promise<Standing>,
    mayWatch: (tableId: string, userIds: readonly string[]) => Promise<string[]>,
    hooks: MarketHooks
)
{
    const open = chain.configured && regions.size > 0;

    /** When each position nobody said they sent was last asked about, in this process. */
    const askedAt = new Map<string, number>();

    /** When each settled market was last asked whether it was overturned, in this process. */
    const overturnAskedAt = new Map<string, number>();

    /** When each claim's hash was first found to name nothing the node holds, in this process. */
    const goneSince = new Map<string, number>();

    /** Markets the chain was found to hold open while their games go on: asked about again once the game ends. */
    const heldOpen = new Set<string>();

    const disclosed = (me: string) => db.getRepository(MarketDisclosure).existsBy({ userId: me });

    const mayOf = (country: string | null, standing: Standing, accepted: boolean): MarketMay =>
    {
        if (country === null || !regions.has(country.trim().toUpperCase()))
        {
            return 'market-region';
        }

        const paid = eligibilityOf(standing);

        if (paid !== 'yes')
        {
            return MAY_OF[paid];
        }

        return accepted ? 'yes' : 'market-disclosure';
    };

    /** Each market's stakes the chain holds, by outcome. */
    const poolsOf = async (marketIds: readonly string[]) =>
    {
        const pools: Pools = new Map();

        if (marketIds.length === 0)
        {
            return pools;
        }

        const rows = await db.getRepository(MarketPosition)
            .createQueryBuilder('p')
            .select('p.market_id', 'market_id')
            .addSelect('p.outcome', 'outcome')
            .addSelect('sum(p.amount)::text', 'pool')
            .where(`p.market_id = any(:ids::uuid[]) and p.state = 'confirmed'`, { ids: [...new Set(marketIds)] })
            .groupBy('p.market_id')
            .addGroupBy('p.outcome')
            .getRawMany<{ market_id: string; outcome: number; pool: string }>();

        for (const row of rows)
        {
            pools.set(row.market_id, (pools.get(row.market_id) ?? new Map<number, bigint>()).set(row.outcome, BigInt(row.pool)));
        }

        return pools;
    };

    const positionsAs = async (rows: readonly PositionRow[]) =>
    {
        const pools = await poolsOf(rows.map((row) => row.market_id));

        return rows.map((row) => asPosition(row, pools));
    };

    /**
     * The market on a game, written the first time anybody asks about one that may have it: a game
     * being played at a public live table whose market has not closed, asked by somebody who may
     * watch it. Its terms are the game's and nobody's choice, so whoever asks first writes the same
     * row, and the unique index keeps one.
     */
    const marketOfMatch = async (me: string, matchId: string) =>
    {
        const there = await marketQuery(db).where('k.match_id = :matchId', { matchId }).getRawOne<MarketRow>();

        if (there !== undefined)
        {
            return there;
        }

        const found = await db.getRepository(Match)
            .createQueryBuilder('m')
            .innerJoin(Table, 't', 't.id = m.table_id')
            .select('m.table_id', 'table_id')
            .addSelect('m.game', 'game')
            .addSelect('m.seats', 'seats')
            .addSelect('m.variant', 'variant')
            .addSelect(`extract(epoch from date_trunc('second', m.started_at + make_interval(secs => :window)))::bigint::text`, 'closes_s')
            .addSelect('m.started_at + make_interval(secs => :window) > now() + make_interval(secs => :margin)', 'taking')
            .where('m.id = :matchId and m.finished_at is null')
            .andWhere(`t.privacy = 'public' and t.mode = 'live' and t.status <> 'closed'`)
            .setParameters({ matchId, window: MARKET_WINDOW_MS / 1000, margin: CLOSE_MARGIN_S })
            .getRawOne<{ table_id: string; game: string; seats: number; variant: 'standard' | 'teams'; closes_s: string; taking: boolean }>();
        const engine = engines.find((one) => one.id === found?.game);

        if (found === undefined || !found.taking || engine === undefined || !(await watches(me, found.table_id)))
        {
            return null;
        }

        const format = { seats: found.seats, variant: found.variant };
        const choices = choicesOf(found.seats, (seat) => engine.sideOf(seat, format), engine.drawable === true);

        await db.getRepository(Market)
            .createQueryBuilder()
            .insert()
            .values({
                matchId,
                tableId: found.table_id,
                game: found.game,
                outcomes: choices.length,
                choices,
                closesAt: new Date(Number(found.closes_s) * 1000),
                feeBps: MARKET_FEE_BPS,
                maxStake: nura(MAX_STAKE_NURA).toString(),
                maxPerBettor: nura(MAX_PER_BETTOR_NURA).toString(),
                maxPool: nura(MAX_POOL_NURA).toString(),
                minBettors: MIN_BETTORS,
                minOutcomes: MIN_OUTCOMES,
                state: 'open'
            })
            .orIgnore()
            .execute();

        return await marketQuery(db).where('k.match_id = :matchId', { matchId }).getRawOne<MarketRow>() ?? null;
    };

    const playsIn = (me: string, matchId: string) => db.getRepository(MatchPlayer).existsBy({ matchId, userId: me });

    const watches = async (me: string, tableId: string) => (await mayWatch(tableId, [me])).includes(me);

    const holdsIn = (me: string, marketId: string) => db.getRepository(MarketPosition).existsBy({ marketId, bettorId: me });

    /** Whoever may take a position, or the refusal they would meet. */
    const mustMay = async (me: string, country: string | null) =>
    {
        const standing = await standingOf(me);
        const may = mayOf(country, standing, await disclosed(me));

        if (may !== 'yes')
        {
            throw mayRefused[may]();
        }

        return getAddress(standing.address!);
    };

    /**
     * The position a bettor takes: the one they already hold for this outcome and amount while its
     * ticket has time left, or a new one inside every limit. One bettor's positions are written one
     * at a time, so two at once cannot both pass a limit the pair goes past.
     */
    const prepare = async (me: string, bettor: Address, market: MarketRow, outcome: number, amount: bigint) => await db.transaction(async (tx) =>
    {
        // No repository can take an advisory lock.
        await tx.query(`select pg_advisory_xact_lock(hashtext('market:bettor'), hashtext($1))`, [me]);

        const again = await positionQuery(tx)
            .where('p.bettor_id = :me and p.market_id = :market and p.outcome = :outcome', { me, market: market.id, outcome })
            .andWhere('p.amount = :amount and p.address = :address', { amount: amount.toString(), address: bettor.toLowerCase() })
            .andWhere(`p.state = 'prepared'`)
            .andWhere(`p.deadline > now() + make_interval(secs => :least)`, { least: REUSE_LEAST_S })
            .orderBy('p.created_at', 'DESC')
            .getRawOne<PositionRow>();

        if (again !== undefined)
        {
            return { row: again, fresh: false };
        }

        const live = (where: string, params: Record<string, unknown>) => tx.getRepository(MarketPosition)
            .createQueryBuilder('p')
            .select('coalesce(sum(p.amount), 0)::text', 'total')
            .where(LIVE)
            .andWhere(where, params)
            .getRawOne<{ total: string }>()
            .then((row) => BigInt(row?.total ?? '0'));

        const [mine, today, pool] = await Promise.all([
            live('p.bettor_id = :me and p.market_id = :market', { me, market: market.id }),
            live(`p.bettor_id = :me and p.created_at > now() - interval '1 day'`, { me }),
            live('p.market_id = :market', { market: market.id })
        ]);

        if (mine + amount > BigInt(market.max_per_bettor))
        {
            throw limited('bettor');
        }

        if (today + amount > nura(MAX_PER_DAY_NURA))
        {
            throw limited('day');
        }

        if (pool + amount > BigInt(market.max_pool))
        {
            throw limited('pool');
        }

        const due = await tx.getRepository(Market)
            .createQueryBuilder('k')
            .select(`date_trunc('second', least(now() + make_interval(secs => :life), k.closes_at))`, 'deadline')
            .where('k.id = :market', { market: market.id, life: TICKET_LIFE_MS / 1000 })
            .getRawOne<{ deadline: Date }>();
        const { identifiers } = await tx.getRepository(MarketPosition).insert({
            marketId: market.id,
            bettorId: me,
            address: bettor.toLowerCase(),
            outcome,
            amount: amount.toString(),
            deadline: due!.deadline,
            state: 'prepared'
        });
        const row = await positionQuery(tx).where('p.id = :id', { id: identifiers[0].id }).getRawOne<PositionRow>();

        return { row: row!, fresh: true };
    });

    const forget = (id: string) => db.getRepository(MarketPosition).delete({ id, state: 'prepared' });

    const mine = async (me: string, id: string) =>
    {
        const row = UUID.test(id)
            ? await positionQuery(db).where('p.id = :id and p.bettor_id = :me', { id, me }).getRawOne<PositionRow>()
            : undefined;

        if (row === undefined)
        {
            throw noPosition();
        }

        return (await positionsAs([row]))[0];
    };

    const ring = (tableId: string | null, userIds: readonly string[]) => hooks.changed(tableId, userIds);

    const bettorsOf = async (marketId: string) =>
        (await db.getRepository(MarketPosition)
            .createQueryBuilder('p')
            .select('distinct p.bettor_id', 'bettor_id')
            .where('p.market_id = :marketId', { marketId })
            .getRawMany<{ bettor_id: string }>()).map((row) => row.bettor_id);

    /**
     * A position the contract holds as it was prepared, written once, whatever was said of it before:
     * a ticket let go of here that a block clock behind took after all is a stake the pool holds.
     */
    const confirm = async (row: PositionRow) =>
    {
        const { affected } = await db.getRepository(MarketPosition)
            .createQueryBuilder()
            .update()
            .set({ state: 'confirmed', confirmedAt: () => 'now()', failure: null })
            .where('id = :id', { id: row.id })
            .andWhere(`state <> 'confirmed'`)
            .execute();

        if (affected === 0)
        {
            return null;
        }

        ring(row.table_id, [row.bettor_id]);

        return 'placed' as const;
    };

    /**
     * A position the contract says was claimed by a call this server never read, written down as
     * claimed (`PAID_UNSEEN`); `hash` names the claim this server was waiting on, or null for none.
     */
    const claimedUnseen = async (id: string, hash?: string | null) =>
    {
        const update = db.getRepository(MarketPosition)
            .createQueryBuilder()
            .update()
            .set({ claimedAt: () => 'now()', paid: () => PAID_UNSEEN })
            .where('id = :id and claimed_at is null', { id });

        if (hash !== undefined)
        {
            update.andWhere(hash === null ? 'claim_hash is null' : 'claim_hash = :hash', { hash });
        }

        return (await update.execute()).affected ?? 0;
    };

    const endAs = async (row: PositionRow, state: 'reverted' | 'expired', failure: string | null) =>
    {
        const update = db.getRepository(MarketPosition)
            .createQueryBuilder()
            .update()
            .set({ state, failure })
            .where('id = :id', { id: row.id })
            .andWhere(`state in ('prepared', 'sent')`);

        if (state === 'expired')
        {
            update.andWhere(`deadline + ${ LAPSE } < now()`);
        }

        const { affected } = await update.execute();

        if (affected === 0)
        {
            return null;
        }

        ring(null, [row.bettor_id]);

        return state === 'reverted' ? 'refused' as const : 'lapsed' as const;
    };

    /** The word the contract gives this placement now; one it would take now was refused for its gas. */
    const why = async (row: PositionRow) =>
    {
        try
        {
            const terms = termsOf(row.market_id, row);
            const ticket = ticketOf(terms, row);
            const asked = await chain.placeCall(terms, ticket, await chain.sign(ticket));

            return asked.ok ? 'reverted' : asked.error;
        }
        catch
        {
            return 'reverted';
        }
    };

    /**
     * One position asked of the contract: confirmed once it holds the position that was prepared,
     * refused when its transaction was, let go of once its ticket can never be placed. A position
     * held under the ticket's id that is not the one prepared needs a ticket nobody here signed,
     * so it is refused and said as a fault.
     */
    const settlePosition = async (row: PositionRow, tally: MarketSweep) =>
    {
        const held = await chain.positionOf(marketIdOf(row.id));

        if (held.bettor !== null)
        {
            if (held.bettor.toLowerCase() === row.address && held.outcome === row.outcome && held.amount === BigInt(row.amount))
            {
                return await confirm(row);
            }

            tally.faults.push({ market: row.market_id, error: `mismatch:${ row.id }` });

            return await endAs(row, 'reverted', 'mismatch');
        }

        if (row.state === 'sent' && row.tx_hash !== null && await chain.mined(row.tx_hash as Hex) === 'reverted')
        {
            return await endAs(row, 'reverted', (await why(row)).slice(0, 48));
        }

        return row.lapsed ? await endAs(row, 'expired', null) : null;
    };

    /** A market written as the chain holds it now, its bettors and its table told. */
    const resolve = async (row: MarketRow, state: Exclude<MarketState, 'open' | 'closing'>, held: MarketOnChain | null) =>
    {
        const settled = state === 'settled';
        const named = state === 'settled' || state === 'refunded';
        const { affected } = await db.getRepository(Market)
            .createQueryBuilder()
            .update()
            .set({
                state,
                ...(named && held !== null ? { outcome: held.winner } : {}),
                claimableAt: settled && held !== null ? new Date(Number(held.claimableAt) * 1000) : null,
                failure: null,
                resolvedAt: () => 'now()'
            })
            .where('id = :id and state = :was', { id: row.id, was: row.state })
            .execute();

        heldOpen.delete(row.id);

        if (affected === 0)
        {
            return null;
        }

        ring(row.table_id, await bettorsOf(row.id));

        return state;
    };

    /** The game's result, as the market is settled from it, and whether that result is one it may be settled on. */
    const decide = async (row: MarketRow, chainNow: number) =>
    {
        const match = await db.getRepository(Match).findOne({
            select: { id: true, game: true, state: true, outcome: true, finishedAt: true },
            where: { id: row.match_id }
        });
        const engine = engines.find((one) => one.id === row.game);
        const ending = match === null || engine === undefined || voidedOf(match.state) ? null : engine.finish(match.state);
        const outcome = match === null || match.finishedAt === null || ending === null
            ? null
            : verdictOf(row.choices, new Date(row.closes_at).getTime(), {
                finishedAt: new Date(match.finishedAt).getTime(),
                voided: voidedOf(match.state),
                winners: ending.winners,
                drawn: match.outcome === 'drawn'
            }, chainNow, row.now_ms);

        const { affected } = await db.getRepository(Market)
            .createQueryBuilder()
            .update()
            .set({ state: 'closing', outcome })
            .where(`id = :id and state = 'open'`, { id: row.id })
            .execute();

        if (affected === 0)
        {
            return null;
        }

        ring(row.table_id, await bettorsOf(row.id));

        return { ...row, state: 'closing' as const, outcome };
    };

    /**
     * A market whose game is over, brought to the end the chain will hold: settled on its outcome,
     * or called off, by the operator's key. Asked of the chain first, so a market the chain already
     * resolved is written down and nothing is sent twice; one nobody placed in is left alone once no
     * ticket could still open it.
     */
    const close = async (row: MarketRow) =>
    {
        const id = marketIdOf(row.id);
        const held = await chain.marketOf(id);

        if (held.state === 'none')
        {
            return row.lapsed ? await resolve(row, 'empty', null) : null;
        }

        if (held.state !== 'open')
        {
            return await resolve(row, held.state, held);
        }

        if (row.tx_hash !== null)
        {
            const mined = await chain.mined(row.tx_hash as Hex);

            if (mined !== 'reverted')
            {
                return null;
            }

            await db.getRepository(Market).update({ id: row.id, state: 'closing' }, { txHash: null, failure: 'reverted' });
        }

        const sent = row.outcome === null ? await chain.cancel(id) : await chain.settle(id, row.outcome);

        if (!sent.ok)
        {
            // MarketOpen, for one: the chain's clock has not reached the close yet.
            await db.getRepository(Market).update({ id: row.id, state: 'closing' }, { failure: sent.error.slice(0, 48) });

            return null;
        }

        await db.getRepository(Market).update({ id: row.id, state: 'closing' }, { txHash: sent.hash.toLowerCase(), failure: null });

        return 'sent' as const;
    };

    const step = async (row: MarketRow, clock: () => Promise<number>) =>
    {
        if (row.state === 'settled')
        {
            const now = Date.now();

            if (now - (overturnAskedAt.get(row.id) ?? 0) < OVERTURN_EVERY_MS)
            {
                return null;
            }

            overturnAskedAt.set(row.id, now);

            const held = await chain.marketOf(marketIdOf(row.id));

            return held.state === 'cancelled' ? await resolve(row, 'cancelled', held) : null;
        }

        if (row.state === 'open' && row.finished_at === null)
        {
            if (!row.lapsed || heldOpen.has(row.id))
            {
                return null;
            }

            const held = await chain.marketOf(marketIdOf(row.id));

            if (held.state === 'none')
            {
                return await resolve(row, 'empty', null);
            }

            if (held.state === 'open')
            {
                heldOpen.add(row.id);
                return null;
            }

            return await resolve(row, held.state, held);
        }

        const closing = row.state === 'open' ? await decide(row, await clock()) : row;

        return closing === null ? null : await close(closing);
    };

    const sweepPositions = async (tally: MarketSweep, deadline: number) =>
    {
        const rows = await positionQuery(db)
            .where(`p.state in ('prepared', 'sent')`)
            .orderBy('p.created_at', 'ASC')
            .limit(SWEEP_MOST)
            .getRawMany<PositionRow>();
        const watched = new Set(rows.map((row) => row.id));

        for (const id of askedAt.keys())
        {
            if (!watched.has(id))
            {
                askedAt.delete(id);
            }
        }

        for (const row of rows)
        {
            if (performance.now() > deadline)
            {
                return false;
            }

            const now = Date.now();

            if (row.state === 'prepared' && !row.lapsed && now - (askedAt.get(row.id) ?? 0) < UNSENT_EVERY_MS)
            {
                continue;
            }

            askedAt.set(row.id, now);

            try
            {
                const moved = await settlePosition(row, tally);

                if (moved !== null)
                {
                    tally[moved] += 1;
                }
            }
            catch (error)
            {
                tally.faults.push({ market: row.market_id, error: error instanceof Error ? error.message : String(error) });

                if ((error as { status?: number }).status === 503)
                {
                    return false;
                }
            }
        }

        return true;
    };

    /**
     * A claim whose hash names nothing the node holds: the wallet replaced it (sped up or cancelled)
     * or dropped it. Each position is then what the contract holds: claimed, by the transaction that
     * took its place, or claimable again. Answers how many it found claimed.
     */
    const settleGone = async (claim: { hash: string; ids: string[] }) =>
    {
        let claimed = 0;

        for (const id of claim.ids)
        {
            if ((await chain.positionOf(marketIdOf(id))).claimed)
            {
                claimed += await claimedUnseen(id, claim.hash) > 0 ? 1 : 0;
                continue;
            }

            await db.getRepository(MarketPosition)
                .createQueryBuilder()
                .update()
                .set({ claimHash: null, claimSentAt: null })
                .where('id = :id and claim_hash = :hash and claimed_at is null', { id, hash: claim.hash })
                .execute();
        }

        return claimed;
    };

    /** Claims sent from the reader's wallet, read off their receipts. */
    const sweepClaims = async (tally: MarketSweep, deadline: number) =>
    {
        const claims = await db.getRepository(MarketPosition)
            .createQueryBuilder('p')
            .select('p.claim_hash', 'hash')
            .addSelect('array_agg(p.id::text)', 'ids')
            .addSelect('array_agg(distinct p.bettor_id::text)', 'bettors')
            .where('p.claim_hash is not null and p.claimed_at is null')
            .groupBy('p.claim_hash')
            .limit(SWEEP_MOST)
            .getRawMany<{ hash: string; ids: string[]; bettors: string[] }>();
        const listed = new Set(claims.map((claim) => claim.hash));

        for (const hash of goneSince.keys())
        {
            if (!listed.has(hash))
            {
                goneSince.delete(hash);
            }
        }

        for (const claim of claims)
        {
            if (performance.now() > deadline)
            {
                return false;
            }

            try
            {
                const paid = await chain.claimsIn(claim.hash as Hex);

                if (paid === 'pending')
                {
                    goneSince.delete(claim.hash);
                    continue;
                }

                if (paid === 'unknown')
                {
                    const now = Date.now();
                    const since = goneSince.get(claim.hash) ?? now;

                    goneSince.set(claim.hash, since);

                    if (now - since >= GONE_AFTER_MS)
                    {
                        tally.claimed += await settleGone(claim);
                        goneSince.delete(claim.hash);
                        ring(null, claim.bettors);
                    }

                    continue;
                }

                for (const id of claim.ids)
                {
                    const found = paid === 'reverted' ? undefined : paid.find((one) => one.ticket.toLowerCase() === marketIdOf(id));
                    const { affected } = await db.getRepository(MarketPosition)
                        .createQueryBuilder()
                        .update()
                        .set(found === undefined ? { claimHash: null, claimSentAt: null } : { claimedAt: () => 'now()', paid: found.amount.toString() })
                        .where('id = :id and claim_hash = :hash and claimed_at is null', { id, hash: claim.hash })
                        .execute();

                    tally.claimed += found !== undefined && (affected ?? 0) > 0 ? 1 : 0;
                }

                ring(null, claim.bettors);
            }
            catch (error)
            {
                tally.faults.push({ market: claim.hash, error: error instanceof Error ? error.message : String(error) });

                if ((error as { status?: number }).status === 503)
                {
                    return false;
                }
            }
        }

        return true;
    };

    const sweepMarkets = async (tally: MarketSweep, deadline: number) =>
    {
        const rows = await marketQuery(db)
            .where(`k.state in ('open', 'closing') or (k.state = 'settled' and k.claimable_at + ${ LAPSE } > now())`)
            .orderBy('k.closes_at', 'ASC')
            .limit(SWEEP_MOST)
            .getRawMany<MarketRow>();
        const watched = new Set(rows.map((row) => row.id));

        for (const id of overturnAskedAt.keys())
        {
            if (!watched.has(id))
            {
                overturnAskedAt.delete(id);
            }
        }

        let chainNow: number | null = null;
        const clock = async () => (chainNow ??= Number(await chain.clock()) * 1000);

        for (const row of rows)
        {
            if (performance.now() > deadline)
            {
                return;
            }

            try
            {
                const moved = await step(row, clock);

                if (moved !== null)
                {
                    tally[moved] += 1;
                }
            }
            catch (error)
            {
                tally.faults.push({ market: row.id, error: error instanceof Error ? error.message : String(error) });

                if ((error as { status?: number }).status === 503)
                {
                    return;
                }
            }
        }
    };

    const auditMarketQuery = () => marketQuery(db).addSelect(HANDLES, 'handles').addSelect(keyOf('k.created_at'), 'at_key');

    const auditPositionQuery = () => positionQuery(db).innerJoin('users', 'b', 'b.id = p.bettor_id').addSelect('b.handle::text', 'bettor');

    /**
     * One market no worker is moving, against what the contract holds: its state, and settled or
     * refunded, the winner it named, and settled, when its winners may claim. A settled market the
     * chain holds as called off was overturned while the worker was not asking: its own `resolve`.
     */
    const comparedMarket = async (row: AuditMarketRow) =>
    {
        if (row.state === 'open' || row.state === 'closing' || (row.state === 'settled' && row.disputed))
        {
            return null;
        }

        const held = await chain.marketOf(marketIdOf(row.id));
        const verdict = marketVerdict(row.state as MarketAfter, held.state);
        const about = { game: row.game, match: row.match_id };
        const state: Finding = { record: row.id, kind: 'market-state', db: { state: row.state }, chain: { state: held.state }, about };

        if (verdict === 'put-right')
        {
            return await resolve(row, 'cancelled', held) === null ? [] : [{ ...state, putRight: true as const }];
        }

        if (verdict === 'person')
        {
            return [state];
        }

        const found: Finding[] = [];

        if ((row.state === 'settled' || row.state === 'refunded') && row.outcome !== held.winner)
        {
            found.push({
                record: row.id,
                kind: 'market-winner',
                db: outcomeWords(row.choices, row.handles, row.outcome),
                chain: outcomeWords(row.choices, row.handles, held.winner),
                about
            });
        }

        const claimable = row.claimable_at === null ? null : BigInt(Math.floor(new Date(row.claimable_at).getTime() / 1000));

        if (row.state === 'settled' && claimable !== held.claimableAt)
        {
            found.push({
                record: row.id,
                kind: 'market-claimable',
                db: claimable === null ? {} : { at: new Date(Number(claimable) * 1000).toISOString() },
                chain: { at: new Date(Number(held.claimableAt) * 1000).toISOString() },
                about
            });
        }

        return found;
    };

    /**
     * One position no worker is moving, against what the contract holds under its ticket. Held as it
     * was prepared after it was let go of here, it is the worker's own `confirm`; claimed by a call
     * this server never read, the claim route's own write.
     */
    const comparedPosition = async (row: AuditPositionRow) =>
    {
        if (row.state === 'prepared' || row.state === 'sent' || (row.claim_hash !== null && row.claimed_at === null))
        {
            return null;
        }

        const held = await chain.positionOf(marketIdOf(row.id));
        const given: Given = held.bettor === null
            ? 'none'
            : held.bettor.toLowerCase() === row.address && held.outcome === row.outcome && held.amount === BigInt(row.amount) ? 'prepared' : 'other';
        const verdict = positionVerdict(row.state as PositionAfter, given);
        const about: Words = { game: row.game, amount: row.amount, who: row.bettor, ...outcomeWords(row.choices, row.handles, row.outcome) };

        if (verdict === 'put-right')
        {
            const placed: Finding = { record: row.id, kind: 'position-state', db: { state: row.state }, chain: { state: 'placed' }, about, putRight: true };

            return await confirm(row) === null ? [] : [placed];
        }

        if (verdict === 'person')
        {
            const found: Finding = given === 'other'
                ? {
                    record: row.id,
                    kind: 'position-ticket',
                    db: { amount: row.amount, address: row.address, ...outcomeWords(row.choices, row.handles, row.outcome) },
                    chain: { amount: held.amount.toString(), address: held.bettor?.toLowerCase() ?? '', ...outcomeWords(row.choices, row.handles, held.outcome) },
                    about
                }
                : { record: row.id, kind: 'position-state', db: { state: row.state }, chain: { state: 'none' }, about };

            return [found];
        }

        if (row.state !== 'confirmed')
        {
            return [];
        }

        const claim = claimVerdict(row.claimed_at !== null, held.claimed);
        const finding: Finding = {
            record: row.id,
            kind: 'position-claim',
            db: { state: row.claimed_at === null ? 'unclaimed' : 'claimed' },
            chain: { state: held.claimed ? 'claimed' : 'unclaimed' },
            about
        };

        if (claim === 'agree')
        {
            return [];
        }

        if (claim === 'person')
        {
            return [finding];
        }

        if (await claimedUnseen(row.id, null) === 0)
        {
            return [];
        }

        ring(null, [row.bettor_id]);

        return [{ ...finding, putRight: true as const }];
    };

    const stateFor = async (me: string, country: string | null): Promise<MarketsState> =>
    {
        if (!open)
        {
            return { open: false };
        }

        const [standing, accepted] = await Promise.all([standingOf(me), disclosed(me)]);

        return {
            open: true,
            may: mayOf(country, standing, accepted),
            presets: MARKET_PRESETS_NURA.map((amount) => nura(amount).toString()),
            least: LEAST.toString(),
            most: nura(MAX_STAKE_NURA).toString(),
            perBettor: nura(MAX_PER_BETTOR_NURA).toString(),
            perDay: nura(MAX_PER_DAY_NURA).toString(),
            pool: nura(MAX_POOL_NURA).toString(),
            feeBps: MARKET_FEE_BPS,
            window: MARKET_WINDOW_MS / 1000
        };
    };

    return {
        open,

        state: stateFor,

        /** That the reader read what a market is: asked once, before their first position. */
        async disclose(me: string, country: string | null)
        {
            if (!open)
            {
                throw notOpen();
            }

            await db.getRepository(MarketDisclosure).createQueryBuilder().insert().values({ userId: me }).orIgnore().execute();
            ring(null, [me]);

            return await stateFor(me, country);
        },

        /**
         * The market on a game the reader may watch, opened the first time it is asked for, or the one
         * they hold a stake in whatever became of its table. A game with none, or one the reader may
         * not see, answers with no market: most games have none, and it is no refusal.
         */
        async view(me: string, country: string | null, matchId: string): Promise<MarketLook>
        {
            if (!open)
            {
                throw notOpen();
            }

            const standing = await standingOf(me);
            const may = mayOf(country, standing, true);

            if (may === 'market-region' || may === 'market-minor')
            {
                throw mayRefused[may]();
            }

            const market = UUID.test(matchId) ? await marketOfMatch(me, matchId) : null;

            if (market === null || !(await watches(me, market.table_id) || await holdsIn(me, market.id)))
            {
                return {};
            }

            const [players, pools, bettors, held] = await Promise.all([
                db.getRepository(MatchPlayer)
                    .createQueryBuilder('p')
                    .innerJoin('users', 'u', 'u.id = p.user_id')
                    .select('p.seat', 'seat')
                    .addSelect('u.handle::text', 'handle')
                    .where('p.match_id = :matchId', { matchId: market.match_id })
                    .getRawMany<{ seat: number; handle: string }>(),
                poolsOf([market.id]),
                db.getRepository(MarketPosition)
                    .createQueryBuilder('p')
                    .select('count(distinct p.bettor_id)::int', 'bettors')
                    .where(`p.market_id = :id and p.state = 'confirmed'`, { id: market.id })
                    .getRawOne<{ bettors: number }>(),
                positionQuery(db)
                    .where('p.market_id = :id and p.bettor_id = :me', { id: market.id, me })
                    .orderBy('p.created_at', 'DESC')
                    .limit(PAGE)
                    .getRawMany<PositionRow>()
            ]);
            const handles = new Map(players.map((one) => [one.seat, one.handle]));
            const byOutcome = pools.get(market.id) ?? new Map<number, bigint>();
            const pool = [...byOutcome.values()].reduce((sum, one) => sum + one, 0n);

            return {
                market: {
                    id: market.id,
                    match: market.match_id,
                    game: market.game,
                    state: market.state,
                    closesAt: new Date(market.closes_at).toISOString(),
                    feeBps: market.fee_bps,
                    minBettors: market.min_bettors,
                    minOutcomes: market.min_outcomes,
                    outcomes: market.choices.map((choice, index) => ({ choice: choiceView(choice, handles), pool: (byOutcome.get(index) ?? 0n).toString() })),
                    pool: pool.toString(),
                    bettors: bettors?.bettors ?? 0,
                    ...(market.outcome === null || market.state === 'open' ? {} : { outcome: market.outcome }),
                    ...(market.claimable_at === null ? {} : { claimableAt: new Date(market.claimable_at).toISOString() }),
                    ...(market.tx_hash === null ? {} : { hash: market.tx_hash }),
                    mine: held.map((row) => asPosition(row, pools))
                }
            };
        },

        /**
         * A position on one outcome of a market, and the call the reader's wallet sends to place it.
         * No ticket is signed for a game that is over, nor for a market about to close.
         */
        async place(me: string, country: string | null, marketId: string, input: { outcome: number; amount: string }): Promise<MarketPaying>
        {
            if (!open)
            {
                throw notOpen();
            }

            const bettor = await mustMay(me, country);
            const market = UUID.test(marketId) ? await marketQuery(db).where('k.id = :marketId', { marketId }).getRawOne<MarketRow>() : undefined;

            if (market === undefined || !(await watches(me, market.table_id)))
            {
                throw noMarket();
            }

            if (await playsIn(me, market.match_id))
            {
                throw marketRefusal('market-playing', 'You are playing in this game.');
            }

            if (market.state !== 'open' || market.finished_at !== null || market.left_s < CLOSE_MARGIN_S)
            {
                throw closed();
            }

            if (input.outcome >= market.outcomes)
            {
                throw marketRefusal('market-outcome', 'That is not one of this market\'s outcomes.');
            }

            const amount = weiOf(input.amount);

            if (amount === null || amount < LEAST || amount > BigInt(market.max_stake))
            {
                throw marketRefusal('market-amount', `A position is ${ LEAST_STAKE_NURA } to ${ MAX_STAKE_NURA } NURA.`);
            }

            const placed = await prepare(me, bettor, market, input.outcome, amount);

            try
            {
                // Asked of the wallet itself: not every node refuses a call that carries more than its sender holds.
                const held = await chain.balanceOf(bettor);

                if (held < amount)
                {
                    throw placeRefusalOf('InsufficientFunds', placed.row.amount, held);
                }

                const terms = termsOf(market.id, market);
                const ticket = ticketOf(terms, placed.row);
                const asked = await chain.placeCall(terms, ticket, await chain.sign(ticket));

                if (!asked.ok)
                {
                    throw placeRefusalOf(asked.error, placed.row.amount, held);
                }

                ring(null, [me]);

                return { position: (await positionsAs([placed.row]))[0], call: wireOf(bettor, asked.call) };
            }
            catch (error)
            {
                if (placed.fresh)
                {
                    await forget(placed.row.id);
                }

                throw error;
            }
        },

        one: mine,

        /** The transaction the bettor's wallet sent for a position: it says what NuraChain did with it, and nothing is confirmed for it. */
        async sent(me: string, id: string, hash: string)
        {
            if (!UUID.test(id))
            {
                throw noPosition();
            }

            try
            {
                await db.getRepository(MarketPosition)
                    .createQueryBuilder()
                    .update()
                    .set({ state: 'sent', txHash: hash.toLowerCase(), failure: null })
                    .where('id = :id and bettor_id = :me', { id, me })
                    .andWhere(`state in ('prepared', 'sent')`)
                    .execute();
            }
            catch (error)
            {
                if ((error as { driverError?: { code?: string } }).driverError?.code === '23505')
                {
                    throw marketRefusal('market-hash', 'That transaction is another position\'s.');
                }

                throw error;
            }

            const position = await mine(me, id);

            ring(null, [me]);

            return position;
        },

        /** The reader's positions, every state, newest first. */
        async positions(me: string, cursor: string | null): Promise<MarketPositions>
        {
            const after = keysetAfter(cursor);
            const query = positionQuery(db).where('p.bettor_id = :me', { me });

            if (after !== null)
            {
                query.andWhere(olderThan('p.created_at', 'p.id'), after);
            }

            const rows = await query.orderBy('p.created_at', 'DESC').addOrderBy('p.id', 'DESC').limit(PAGE + 1).getRawMany<PositionRow>();

            return { positions: await positionsAs(rows.slice(0, PAGE)), ...cursorOf(rows, PAGE) };
        },

        /**
         * The claim the reader's wallet sends for the positions named that the contract would pay now,
         * all placed from one wallet. Never refused for where the reader is or a break: what a claim
         * pays is theirs. One the contract says was claimed already is written down as claimed.
         */
        async claim(me: string, ids: readonly string[])
        {
            if (!chain.configured)
            {
                throw notOpen();
            }

            const wanted = ids.filter((id) => UUID.test(id));
            const rows = wanted.length === 0
                ? []
                : await positionQuery(db).where('p.bettor_id = :me and p.id = any(:ids::uuid[])', { me, ids: wanted }).andWhere(CLAIMABLE).getRawMany<PositionRow>();

            if (rows.length === 0 || rows.some((row) => row.address !== rows[0].address))
            {
                throw unclaimable();
            }

            const from = getAddress(rows[0].address);
            let asked = await chain.claimCall(from, rows.map((row) => marketIdOf(row.id)));

            if (!asked.ok && (asked.error === 'AlreadyClaimed' || asked.error === 'NothingOwed'))
            {
                const left: PositionRow[] = [];

                for (const row of rows)
                {
                    if ((await chain.positionOf(marketIdOf(row.id))).claimed)
                    {
                        await claimedUnseen(row.id);
                    }
                    else
                    {
                        left.push(row);
                    }
                }

                ring(null, [me]);

                if (left.length === 0)
                {
                    throw unclaimable();
                }

                asked = await chain.claimCall(from, left.map((row) => marketIdOf(row.id)));
            }

            if (!asked.ok)
            {
                throw claimRefusalOf(asked.error);
            }

            return wireOf(from, asked.call);
        },

        /** The claim the reader's wallet sent: what it paid is read off its receipt, never taken from here. */
        async claimSent(me: string, hash: string, ids: readonly string[]): Promise<MarketPositions>
        {
            const wanted = ids.filter((id) => UUID.test(id));

            if (wanted.length > 0)
            {
                await db.getRepository(MarketPosition)
                    .createQueryBuilder()
                    .update()
                    .set({ claimHash: hash.toLowerCase(), claimSentAt: () => 'now()' })
                    .where(`bettor_id = :me and id = any(:ids::uuid[]) and state = 'confirmed' and claimed_at is null`, { me, ids: wanted })
                    .execute();
            }

            ring(null, [me]);

            const rows = wanted.length === 0
                ? []
                : await positionQuery(db).where('p.bettor_id = :me and p.id = any(:ids::uuid[])', { me, ids: wanted }).orderBy('p.created_at', 'DESC').getRawMany<PositionRow>();

            return { positions: await positionsAs(rows) };
        },

        /** Every market no worker is moving that was made in the last week, against what the contract holds, and those with a disagreement open. */
        async auditMarkets({ ids, after, deadline }: AuditAsk)
        {
            if (!chain.configured)
            {
                return nothing();
            }

            const known = ids.filter((id) => UUID.test(id));
            const again = known.length === 0 ? [] : await auditMarketQuery().where('k.id = any(:ids::uuid[])', { ids: known }).getRawMany<AuditMarketRow>();
            const from = keysetAfter(after);
            const page = auditMarketQuery()
                .where(`k.state not in ('open', 'closing')`)
                .andWhere(`not (k.state = 'settled' and coalesce(k.claimable_at + ${ LAPSE } > now(), false))`)
                .andWhere(`k.created_at > now() - ${ RECENT }`);

            if (from !== null)
            {
                page.andWhere(olderThan('k.created_at', 'k.id'), from);
            }

            const rows = await page.orderBy('k.created_at', 'DESC').addOrderBy('k.id', 'DESC').limit(AUDIT_PAGE + 1).getRawMany<AuditMarketRow>();

            return await audited({ again, page: rows, after }, deadline, comparedMarket);
        },

        /**
         * Every position no worker is moving, against what the contract holds: one that can still be
         * claimed whatever its age, any other made in the last week, and those with a disagreement open.
         * A loser in a market settled past its dispute window can never be claimed, and is left to the week.
         */
        async auditPositions({ ids, after, deadline }: AuditAsk)
        {
            if (!chain.configured)
            {
                return nothing();
            }

            const known = ids.filter((id) => UUID.test(id));
            const again = known.length === 0 ? [] : await auditPositionQuery().where('p.id = any(:ids::uuid[])', { ids: known }).getRawMany<AuditPositionRow>();
            const from = keysetAfter(after);
            const page = auditPositionQuery()
                .where(`p.state not in ('prepared', 'sent')`)
                .andWhere('not (p.claim_hash is not null and p.claimed_at is null)')
                .andWhere(`(p.created_at > now() - ${ RECENT } or (${ CLAIMS_YET }))`);

            if (from !== null)
            {
                page.andWhere(olderThan('p.created_at', 'p.id'), from);
            }

            const rows = await page.orderBy('p.created_at', 'DESC').addOrderBy('p.id', 'DESC').limit(AUDIT_PAGE + 1).getRawMany<AuditPositionRow>();

            return await audited({ again, page: rows, after }, deadline, comparedPosition);
        },

        async sweep(budgetMs: number)
        {
            const tally: MarketSweep = { placed: 0, refused: 0, lapsed: 0, sent: 0, settled: 0, refunded: 0, cancelled: 0, expired: 0, empty: 0, claimed: 0, faults: [] };

            if (!open)
            {
                return tally;
            }

            const deadline = performance.now() + budgetMs;

            if (await sweepPositions(tally, deadline) && await sweepClaims(tally, deadline))
            {
                await sweepMarkets(tally, deadline);
            }

            return tally;
        }
    };
}

export type MarketService = ReturnType<typeof createMarketService>;
