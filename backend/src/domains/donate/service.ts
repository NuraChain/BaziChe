import { HttpError } from '@azerothjs/http';
import type { DataSource, EntityManager } from 'typeorm';
import { getAddress, toHex, type Address, type Hex } from 'viem';

import { tipIdOf, type TipCall, type TipsChain } from '../../chain/tips.ts';
import { Donation } from '../../entities/donation.entity.ts';
import { DonationsOff } from '../../entities/donations-off.entity.ts';
import { MatchPlayer } from '../../entities/match-player.entity.ts';
import { Match } from '../../entities/match.entity.ts';
import { cursorOf, keyOf, keysetAfter, olderThan } from '../../lib/keyset.ts';
import type { DonationPaying, DonationPlayers, DonationView, Donations, DonationsState } from '../../schemas.ts';
import { audited, AUDIT_PAGE, nothing, RECENT, type AuditAsk, type Finding } from '../reconcile/audit.ts';
import { donationVerdict, type DonationAfter, type Given } from '../reconcile/verdicts.ts';
import { eligibilityOf, WEI_PER_NURA, type Eligibility, type Standing } from '../stake/policy.ts';
import { LEAST_NURA, MOST_NURA, PRESETS_NURA, type DonateMay, type DonationState } from './policy.ts';
import { DONATE_REFUSALS, type DonateRefusal } from './refusals.ts';

/** How long a prepared gift's call is good for: the contract takes it until then and never after. */
const GIFT_LIFE = `interval '30 minutes'`;

/** A gift asked for again is handed back only while it has this long left to be sent. */
const REUSE_LEAST_S = 120;

/** How long after its deadline a gift nobody made is let go of: a block's clock can run ahead of this one. */
const LAPSE = `interval '5 minutes'`;

/** How often a gift nobody said they sent is asked about: the wallet may have sent it after its tab closed. */
const UNSENT_EVERY_MS = 30_000;

const PAGE = 50;

/** The most gifts one pass of the worker looks at. */
const SWEEP_MOST = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEAST = BigInt(LEAST_NURA) * WEI_PER_NURA;

const MOST = BigInt(MOST_NURA) * WEI_PER_NURA;

export interface DonationHooks
{
    /** Whose gifts changed: the giver, and the receiver once one is theirs. */
    changed(userIds: readonly string[]): void;

    /** A gift the contract holds as it was prepared; told once, after it is written. */
    confirmed(gift: { id: string; giver: string; receiver: string; match: string; amount: string }): Promise<void>;
}

export interface DonateSweep
{
    confirmed: number;
    reverted: number;
    expired: number;
    failed: number;
    faults: { donation: string; error: string }[];
}

interface DonationRow
{
    id: string;
    giver_id: string;
    receiver_id: string;
    giver: string;
    receiver: string;
    match_id: string;
    game: string;
    amount: string;
    giver_address: string;
    receiver_address: string;
    deadline: Date;
    state: DonationState;
    tx_hash: string | null;
    failure: string | null;
    created_at: Date;
    confirmed_at: Date | null;
    left_s: number;
    lapsed: boolean;
    at_key: string;
}

interface PlayerRow
{
    id: string;
    handle: string;
    address: string | null;
    minor: boolean;
    suspended: boolean;
    off: boolean;
    apart: boolean;
}

const walletOf = (alias: string) =>
    `(select w.address from wallets w where w.user_id = ${ alias }.id order by w.last_used_at desc nulls last limit 1)`;

const donationQuery = (from: DataSource | EntityManager) => from.getRepository(Donation)
    .createQueryBuilder('d')
    .innerJoin('users', 'g', 'g.id = d.giver_id')
    .innerJoin('users', 'r', 'r.id = d.receiver_id')
    .innerJoin(Match, 'm', 'm.id = d.match_id')
    .select('d.id', 'id')
    .addSelect('d.giver_id', 'giver_id')
    .addSelect('d.receiver_id', 'receiver_id')
    .addSelect('g.handle::text', 'giver')
    .addSelect('r.handle::text', 'receiver')
    .addSelect('d.match_id', 'match_id')
    .addSelect('m.game', 'game')
    .addSelect('d.amount::text', 'amount')
    .addSelect('d.giver_address', 'giver_address')
    .addSelect('d.receiver_address', 'receiver_address')
    .addSelect('d.deadline', 'deadline')
    .addSelect('d.state', 'state')
    .addSelect('d.tx_hash', 'tx_hash')
    .addSelect('d.failure', 'failure')
    .addSelect('d.created_at', 'created_at')
    .addSelect('d.confirmed_at', 'confirmed_at')
    .addSelect('greatest(0, extract(epoch from d.deadline - now()))::int', 'left_s')
    .addSelect(`d.deadline + ${ LAPSE } < now()`, 'lapsed')
    .addSelect(keyOf('d.created_at'), 'at_key');

const asDonation = (row: DonationRow, side: 'given' | 'received'): DonationView => ({
    id: row.id,
    ...(side === 'given' ? { to: row.receiver } : { from: row.giver }),
    amount: row.amount,
    state: row.state,
    game: row.game,
    deadline: new Date(row.deadline).toISOString(),
    ...(row.tx_hash === null ? {} : { hash: row.tx_hash }),
    ...(row.failure === null ? {} : { failure: row.failure }),
    at: new Date(row.created_at).toISOString(),
    ...(row.confirmed_at === null ? {} : { confirmedAt: new Date(row.confirmed_at).toISOString() })
});

const wireOf = (from: Address, call: TipCall) => ({
    from,
    to: call.to,
    data: call.data,
    value: toHex(call.value),
    chainId: call.chainId,
    ...(call.gasPrice === null ? {} : { gasPrice: toHex(call.gasPrice) })
});

const secondsOf = (deadline: Date) => BigInt(Math.floor(new Date(deadline).getTime() / 1000));

export const donateRefusal = (word: DonateRefusal, message: string, details?: Record<string, string>) =>
    new HttpError(DONATE_REFUSALS[word], message, { code: word, ...(details === undefined ? {} : { details }) });

const MAY_OF = {
    'yes': 'yes',
    'paid-wallet': 'donate-wallet',
    'paid-minor': 'donate-minor',
    'paid-terms': 'donate-terms',
    'paid-break': 'donate-break'
} as const satisfies Record<Eligibility, DonateMay>;

const giverRefused = {
    'donate-wallet': () => donateRefusal('donate-wallet', 'Giving NURA needs a wallet account.'),
    'donate-minor': () => donateRefusal('donate-minor', 'Giving NURA is for adults only.'),
    'donate-terms': () => donateRefusal('donate-terms', 'Confirm the terms of playing for NURA first.'),
    'donate-break': () => donateRefusal('donate-break', 'You asked for a break from playing for NURA.')
};

const notOpen = () => donateRefusal('donate-off', 'Donations are not open here.');
const nobody = () => donateRefusal('donate-nobody', 'No one by that name can be given NURA here.');
const noDonation = () => donateRefusal('donate-missing', 'No donation of yours by that name.');

/** What the contract's refusal of a gift means to whoever asked to make it. */
const refusalOf = (error: string, amount: string, held: bigint) =>
{
    switch (error)
    {
        case 'InsufficientFunds':
            return donateRefusal('donate-funds', 'Your wallet does not hold enough NURA for this.', { amount, held: held.toString() });
        case 'EnforcedPause':
            return donateRefusal('donate-closed', 'Donations are paused for now.');
        default:
            return donateRefusal('donate-refused', 'NuraChain would not take this gift.', { error });
    }
};

/**
 * Donations: NURA a watcher gives a player of the game they watch, sent from the giver's own wallet
 * to `ArcadeTips` under the donation's id. This server never holds NURA and never takes the
 * browser's word that a gift was made: the worker asks the contract about each one by its giver
 * and its id, and believes it only when the contract holds the gift that was prepared.
 */
export function createDonationService(
    db: DataSource,
    tips: TipsChain,
    standingOf: (me: string) => Promise<Standing>,
    mayWatch: (tableId: string, userIds: readonly string[]) => Promise<string[]>,
    hooks: DonationHooks
)
{
    /** When each gift nobody said they sent was last asked about, in this process. */
    const askedAt = new Map<string, number>();

    /**
     * The players of a live game the giver may watch, each with whether a gift could go to them, in
     * one read: a wallet, an adult, not suspended, taking donations, and no block either way.
     */
    const playersOf = async (me: string, matchId: string) =>
    {
        if (!UUID.test(matchId))
        {
            return null;
        }

        const match = await db.getRepository(Match).findOne({ select: { id: true, tableId: true, finishedAt: true }, where: { id: matchId } });

        if (match === null || match.finishedAt !== null || !(await mayWatch(match.tableId, [me])).includes(me))
        {
            return null;
        }

        const rows = await db.getRepository(MatchPlayer)
            .createQueryBuilder('p')
            .innerJoin('users', 'u', 'u.id = p.user_id')
            .select('p.user_id', 'id')
            .addSelect('u.handle::text', 'handle')
            .addSelect(walletOf('u'), 'address')
            .addSelect('u.is_minor', 'minor')
            .addSelect('u.is_suspended', 'suspended')
            .addSelect((query) => query.select('count(*) > 0').from(DonationsOff, 'o').where('o.user_id = u.id'), 'off')
            .addSelect('exists (select 1 from blocks b where (b.user_id = u.id and b.blocked_id = :me) or (b.user_id = :me and b.blocked_id = u.id))', 'apart')
            .where('p.match_id = :matchId', { matchId, me })
            .orderBy('p.seat', 'ASC')
            .getRawMany<PlayerRow>();
        const players = rows.map((row) => ({
            ...row,
            may: row.id !== me && row.address !== null && !row.minor && !row.suspended && !row.off && !row.apart
        }));

        return { matchId: match.id, players, playing: rows.some((row) => row.id === me) };
    };

    /**
     * The gift a giver makes: the one they already hold for this player, this game and this amount
     * while it has time left, or a new one. One giver's gifts are written one at a time.
     */
    const place = async (me: string, giver: Address, receiver: { id: string; address: string }, matchId: string, amount: bigint) => await db.transaction(async (tx) =>
    {
        // No repository can take an advisory lock.
        await tx.query(`select pg_advisory_xact_lock(hashtext('donate:giver'), hashtext($1))`, [me]);

        const again = await donationQuery(tx)
            .where('d.giver_id = :me and d.receiver_id = :receiver and d.match_id = :matchId', { me, receiver: receiver.id, matchId })
            .andWhere('d.amount = :amount and d.giver_address = :address', { amount: amount.toString(), address: giver.toLowerCase() })
            .andWhere(`d.state = 'prepared'`)
            .andWhere(`d.deadline > now() + interval '${ REUSE_LEAST_S } seconds'`)
            .orderBy('d.created_at', 'DESC')
            .getRawOne<DonationRow>();

        if (again !== undefined)
        {
            return { row: again, fresh: false };
        }

        const { identifiers } = await tx.getRepository(Donation).insert({
            giverId: me,
            receiverId: receiver.id,
            matchId,
            amount: amount.toString(),
            giverAddress: giver.toLowerCase(),
            receiverAddress: receiver.address.toLowerCase(),
            deadline: () => `date_trunc('second', now() + ${ GIFT_LIFE })`,
            state: 'prepared'
        });
        const row = await donationQuery(tx).where('d.id = :id', { id: identifiers[0].id }).getRawOne<DonationRow>();

        return { row: row!, fresh: true };
    });

    const forget = (id: string) => db.getRepository(Donation).delete({ id, state: 'prepared' });

    const one = async (me: string, id: string) =>
    {
        const row = UUID.test(id)
            ? await donationQuery(db).where('d.id = :id and d.giver_id = :me', { id, me }).getRawOne<DonationRow>()
            : undefined;

        if (row === undefined)
        {
            throw noDonation();
        }

        return asDonation(row, 'given');
    };

    /**
     * A gift the contract holds as it was prepared, written once under its row's lock, whatever was
     * said of it before: a gift let go of here whose call a block clock behind took after all, or one
     * that reverted and that the wallet sent again, is given all the same.
     */
    const confirm = async (row: DonationRow) =>
    {
        const { affected } = await db.getRepository(Donation)
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

        hooks.changed([row.giver_id, row.receiver_id]);
        await hooks.confirmed({ id: row.id, giver: row.giver_id, receiver: row.receiver_id, match: row.match_id, amount: row.amount });

        return 'confirmed' as const;
    };

    const settleAs = async (row: DonationRow, state: 'reverted' | 'failed' | 'expired', failure: string | null, from: readonly DonationState[] = ['prepared', 'sent']) =>
    {
        const update = db.getRepository(Donation)
            .createQueryBuilder()
            .update()
            .set({ state, failure })
            .where('id = :id', { id: row.id })
            .andWhere('state in (:...from)', { from });

        if (state === 'expired')
        {
            update.andWhere(`deadline + ${ LAPSE } < now()`);
        }

        const { affected } = await update.execute();

        if (affected === 0)
        {
            return null;
        }

        hooks.changed([row.giver_id]);

        return state;
    };

    /** The word the contract gives this gift now; a call it would take now was refused for its gas. */
    const why = async (row: DonationRow) =>
    {
        try
        {
            const asked = await tips.tipCall(getAddress(row.giver_address), tipIdOf(row.id), getAddress(row.receiver_address), BigInt(row.amount), secondsOf(row.deadline));

            return asked.ok ? 'reverted' : asked.error;
        }
        catch
        {
            return 'reverted';
        }
    };

    /**
     * One gift asked of the contract: confirmed once it holds the gift that was prepared, failed when
     * it holds something else under the id, reverted when its transaction was refused, expired once
     * it can never be made.
     */
    const settle = async (row: DonationRow) =>
    {
        const held = await tips.tipOf(getAddress(row.giver_address), tipIdOf(row.id));

        if (held.to !== null)
        {
            return held.to.toLowerCase() === row.receiver_address && held.amount === BigInt(row.amount)
                ? await confirm(row)
                : await settleAs(row, 'failed', 'mismatch');
        }

        if (row.state === 'sent' && row.tx_hash !== null && await tips.mined(row.tx_hash as Hex) === 'reverted')
        {
            return await settleAs(row, 'reverted', (await why(row)).slice(0, 48));
        }

        return row.lapsed ? await settleAs(row, 'expired', null) : null;
    };

    /**
     * One gift no worker is moving, against what the contract holds under its giver and id. Held as
     * it was prepared, it is the worker's own `confirm`; held as something else, its `failed`.
     */
    const compared = async (row: DonationRow) =>
    {
        if (row.state === 'prepared' || row.state === 'sent')
        {
            return null;
        }

        const held = await tips.tipOf(getAddress(row.giver_address), tipIdOf(row.id));
        const given: Given = held.to === null
            ? 'none'
            : held.to.toLowerCase() === row.receiver_address && held.amount === BigInt(row.amount) ? 'prepared' : 'other';
        const verdict = donationVerdict(row.state as DonationAfter, given);
        const about = { game: row.game, amount: row.amount, who: row.giver, to: row.receiver, ...(row.tx_hash === null ? {} : { tx: row.tx_hash }) };

        if (verdict === 'agree')
        {
            return [];
        }

        const finding: Finding = given === 'other'
            ? {
                record: row.id,
                kind: 'donation-gift',
                db: { amount: row.amount, address: row.receiver_address },
                chain: { amount: held.amount.toString(), address: held.to?.toLowerCase() ?? '' },
                about
            }
            : { record: row.id, kind: 'donation-state', db: { state: row.state }, chain: { state: given === 'none' ? 'none' : 'held' }, about };

        if (verdict !== 'put-right')
        {
            return [finding];
        }

        const done = given === 'prepared' ? await confirm(row) : await settleAs(row, 'failed', 'mismatch', ['expired', 'reverted']);

        return done === null ? [] : [{ ...finding, putRight: true as const }];
    };

    return {
        async state(me: string): Promise<DonationsState>
        {
            if (!tips.configured)
            {
                return { open: false };
            }

            const [standing, off] = await Promise.all([standingOf(me), db.getRepository(DonationsOff).existsBy({ userId: me })]);

            return {
                open: true,
                accepting: !off,
                may: MAY_OF[eligibilityOf(standing)],
                presets: PRESETS_NURA.map((nura) => (BigInt(nura) * WEI_PER_NURA).toString()),
                least: LEAST.toString(),
                most: MOST.toString()
            };
        },

        /** Whether the reader takes donations from now on. Nothing already given is taken back. */
        async accept(me: string, on: boolean)
        {
            if (on)
            {
                await db.getRepository(DonationsOff).delete({ userId: me });
            }
            else
            {
                await db.getRepository(DonationsOff).createQueryBuilder().insert().values({ userId: me }).orIgnore().execute();
            }

            hooks.changed([me]);

            return { accepting: on };
        },

        async players(me: string, matchId: string): Promise<DonationPlayers>
        {
            if (!tips.configured)
            {
                throw notOpen();
            }

            const found = await playersOf(me, matchId);

            return { players: (found?.players ?? []).map((one) => ({ who: one.handle, may: one.may && !found!.playing })) };
        },

        /** A gift for a player of a game the reader watches, and the call their wallet sends to make it. */
        async prepare(me: string, input: { match: string; to: string; amount: string }): Promise<DonationPaying>
        {
            if (!tips.configured)
            {
                throw notOpen();
            }

            const standing = await standingOf(me);
            const may = MAY_OF[eligibilityOf(standing)];

            if (may !== 'yes')
            {
                throw giverRefused[may]();
            }

            const amount = BigInt(input.amount);

            if (amount < LEAST || amount > MOST)
            {
                throw donateRefusal('donate-amount', `A gift is ${ LEAST_NURA } to ${ MOST_NURA.toLocaleString('en') } NURA.`);
            }

            const found = await playersOf(me, input.match);

            if (found === null)
            {
                throw nobody();
            }

            if (found.playing)
            {
                throw donateRefusal('donate-playing', 'You are playing in this game.');
            }

            const handle = input.to.trim().replace(/^@/, '').toLowerCase();
            const receiver = found.players.find((one) => one.handle.toLowerCase() === handle);

            if (receiver === undefined || !receiver.may || receiver.address === null)
            {
                throw nobody();
            }

            const giver = getAddress(standing.address!);
            const placed = await place(me, giver, { id: receiver.id, address: receiver.address }, found.matchId, amount);

            try
            {
                // Asked of the wallet itself: not every node refuses a call that carries more than its sender holds.
                const held = await tips.balanceOf(giver);

                if (held < amount)
                {
                    throw refusalOf('InsufficientFunds', placed.row.amount, held);
                }

                const asked = await tips.tipCall(giver, tipIdOf(placed.row.id), getAddress(receiver.address), amount, secondsOf(placed.row.deadline));

                if (!asked.ok)
                {
                    throw refusalOf(asked.error, placed.row.amount, held);
                }

                hooks.changed([me]);

                return { donation: asDonation(placed.row, 'given'), call: wireOf(giver, asked.call) };
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

        one,

        /** The transaction the giver's wallet sent for a gift: it says what NuraChain did with it, and nothing is confirmed for it. */
        async sent(me: string, id: string, hash: string)
        {
            if (!UUID.test(id))
            {
                throw noDonation();
            }

            try
            {
                await db.getRepository(Donation)
                    .createQueryBuilder()
                    .update()
                    .set({ state: 'sent', txHash: hash.toLowerCase(), sentAt: () => 'now()', failure: null })
                    .where('id = :id and giver_id = :me', { id, me })
                    .andWhere(`state in ('prepared', 'sent')`)
                    .execute();
            }
            catch (error)
            {
                if ((error as { driverError?: { code?: string } }).driverError?.code === '23505')
                {
                    throw donateRefusal('donate-hash', 'That transaction is another donation\'s.');
                }

                throw error;
            }

            const gift = await one(me, id);

            hooks.changed([me]);

            return gift;
        },

        /** What the reader gave, every state, or what they were given, once it was confirmed: newest first. */
        async history(me: string, side: 'given' | 'received', cursor: string | null): Promise<Donations>
        {
            const after = keysetAfter(cursor);
            const query = side === 'given'
                ? donationQuery(db).where('d.giver_id = :me', { me })
                : donationQuery(db).where(`d.receiver_id = :me and d.state = 'confirmed'`, { me });

            if (after !== null)
            {
                query.andWhere(olderThan('d.created_at', 'd.id'), after);
            }

            const rows = await query.orderBy('d.created_at', 'DESC').addOrderBy('d.id', 'DESC').limit(PAGE + 1).getRawMany<DonationRow>();

            return { donations: rows.slice(0, PAGE).map((row) => asDonation(row, side)), ...cursorOf(rows, PAGE) };
        },

        /** Every gift no worker is moving that was made in the last week, against what the contract holds, and those with a disagreement open. */
        async audit({ ids, after, deadline }: AuditAsk)
        {
            if (!tips.configured)
            {
                return nothing();
            }

            const known = ids.filter((id) => UUID.test(id));
            const again = known.length === 0 ? [] : await donationQuery(db).where('d.id = any(:ids::uuid[])', { ids: known }).getRawMany<DonationRow>();
            const from = keysetAfter(after);
            const page = donationQuery(db)
                .where(`d.state not in ('prepared', 'sent')`)
                .andWhere(`d.created_at > now() - ${ RECENT }`);

            if (from !== null)
            {
                page.andWhere(olderThan('d.created_at', 'd.id'), from);
            }

            const rows = await page.orderBy('d.created_at', 'DESC').addOrderBy('d.id', 'DESC').limit(AUDIT_PAGE + 1).getRawMany<DonationRow>();

            return await audited({ again, page: rows, after }, deadline, compared);
        },

        async sweep(budgetMs: number)
        {
            const tally: DonateSweep = { confirmed: 0, reverted: 0, expired: 0, failed: 0, faults: [] };

            if (!tips.configured)
            {
                return tally;
            }

            const began = performance.now();
            const rows = await donationQuery(db)
                .where(`d.state in ('prepared', 'sent')`)
                .orderBy('d.created_at', 'ASC')
                .limit(SWEEP_MOST)
                .getRawMany<DonationRow>();
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
                if (performance.now() - began > budgetMs)
                {
                    break;
                }

                const now = Date.now();

                if (row.state === 'prepared' && !row.lapsed && now - (askedAt.get(row.id) ?? 0) < UNSENT_EVERY_MS)
                {
                    continue;
                }

                askedAt.set(row.id, now);

                try
                {
                    const step = await settle(row);

                    if (step !== null)
                    {
                        tally[step] += 1;
                    }
                }
                catch (error)
                {
                    tally.faults.push({ donation: row.id, error: error instanceof Error ? error.message : String(error) });

                    if ((error as { status?: number }).status === 503)
                    {
                        break;
                    }
                }
            }

            return tally;
        }
    };
}

export type DonationService = ReturnType<typeof createDonationService>;
